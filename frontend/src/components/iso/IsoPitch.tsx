import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMotionValueEvent, type MotionValue } from "framer-motion";
import type { FreezeFrame, ShotXg } from "../../lib/api";

/**
 * The isometric pitch. Every shot of a match stands on the turf as a column
 * (taller = better chance, by our xG model). A single number, `progress` (0 to 1),
 * drives a camera: top-down map -> isometric -> zoomed on the penalty area,
 * where the real 360 freeze-frame players stand up as tokens.
 *
 * Performance: nothing here re-renders while it animates. Each frame we compute
 * the camera, project the geometry and write attributes straight to the SVG
 * nodes. Only transform-free attribute writes, ~200 nodes, comfortably 60fps.
 *
 * Coordinates are StatsBomb yards (120 x 80). Height is in yards too.
 */

const VBW = 1000;
const VBH = 640;
const CX = 500;
const CY = 352;
const S0 = 5.2; // screen units per yard at zoom 1
const PW = 120;
const PH = 80;
const SLAB = 4;
// run-off around the pitch, in yards. Bigger behind the right goal, where the camera ends up.
const MXL = 14;
const MXR = 34;
const MY = 14;
// mowing stripes: one every 10 yards, plus bands in the run-off
const STRIPES: Array<[number, number]> = [[-MXL, 0], ...Array.from({ length: 12 }, (_, i) => [i * 10, i * 10 + 10] as [number, number]), [PW, PW + MXR]];
const GOAL_H = 2.67;
const GOAL_D = 2.4;

export interface Cam {
  tilt: number; // degrees: 90 top-down, ~40 isometric
  yaw: number; // degrees around the vertical axis
  rise: number; // 0..1 column height
  zoom: number;
  fx: number; // pitch point at the centre of the view
  fy: number;
  tokens: number; // 0..1 freeze-frame players
}

const KEYS: Array<[number, Cam]> = [
  [0.0, { tilt: 90, yaw: 0, rise: 0, zoom: 1, fx: 60, fy: 40, tokens: 0 }],
  [0.14, { tilt: 90, yaw: 0, rise: 0, zoom: 1, fx: 60, fy: 40, tokens: 0 }],
  // zoom 0.86 about the middle of the turf keeps the whole slab, run-off and tall columns inside the frame
  [0.4, { tilt: 41, yaw: -30, rise: 1, zoom: 0.86, fx: 70, fy: 40, tokens: 0 }],
  [0.58, { tilt: 41, yaw: -30, rise: 1, zoom: 0.95, fx: 76, fy: 40, tokens: 0 }],
  [0.8, { tilt: 52, yaw: -8, rise: 0.3, zoom: 1.7, fx: 101, fy: 40, tokens: 0.2 }],
  [1.0, { tilt: 54, yaw: 0, rise: 0, zoom: 1.9, fx: 102, fy: 40, tokens: 1 }],
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (d: number) => (d * Math.PI) / 180;

export function cameraAt(p: number): Cam {
  const x = clamp01(p);
  for (let i = 1; i < KEYS.length; i++) {
    const [p1, c1] = KEYS[i];
    if (x <= p1) {
      const [p0, c0] = KEYS[i - 1];
      const t = smooth(clamp01((x - p0) / (p1 - p0 || 1)));
      return {
        tilt: lerp(c0.tilt, c1.tilt, t),
        yaw: lerp(c0.yaw, c1.yaw, t),
        rise: lerp(c0.rise, c1.rise, t),
        zoom: lerp(c0.zoom, c1.zoom, t),
        fx: lerp(c0.fx, c1.fx, t),
        fy: lerp(c0.fy, c1.fy, t),
        tokens: lerp(c0.tokens, c1.tokens, t),
      };
    }
  }
  return KEYS[KEYS.length - 1][1];
}

const f = (n: number) => n.toFixed(1);
const pts = (a: ArrayLike<number>[]) => a.map((p) => `${f(p[0])},${f(p[1])}`).join(" ");
const poly = (a: ArrayLike<number>[], close = false) => "M" + a.map((p) => `${f(p[0])} ${f(p[1])}`).join("L") + (close ? "Z" : "");

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 36): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

