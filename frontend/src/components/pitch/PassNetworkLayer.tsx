import type { PassNetwork } from "../../lib/api";

/**
 * Pass network: edges under nodes. Edge width scales with pass count between a
 * pair; node radius with a player's pass involvement. Nodes are single-hue
 * (this is one team's shape, not categorical series) - size carries the
 * magnitude, colour just marks identity as "this team".
 */
export function PassNetworkLayer({ network }: { network: PassNetwork }) {
  const nodeById = new Map(network.nodes.map((n) => [n.player_id, n]));
  const maxPasses = Math.max(...network.nodes.map((n) => n.passes), 1);
  const maxEdge = Math.max(...network.edges.map((e) => e.passes), 1);

  return (
    <g>
      {network.edges.map((e, i) => {
        const a = nodeById.get(e.a);
        const b = nodeById.get(e.b);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="var(--color-marker)"
            strokeWidth={0.3 + (e.passes / maxEdge) * 1.6}
            opacity={0.25 + (e.passes / maxEdge) * 0.4}
          />
        );
      })}
      {network.nodes.map((n) => {
        const r = 1.4 + (n.passes / maxPasses) * 2.6;
        return (
          <g key={n.player_id}>
            <circle cx={n.x} cy={n.y} r={r} fill="var(--color-marker-bright)" opacity={0.9} />
            <title>{n.name} — {n.passes} passes</title>
          </g>
        );
      })}
    </g>
  );
}
