import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";

/** Counts up to `to` the first time it is visible. Writes straight to the DOM, so it never re-renders. */
export function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (!inView || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = fmt(inView ? to : 0);
      return;
    }
    const controls = animate(0, to, { duration: 1.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (node.textContent = fmt(v)) });
    return () => controls.stop();
  }, [inView, to, decimals, suffix]);

  return (
    <span ref={ref} className="tabular-nums">
      {(0).toLocaleString(undefined, { minimumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
