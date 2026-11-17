"""Compact storage for 360 freeze-frames. JSON with 14-digit floats cost ~1.6 KB per frame
(2.4 GB for ~850k frames); this is ~110 bytes. Coordinates are kept at 0.1 yard (9 cm).
Player = int16 x*10, int16 y*10, uint8 flags (bit0 teammate, bit1 actor, bit2 keeper)."""
import struct

_PLAYER = struct.Struct("<hhB")


def pack_players(players: list[dict]) -> bytes:
    return b"".join(
        _PLAYER.pack(round(p["location"][0] * 10), round(p["location"][1] * 10),
                     bool(p.get("teammate")) | bool(p.get("actor")) << 1 | bool(p.get("keeper")) << 2)
        for p in players)


def unpack_players(blob: bytes) -> list[dict]:
    return [{"teammate": bool(f & 1), "actor": bool(f & 2), "keeper": bool(f & 4), "location": [x / 10, y / 10]}
            for x, y, f in _PLAYER.iter_unpack(blob)]


def pack_area(area: list[float]) -> bytes:
    return struct.pack(f"<{len(area)}h", *(round(v * 10) for v in area))


def unpack_area(blob: bytes) -> list[float]:
    return [v / 10 for v in struct.unpack(f"<{len(blob) // 2}h", blob)]
