import type { PassNetwork } from "../../lib/api";
import { PlayerMark } from "./PlayerMark";

export interface NetworkSide {
  network: PassNetwork;
  color: string;
  /** the away side is mirrored so the two teams face each other across the halfway line */
  mirror: boolean;
}

const last = (name: string | null) => (name ?? "").trim().split(/\s+/).slice(-1)[0];

/**
 * Both teams' pass networks on one pitch, each in its own colour, facing each other. The
 * selected team is drawn last at full strength; the other is greyed back but still readable.
 * Link width and opacity grow with passes between a pair; a player's size with their pass involvement.
 */
export function PassNetworkLayer({ sides, selected }: { sides: NetworkSide[]; selected: number }) {
  const order = [...sides.keys()].sort((a, b) => Number(a === selected) - Number(b === selected));
  return (
    <g>
      {order.map((i) => (
        <Side key={i} side={sides[i]} faded={i !== selected} />
      ))}
    </g>
  );
}

function Side({ side, faded }: { side: NetworkSide; faded: boolean }) {
  const { network, color, mirror } = side;
  const pos = (n: { x: number; y: number }): [number, number] => (mirror ? [120 - n.x, 80 - n.y] : [n.x, n.y]);
  const byId = new Map(network.nodes.map((n) => [n.player_id, n]));
  const maxPasses = Math.max(...network.nodes.map((n) => n.passes), 1);
  const maxEdge = Math.max(...network.edges.map((e) => e.passes), 1);
  const nodes = [...network.nodes].sort((a, b) => pos(a)[1] - pos(b)[1]);
  return (
    <g style={faded ? { filter: "grayscale(0.85)" } : undefined} opacity={faded ? 0.5 : 1}>
      {network.edges.map((e, i) => {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        if (!a || !b) return null;
        const [x1, y1] = pos(a);
        const [x2, y2] = pos(b);
        const t = e.passes / maxEdge;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeLinecap="round" strokeWidth={0.35 + t * 1.8} opacity={0.25 + t * 0.6} />;
      })}
      {nodes.map((n) => {
        const [x, y] = pos(n);
        return (
          <g key={n.player_id}>
            <PlayerMark x={x} y={y} color={color} scale={0.7 + (n.passes / maxPasses) * 0.55} label={faded ? undefined : last(n.name)} />
            <title>{n.name}: {n.passes} passes</title>
          </g>
        );
      })}
    </g>
  );
}
