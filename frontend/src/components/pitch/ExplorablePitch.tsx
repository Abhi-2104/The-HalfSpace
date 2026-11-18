import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pitch } from "./Pitch";

const X0 = -4, Y0 = -4, W = 128, H = 88; // the full flat pitch with its run-off
const MAX_Z = 8;

/**
 * The flat pitch you can explore: scroll or pinch to zoom towards the cursor, drag to pan,
 * double-click to reset. The view glides to where you send it instead of jumping.
 * Anything drawn inside (shots, players) is in pitch yards, so it scales with the zoom.
 */
export function ExplorablePitch({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const cur = useRef({ z: 1, cx: X0 + W / 2, cy: Y0 + H / 2 });
  const tgt = useRef({ z: 1, cx: X0 + W / 2, cy: Y0 + H / 2 });
  const raf = useRef(0);
  const moved = useRef(false);
  const [zoomed, setZoomed] = useState(false);

  const clamp = (v: { z: number; cx: number; cy: number }) => {
    const z = Math.min(MAX_Z, Math.max(1, v.z));
    const hw = W / z / 2, hh = H / z / 2;
    return { z, cx: Math.min(X0 + W - hw, Math.max(X0 + hw, v.cx)), cy: Math.min(Y0 + H - hh, Math.max(Y0 + hh, v.cy)) };
  };
  const apply = () => {
    const { z, cx, cy } = cur.current;
    svg.current?.setAttribute("viewBox", `${(cx - W / z / 2).toFixed(3)} ${(cy - H / z / 2).toFixed(3)} ${(W / z).toFixed(3)} ${(H / z).toFixed(3)}`);
  };
  const glide = () => {
    cancelAnimationFrame(raf.current);
    const step = () => {
      const c = cur.current, t = tgt.current;
      const k = 0.2;
      c.z += (t.z - c.z) * k; c.cx += (t.cx - c.cx) * k; c.cy += (t.cy - c.cy) * k;
      apply();
      if (Math.abs(t.z - c.z) > 0.002 || Math.abs(t.cx - c.cx) > 0.01 || Math.abs(t.cy - c.cy) > 0.01) raf.current = requestAnimationFrame(step);
      else { Object.assign(c, t); apply(); }
    };
    raf.current = requestAnimationFrame(step);
  };
  const go = (v: { z: number; cx: number; cy: number }) => { tgt.current = clamp(v); setZoomed(tgt.current.z > 1.02); glide(); };
  const zoomAt = (factor: number, px: number, py: number) => {
    // keep the pitch point under (px, py) fixed: px, py are 0..1 across the element
    const t = tgt.current;
    const z = Math.min(MAX_Z, Math.max(1, t.z * factor));
    const ux = t.cx - W / t.z / 2 + px * (W / t.z), uy = t.cy - H / t.z / 2 + py * (H / t.z);
    go({ z, cx: ux - (px - 0.5) * (W / z), cy: uy - (py - 0.5) * (H / z) });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const rel = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = rel(e);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), px, py);
    };
    const pts = new Map<number, [number, number]>();
    let pinch = 0;
    const onDown = (e: PointerEvent) => { pts.set(e.pointerId, [e.clientX, e.clientY]); moved.current = false; pinch = 0; };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (Math.hypot(dx, dy) >= 1) moved.current = true;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) { const [px, py] = rel({ clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 }); zoomAt(d / pinch, px, py); }
        pinch = d;
        return;
      }
      if (!moved.current) return;
      const r = el.getBoundingClientRect();
      const t = tgt.current;
      go({ z: t.z, cx: t.cx - dx * (W / t.z / r.width), cy: t.cy - dy * (H / t.z / r.height) });
    };
    const onUp = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const reset = () => go({ z: 1, cx: X0 + W / 2, cy: Y0 + H / 2 });
    el.addEventListener("dblclick", reset);
    return () => {
      cancelAnimationFrame(raf.current);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", reset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={box} className={`relative overflow-hidden rounded-2xl ${className ?? ""}`} style={{ aspectRatio: `${W} / ${H}`, touchAction: "none", cursor: zoomed ? "grab" : "default" }}
      onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); moved.current = false; } }}>
      <Pitch svgRef={svg} className="block h-full w-full">{children}</Pitch>
      <div className="absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-xl border border-pitch-800 bg-pitch-900/90 text-ink-0 shadow-md backdrop-blur">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.5, 0.5, 0.5)} className="grid h-8 w-8 place-items-center text-lg leading-none hover:bg-pitch-800">+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, 0.5, 0.5)} className="grid h-8 w-8 place-items-center border-t border-pitch-800 text-lg leading-none hover:bg-pitch-800">−</button>
        {zoomed && <button type="button" aria-label="Reset view" onClick={() => go({ z: 1, cx: X0 + W / 2, cy: Y0 + H / 2 })} className="grid h-8 w-8 place-items-center border-t border-pitch-800 text-xs hover:bg-pitch-800">⟲</button>}
      </div>
    </div>
  );
}
