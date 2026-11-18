"use client";

// The style of a pinned scene's text layer.
//
// The text never moves with scroll by JavaScript. On a phone, scrolling runs on the compositor
// thread and scroll events reach JavaScript a frame or more later, so text moved in JavaScript to
// cancel the scroll always lands a frame late and shakes. The text layer is a CSS sticky element,
// which the compositor moves in step with the scroll, and only its opacity follows scroll progress.
// It shows only while the section is pinned, so it never slides across the chart.

import { useTransform, type MotionValue } from "motion/react";

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Blur on a whole layer costs a full repaint each frame, so it is kept for mouse screens. */
let fine: boolean | null = null;
const isFine = () => (fine ??= typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches);

/** In over the first part of the pin, out over the end. `p` is the pin progress, 0..1. */
export function usePinnedText(p: MotionValue<number>, fadeIn = 0.07, fadeOutAt = 0.88) {
  // A fadeIn past 0.3 is a late start: the text waits, then fades in over the next 0.2.
  const opacity = useTransform(p, (q) => Math.min(fadeIn > 0.3 ? smooth((q - (fadeIn - 0.2)) / 0.2) : smooth(q / fadeIn), 1 - smooth((q - fadeOutAt) / 0.1)));
  const filter = useTransform(opacity, (o) => (isFine() && o < 0.999 ? `blur(${((1 - o) * 10).toFixed(2)}px)` : "none"));
  return { opacity, filter };
}