const LINES: Array<{ id: string; pts: [number, number][]; close?: boolean }> = [
  { id: "outer", pts: [[0, 0], [PW, 0], [PW, PH], [0, PH]], close: true },
  { id: "half", pts: [[60, 0], [60, PH]] },
  { id: "centre", pts: arcPts(60, 40, 9.15, 0, Math.PI * 2, 48), close: true },
  { id: "boxR", pts: [[PW, 18], [102, 18], [102, 62], [PW, 62]] },
  { id: "boxL", pts: [[0, 18], [18, 18], [18, 62], [0, 62]] },
  { id: "sixR", pts: [[PW, 30], [114, 30], [114, 50], [PW, 50]] },
  { id: "sixL", pts: [[0, 30], [6, 30], [6, 50], [0, 50]] },
  { id: "arcR", pts: arcPts(108, 40, 9.15, rad(131), rad(229)) },
  { id: "arcL", pts: arcPts(12, 40, 9.15, rad(-49), rad(49)) },
  { id: "spotR", pts: arcPts(108, 40, 0.45, 0, Math.PI * 2, 8), close: true },
  { id: "spotL", pts: arcPts(12, 40, 0.45, 0, Math.PI * 2, 8), close: true },
  { id: "spotC", pts: arcPts(60, 40, 0.45, 0, Math.PI * 2, 8), close: true },
];

interface Item {
  i: number;
  shot: ShotXg;
  x: number;
  y: number;
  r: number;
  h: number;
  team: "a" | "b";
  goal: boolean;
}

export interface IsoPitchProps {
  shots: ShotXg[];
  homeTeamId: number;
  progress: MotionValue<number>;
  freeze?: FreezeFrame | null;
  onSelect?: (shot: ShotXg) => void;
  className?: string;
}

