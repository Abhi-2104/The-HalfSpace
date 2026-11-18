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

// A hard flick must not carry the page far past what the reader meant to see. Each wheel event is
// limited, and the scroll target can never run more than 0.8 of a screen ahead of where the page is.
const MAX_STEP = 90;
const LEAD = 0.8;

export function SmoothScroll({ children }: { children: ReactNode }) {
  const ref = useRef<LenisRef>(null);
  const options = useRef({
    autoRaf: false,
    lerp: 0.12,
    smoothWheel: true,
    wheelMultiplier: 0.8,
    virtualScroll: (e: { deltaY: number; event: Event }) => {
      const l = ref.current?.lenis;
      if (!l || e.event.type !== "wheel" || e.event.defaultPrevented) return true;
      const cap = window.innerHeight * LEAD;
      const lead = l.targetScroll - l.animatedScroll;
      if (Math.abs(lead) > cap) l.targetScroll = l.animatedScroll + Math.sign(lead) * cap;
      e.deltaY = Math.max(-MAX_STEP, Math.min(MAX_STEP, e.deltaY));
      return true;
    },
  });

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
    <ReactLenis root ref={ref} options={options.current}>
      <ScrollToTopOnNavigate />
      {children}
    </ReactLenis>
  );
}
