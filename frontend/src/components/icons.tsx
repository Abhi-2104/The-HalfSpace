import type { SVGProps } from "react";

/**
 * The three match-event icons, used the same way everywhere in the app:
 * a football for a goal, a target for a big chance, an inclined boot for an assist.
 * Each is a 24 x 24 drawing, so it can sit in text or be placed inside a chart
 * (give it x, y, width and height there).
 */
type P = SVGProps<SVGSVGElement> & { size?: number; ring?: string };

export function BallIcon({ size = 16, ring, ...rest }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Goal" {...rest}>
      {ring && <circle cx="12" cy="12" r="11.2" fill="none" stroke={ring} strokeWidth="1.8" />}
      <circle cx="12" cy="12" r={ring ? 9.4 : 10.4} fill="#fff" stroke="#14213d" strokeWidth="1.5" />
      <path d="M12 7.3 16.4 10.5 14.7 15.7H9.3L7.6 10.5Z" fill="#14213d" />
      <path d="M12 7.3V3 M16.4 10.5 20.6 9 M14.7 15.7 17.5 19.3 M9.3 15.7 6.5 19.3 M7.6 10.5 3.4 9" stroke="#14213d" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function ChanceIcon({ size = 16, ring, ...rest }: P) {
  const c = ring ?? "currentColor";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Big chance" {...rest}>
      <circle cx="12" cy="12" r="9" fill="var(--color-pitch-900)" stroke={c} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4.6" fill="none" stroke={c} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="1.6" fill={c} />
    </svg>
  );
}

export function BootIcon({ size = 16, ring, ...rest }: P) {
  const c = ring ?? "currentColor";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Assist" {...rest}>
      <g transform="rotate(-18 12 12)">
        <path d="M3.2 15.2 4.6 6.4H9L9.6 9.4C12 10 13.4 10.8 15.8 11.7 18.7 12.7 20.8 13.5 20.8 15.6V16.6H3.2Z" fill={c} />
        <path d="M5.4 18.2v2M9.6 18.2v2M14 18.2v2M18.2 18.2v2" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M5.8 8.4h2.8M11 12.2l1.6-1M13.4 13l1.6-1" stroke="var(--color-pitch-900)" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
      </g>
    </svg>
  );
}