export function IsoPitch({ shots, homeTeamId, progress, freeze, onSelect, className }: IsoPitchProps) {
  const els = useRef(new Map<string, Element>());
  const reg = useCallback(
    (key: string) => (node: Element | null) => {
      if (node) els.current.set(key, node);
      else els.current.delete(key);
    },
    [],
  );
  const hoverRef = useRef<number | null>(null);
  const tops = useRef<Array<[number, number]>>([]);
  const order = useRef<number[]>([]);
  const [hover, setHover] = useState<Item | null>(null);

  const items = useMemo<Item[]>(
    () =>
      shots
        .filter((s) => s.x != null && s.y != null)
        .map((s, i) => {
          const xg = s.xg ?? 0.03;
          return {
            i,
            shot: s,
            x: s.x as number,
            y: s.y as number,
            r: 0.95 + Math.sqrt(xg) * 1.15,
            h: 0.9 + xg * 48,
            team: s.team_id === homeTeamId ? "a" : "b",
            goal: s.outcome_name === "Goal",
          } as Item;
        }),
    [shots, homeTeamId],
  );
  // one pinned label, on the best chance of the match, so labels never crowd each other
  const best = useMemo(() => [...items].filter((it) => it.shot.xg != null).sort((a, b) => (b.shot.xg ?? 0) - (a.shot.xg ?? 0)).slice(0, 1), [items]);
  const actor = freeze?.freeze_frame.find((p) => p.actor)?.location;
  const geo = useMemo(() => {
    if (!actor) return null;
    const [ax, ay] = actor;
    const dist = Math.hypot(PW - ax, 40 - ay);
    const ang = Math.abs(Math.atan2(44 - ay, PW - ax) - Math.atan2(36 - ay, PW - ax)) * (180 / Math.PI);
    return { ax, ay, dist, ang };
  }, [actor]);

  const draw = useCallback(
    (p: number) => {
      const E = els.current;
      const set = (key: string, attr: string, val: string) => E.get(key)?.setAttribute(attr, val);
      const cam = cameraAt(p);
      const k = S0 * cam.zoom;
      const tilt = rad(cam.tilt);
      const st = Math.sin(tilt);
      const ct = Math.cos(tilt);
      const yw = rad(cam.yaw);
      const cyw = Math.cos(yw);
      const syw = Math.sin(yw);
      const P = (x: number, y: number, z = 0): [number, number, number] => {
        const dx = x - cam.fx;
        const dy = y - cam.fy;
        const rx = dx * cyw - dy * syw;
        const ry = dx * syw + dy * cyw;
        return [CX + rx * k, CY + (ry * st - z * ct) * k, ry];
      };

      // turf
      // the turf runs past the touchlines (a run-off apron), so the pitch never ends abruptly
      const corners = [P(-MXL, -MY), P(PW + MXR, -MY), P(PW + MXR, PH + MY), P(-MXL, PH + MY)];
      set("ground", "points", pts(corners));
      set("sheen", "points", pts(corners));
      STRIPES.forEach(([a, b], i) => set(`stripe${i}`, "points", pts([P(a, -MY), P(b, -MY), P(b, PH + MY), P(a, PH + MY)])));

      // slab edges facing the camera
      const NORM = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const RECT = [[-MXL, -MY], [PW + MXR, -MY], [PW + MXR, PH + MY], [-MXL, PH + MY]];
      for (let e = 0; e < 4; e++) {
        const a = RECT[e];
        const b = RECT[(e + 1) % 4];
        const ny = NORM[e][0] * syw + NORM[e][1] * cyw;
        const vis = ny > 0.02 && ct > 0.03;
        set(`side${e}`, "points", vis ? pts([P(a[0], a[1]), P(b[0], b[1]), P(b[0], b[1], -SLAB), P(a[0], a[1], -SLAB)]) : "0,0");
        set(`side${e}`, "visibility", vis ? "visible" : "hidden");
      }

      // markings
      for (const l of LINES) set(`line-${l.id}`, "d", poly(l.pts.map(([x, y]) => P(x, y)), l.close));
      set("lines", "stroke-width", (1.3 + cam.zoom * 0.55).toFixed(2));

      // goals (frame + net) at both ends
      for (const [name, gx, dir] of [["R", PW, 1], ["L", 0, -1]] as const) {
        const d = GOAL_D * dir;
        const q = (x: number, y: number, z: number) => P(x, y, z);
        const m = (a: number[], b: number[]) => `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;
        const fr = [q(gx, 36, 0), q(gx, 36, GOAL_H), q(gx, 44, GOAL_H), q(gx, 44, 0)];
        const bk = [q(gx + d, 36, 0), q(gx + d, 36, GOAL_H), q(gx + d, 44, GOAL_H), q(gx + d, 44, 0)];
        set(`goal${name}`, "d", poly(fr) + m(bk[0], bk[1]) + m(bk[1], bk[2]) + m(bk[2], bk[3]) + m(fr[1], bk[1]) + m(fr[2], bk[2]));
        let net = "";
        for (let y = 37; y < 44; y += 1.4) net += m(q(gx + d, y, 0), q(gx + d, y, GOAL_H));
        for (let z = 0.6; z < GOAL_H; z += 0.6) net += m(q(gx + d, 36, z), q(gx + d, 44, z));
        set(`net${name}`, "d", net);
      }

      // columns
      const tp: Array<[number, number]> = [];
      const depth: Array<[number, number]> = [];
      for (const it of items) {
        const base = P(it.x, it.y, 0);
        const hh = it.h * cam.rise;
        const rs = it.r * k;
        const rv = rs * st;
        const ty = base[1] - hh * ct * k;
        const bx = base[0];
        const by = base[1];
        const tall = hh * ct * k > 0.6;
        set(`cb${it.i}`, "d", tall ? `M${f(bx - rs)} ${f(by)}L${f(bx - rs)} ${f(ty)}L${f(bx + rs)} ${f(ty)}L${f(bx + rs)} ${f(by)}A${f(rs)} ${f(rv)} 0 0 1 ${f(bx - rs)} ${f(by)}Z` : "M0 0");
        set(`cs${it.i}`, "d", tall ? E.get(`cb${it.i}`)!.getAttribute("d")! : "M0 0");
        for (const [key, cy, ry] of [[`ct${it.i}`, ty, rv], [`cr${it.i}`, ty, rv * 1.0]] as const) {
          set(key, "cx", f(bx));
          set(key, "cy", f(cy));
          set(key, "rx", f(key.startsWith("cr") ? rs * 1.55 : rs));
          set(key, "ry", f(key.startsWith("cr") ? ry * 1.55 : ry));
        }
        // soft shadow, light from the upper left
        const tip = P(it.x + hh * 0.34, it.y + hh * 0.22, 0);
        set(`sh${it.i}`, "d", `M${f(bx)} ${f(by)}L${f(tip[0])} ${f(tip[1])}`);
        set(`sh${it.i}`, "stroke-width", f(Math.max(2, rv * 2 * 0.95)));
        tp[it.i] = [bx, ty];
        depth.push([it.i, base[2]]);
      }
      tops.current = tp;
      const ord = depth.sort((a, b) => a[1] - b[1]).map((d) => d[0]);
      if (ord.join() !== order.current.join()) {
        order.current = ord;
        const parent = E.get("cols");
        if (parent) for (const i of ord) { const n = E.get(`col${i}`); if (n) parent.appendChild(n); }
      }

      // freeze-frame tokens
      const tk = smoothTok(cam.tokens);
      set("tokens", "opacity", String(+tk.toFixed(2)));
      const colsOp = 1 - clamp01((cam.tokens - 0.1) / 0.5);
      set("cols", "opacity", String(+colsOp.toFixed(2)));
      set("shGroup", "opacity", String(+(0.32 * colsOp).toFixed(3)));
      set("slabShadow", "opacity", String(+(0.14 * clamp01((90 - cam.tilt) / 45) * clamp01((1.5 - cam.zoom) / 0.5)).toFixed(3)));
      if (freeze) {
        freeze.freeze_frame.forEach((pl, i) => {
          const [x, y] = pl.location;
          const base = P(x, y, 0);
          const hh = (pl.actor ? 5.2 : 4.4) * tk;
          const rs = (pl.actor ? 0.82 : 0.66) * k;
          const rv = rs * st;
          const ty = base[1] - hh * ct * k;
          set(`th${i}`, "cx", f(base[0]));
          set(`th${i}`, "cy", f(ty - rs * 0.85));
          set(`th${i}`, "r", f(rs * 0.82));
          set(`tb${i}`, "d", `M${f(base[0] - rs)} ${f(base[1])}L${f(base[0] - rs)} ${f(ty)}L${f(base[0] + rs)} ${f(ty)}L${f(base[0] + rs)} ${f(base[1])}A${f(rs)} ${f(rv)} 0 0 1 ${f(base[0] - rs)} ${f(base[1])}Z`);
          set(`tt${i}`, "cx", f(base[0])); set(`tt${i}`, "cy", f(ty)); set(`tt${i}`, "rx", f(rs)); set(`tt${i}`, "ry", f(rv));
          set(`ts${i}`, "d", `M${f(base[0])} ${f(base[1])}L${f(P(x + hh * 0.3, y + hh * 0.2)[0])} ${f(P(x + hh * 0.3, y + hh * 0.2)[1])}`);
          set(`ts${i}`, "stroke-width", f(Math.max(2, rv * 2)));
        });
        if (geo) {
          const a = P(geo.ax, geo.ay, 0.05);
          const p1 = P(PW, 36, 0.05);
          const p2 = P(PW, 44, 0.05);
          const mid = P(PW, 40, 0.05);
          set("wedge", "points", pts([a, p1, p2]));
          set("aim", "d", poly([a, mid]));
          const lab = E.get("geoLabel") as HTMLElement | undefined;
          if (lab) {
            const lx = (a[0] + mid[0]) / 2;
            const ly = (a[1] + mid[1]) / 2 - 18;
            lab.style.left = `${(lx / VBW) * 100}%`;
            lab.style.top = `${(ly / VBH) * 100}%`;
            lab.style.opacity = f(clamp01((cam.tokens - 0.55) / 0.35));
          }
        }
      }

      // pinned label on the highest-xG shot, and the hover tip
      const labOpacity = clamp01((cam.rise - 0.85) / 0.15) * clamp01(1 - cam.tokens * 2.2);
      best.forEach((g, j) => {
        const lab = E.get(`lab${j}`) as HTMLElement | undefined;
        const t = tp[g.i];
        if (!lab || !t) return;
        lab.style.left = `${(t[0] / VBW) * 100}%`;
        lab.style.top = `${((t[1] - 26) / VBH) * 100}%`;
        lab.style.opacity = f(labOpacity);
      });
      const tip = E.get("tip") as HTMLElement | undefined;
      if (tip && hoverRef.current != null && tp[hoverRef.current]) {
        const t = tp[hoverRef.current];
        tip.style.left = `${(t[0] / VBW) * 100}%`;
        tip.style.top = `${((t[1] - 14) / VBH) * 100}%`;
      }
      set("cols", "style", `pointer-events:${cam.rise > 0.25 && cam.tokens < 0.6 ? "auto" : "none"}`);
    },
    [items, best, freeze, geo],
  );

  useMotionValueEvent(progress, "change", draw);
  useEffect(() => {
    // draw once the skeleton exists, and again if data changes
    const id = requestAnimationFrame(() => draw(progress.get()));
    return () => cancelAnimationFrame(id);
  }, [draw, progress]);

  useEffect(() => {
    draw(progress.get()); // paint the hover ring the moment hover changes
  }, [hover, draw, progress]);

  const teamVar = (t: "a" | "b") => (t === "a" ? "var(--color-team-a)" : "var(--color-team-b)");
  const nTok = freeze?.freeze_frame.length ?? 0;

  return (
    <div className={`relative ${className ?? ""}`} style={{ aspectRatio: `${VBW} / ${VBH}` }}>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label="Isometric football pitch. Each shot of the match stands on the pitch as a column; taller columns are better chances.">
        <defs>
          <radialGradient id="iso-sheen" cx="0.3" cy="0.15" r="0.95">
            <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="0.6" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#000" stopOpacity="0.16" />
          </radialGradient>
          <linearGradient id="iso-shade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.34" />
          </linearGradient>
          <filter id="iso-blur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="iso-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        {/* ground contact shadow for the whole slab */}
        <ellipse ref={reg("slabShadow")} cx={CX} cy={CY + 168} rx="400" ry="56" fill="#000" opacity="0.14" filter="url(#iso-soft)" />

        {[0, 1, 2, 3].map((e) => (
          <polygon key={e} ref={reg(`side${e}`)} fill="var(--color-grass-side)" stroke="rgba(0,0,0,0.18)" strokeWidth="0.8" strokeLinejoin="round" />
        ))}
        <polygon ref={reg("ground")} fill="var(--color-grass-1)" />
        {STRIPES.map((_, i) => (i % 2 ? <polygon key={i} ref={reg(`stripe${i}`)} fill="var(--color-grass-2)" /> : <polygon key={i} ref={reg(`stripe${i}`)} fill="none" />))}
        <polygon ref={reg("sheen")} fill="url(#iso-sheen)" />

        <g ref={reg("lines")} fill="none" stroke="var(--color-grass-line)" strokeLinecap="round" strokeLinejoin="round" opacity="0.92">
          {LINES.map((l) => (
            <path key={l.id} ref={reg(`line-${l.id}`)} />
          ))}
        </g>

        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path ref={reg("netR")} stroke="var(--color-grass-line)" strokeWidth="0.7" opacity="0.4" />
          <path ref={reg("netL")} stroke="var(--color-grass-line)" strokeWidth="0.7" opacity="0.4" />
          <path ref={reg("goalR")} stroke="var(--color-grass-line)" strokeWidth="2.4" />
          <path ref={reg("goalL")} stroke="var(--color-grass-line)" strokeWidth="2.4" />
        </g>

        {geo && (
          <g opacity="0.95">
            <polygon ref={reg("wedge")} fill="var(--color-warm)" fillOpacity="0.2" stroke="var(--color-warm)" strokeWidth="1.2" strokeDasharray="5 4" />
            <path ref={reg("aim")} fill="none" stroke="var(--color-warm)" strokeWidth="1.8" strokeDasharray="6 5" strokeLinecap="round" />
          </g>
        )}

        <g ref={reg("shGroup")} filter="url(#iso-blur)" opacity="0.32" fill="none" stroke="#04101f" strokeLinecap="round">
          {items.map((it) => (
            <path key={it.i} ref={reg(`sh${it.i}`)} />
          ))}
        </g>

        <g ref={reg("cols")}>
          {items.map((it) => (
            <g
              key={it.i}
              ref={reg(`col${it.i}`)}
              style={{ cursor: it.shot.has_freeze_frame && onSelect ? "pointer" : "default" }}
              onPointerEnter={() => { hoverRef.current = it.i; setHover(it); }}
              onPointerLeave={() => { hoverRef.current = null; setHover(null); }}
              onClick={() => it.shot.has_freeze_frame && onSelect?.(it.shot)}
            >
              <path ref={reg(`cb${it.i}`)} fill={teamVar(it.team)} />
              <path ref={reg(`cs${it.i}`)} fill="url(#iso-shade)" />
              {hover?.i === it.i && <ellipse ref={reg(`cr${it.i}`)} fill="none" stroke="var(--color-ink-0)" strokeWidth="2" />}
              <ellipse ref={reg(`ct${it.i}`)} fill={teamVar(it.team)} stroke={it.goal ? "#fff" : "rgba(255,255,255,0.35)"} strokeWidth={it.goal ? 2.2 : 0.8} />
            </g>
          ))}
        </g>

        <g ref={reg("tokens")} opacity="0">
          {Array.from({ length: nTok }, (_, i) => {
            const pl = freeze!.freeze_frame[i];
            const c = pl.teammate ? "var(--color-team-a)" : "var(--color-team-b)";
            return (
              <g key={i}>
                <path ref={reg(`ts${i}`)} fill="none" stroke="#04101f" opacity="0.28" strokeLinecap="round" />
                <path ref={reg(`tb${i}`)} fill={c} />
                <ellipse ref={reg(`tt${i}`)} fill={c} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
                <circle ref={reg(`th${i}`)} fill={pl.actor ? "#fff" : c} stroke={pl.keeper ? "var(--color-warm)" : pl.actor ? c : "rgba(255,255,255,0.7)"} strokeWidth={pl.keeper || pl.actor ? 3 : 1.4} />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {best.map((g, j) => (
          <span
            key={g.i}
            ref={reg(`lab${j}`)}
            className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-ink-0 px-2.5 py-1 text-[11px] font-semibold text-pitch-950 shadow-md"
            style={{ opacity: 0 }}
          >
            Best chance: {g.shot.outcome_name ?? "shot"}, {g.shot.minute}′ · {(g.shot.xg ?? 0).toFixed(2)} xG
          </span>
        ))}
        {geo && (
          <span
            ref={reg("geoLabel")}
            className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-warm px-3 py-1 text-[12px] font-semibold text-pitch-950 shadow-md"
            style={{ opacity: 0 }}
          >
            {geo.dist.toFixed(0)} yd out · {geo.ang.toFixed(0)}° of goal in view
          </span>
        )}
        <div
          ref={reg("tip")}
          className="absolute z-10 w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-xl border border-pitch-800 bg-pitch-900 px-3 py-2 text-xs shadow-lg transition-opacity"
          style={{ opacity: hover ? 1 : 0 }}
        >
          {hover && (
            <>
              <div className="font-semibold text-ink-0">{hover.shot.player_name ?? "Unknown"}</div>
              <div className="text-ink-1">
                {hover.shot.team_name} · {hover.shot.minute}′ · {hover.shot.outcome_name}
              </div>
              <div className="mt-0.5 text-ink-1">
                Chance quality (xG): <span className="font-semibold text-ink-0">{(hover.shot.xg ?? 0).toFixed(2)}</span>
              </div>
              {hover.shot.has_freeze_frame && onSelect && <div className="mt-1 text-marker-bright">Click to see where everyone stood</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const smoothTok = (t: number) => smooth(clamp01(t));
