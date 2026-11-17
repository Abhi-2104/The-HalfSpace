import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ReactLenis, useLenis, type LenisRef } from "lenis/react";
import { cancelFrame, frame } from "framer-motion";
import "lenis/dist/lenis.css";

/**
 * Smooth scrolling. Lenis is driven from Motion's own frame loop (frame.setup)
 * so scroll-linked animations read the same position Lenis just wrote and stay
 * in lockstep, with no one-frame lag. Skipped entirely for people who prefer
 * reduced motion, who get native scrolling.
 */
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function ScrollToTopOnNavigate() {
  const lenis = useLenis();
  const { pathname } = useLocation();
  useEffect(() => {
    lenis?.scrollTo(0, { immediate: true });
    window.scrollTo(0, 0);
  }, [pathname, lenis]);
  return null;
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  const ref = useRef<LenisRef>(null);

  useEffect(() => {
    if (reduced()) return;
    const update = ({ timestamp }: { timestamp: number }) => ref.current?.lenis?.raf(timestamp);
    frame.setup(update, true);
    return () => cancelFrame(update);
  }, []);

  if (reduced()) {
    return (
      <>
        <ScrollToTopOnNavigate />
        {children}
      </>
    );
  }
  return (
    <ReactLenis root ref={ref} options={{ autoRaf: false, lerp: 0.09, smoothWheel: true }}>
      <ScrollToTopOnNavigate />
      {children}
    </ReactLenis>
  );
}
