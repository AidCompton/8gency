"use client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, useState, type ReactNode } from "react";

gsap.registerPlugin(useGSAP);

/**
 * Subtle list entrance (design system: Motion 2/10). Children marked
 * `data-stagger` fade up 8px, 30ms apart. Only the first `max` items animate
 * so long lists don't take seconds to appear. Re-runs when `replay` changes
 * (e.g. a new filter). Reduced motion: no animation, final state at once.
 * Until hydration, `globals.css` keeps items hidden (with a CSS failsafe).
 */
export function Stagger({ children, className, replay, max = 20 }: { children: ReactNode; className?: string; replay?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-stagger]", ref.current).slice(0, max);
        gsap.fromTo(items, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.03, ease: "power1.out", clearProps: "transform,opacity,visibility" });
      });
      setDone(true);
      return () => mm.revert();
    },
    { scope: ref, dependencies: [replay], revertOnUpdate: true },
  );
  return (
    <div ref={ref} className={className} data-stagger-root="" data-stagger-done={done ? "" : undefined}>
      {children}
    </div>
  );
}

// First mount is the server-rendered page: show it as is. Later mounts are in-app navigations.
let navigated = false;

/**
 * Route entrance (used by app/app/template.tsx, which remounts per navigation):
 * a 6px, 250ms fade-up that never blocks navigation. Skipped on first load and
 * under reduced motion. Runs before paint, so content never flashes.
 */
export function PageEnter({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!navigated) {
        navigated = true;
        return;
      }
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(ref.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, ease: "power1.out", clearProps: "transform,opacity,visibility" });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return <div ref={ref}>{children}</div>;
}
