const PARTICLES = new Set(["de", "da", "do", "dos", "das", "del", "della", "di", "van", "von", "der", "den", "le", "la", "el", "al", "bin", "ben", "dal", "ten", "ter", "mac", "mc"]);

/**
 * The name a player is known by. The data service supplies it (`display_name`, from the
 * provider's nickname) when it has one. Without it, long names are cut to first name plus first surname.
 */
export function displayName(full: string | null | undefined, known?: string | null): string {
  if (known && known.trim()) return known.trim();
  if (!full) return "Unknown";
  const t = full.trim().split(/\s+/);
  // up to three names are shown as they are, since any shortening could drop the part people use
  if (t.length <= 3) return full.trim();
  // four or more usually means two surnames (Hispanic naming): first name plus the first surname
  let i = t.length - 2;
  while (i > 1 && PARTICLES.has(t[i - 1].toLowerCase())) i--;
  return `${t[0]} ${t.slice(i, t.length - 1).join(" ")}`;
}

/** Just the surname part, for tight labels on a pitch. */
export const surname = (full: string | null | undefined, known?: string | null) => {
  const n = displayName(full, known).split(/\s+/);
  let i = n.length - 1;
  while (i > 1 && PARTICLES.has(n[i - 1].toLowerCase())) i--;
  return n.slice(n.length > 1 ? i : 0).join(" ");
};
