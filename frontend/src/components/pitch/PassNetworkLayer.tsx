import type { PassNetwork } from "../../lib/api";

/**
 * Pass network on the turf: chalk-white links under accent-coloured players.
 * Link width and opacity grow with the number of passes between a pair; a
 * player's size grows with their pass involvement. One colour on purpose (this
 * is one team's shape, not a comparison), so size and thickness carry the data.
 */
export function PassNetworkLayer({ network }: { network: PassNetwork }) {
  const nodeById = new Map(network.nodes.map((n) => [n.player_id, n]));
  const maxPasses = Math.max(...network.nodes.map((n) => n.passes), 1);
  const maxEdge = Math.max(...network.edges.map((e) => e.passes), 1);

  return (
    <g>
      <defs>
        <filter id="net-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0.4" stdDeviation="0.4" floodColor="#04101f" floodOpacity="0.4" />
        </filter>
      </defs>
      {network.edges.map((e, i) => {
        const a = nodeById.get(e.a);
        const b = nodeById.get(e.b);
        if (!a || !b) return null;
        const t = e.passes / maxEdge;
        return (
          <line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#fff"
            strokeLinecap="round"
            strokeWidth={0.35 + t * 1.7}
            opacity={0.22 + t * 0.55}
          />
        );
      })}
      {network.nodes.map((n) => {
        const r = 1.5 + (n.passes / maxPasses) * 2.6;
        return (
          <g key={n.player_id} filter="url(#net-shadow)">
            <circle cx={n.x} cy={n.y} r={r} fill="var(--color-marker)" stroke="#fff" strokeWidth={0.55} />
            <title>{n.name} — {n.passes} passes</title>
          </g>
        );
      })}
    </g>
  );
}
