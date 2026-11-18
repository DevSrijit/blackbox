// Blackbox icons. One family: a 16 px grid, a 1.5 px stroke, round caps and joins, currentColor.
// Drawn for this product, so every mark matches the type weight next to it.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/**
 * A four-point spark centered on (8, 8). The sides curve in, and a thin round stroke softens the
 * tips so they stay whole at 2x zoom.
 */
const spark = (r: number) => {
  const k = r * 0.12;
  const q = r * 0.6;
  return `M8 ${8 - r}C${8 + k} ${8 - q} ${8 + q} ${8 - k} ${8 + r} 8C${8 + q} ${8 + k} ${8 + k} ${8 + q} 8 ${8 + r}C${8 - k} ${8 + q} ${8 - q} ${8 + k} ${8 - r} 8C${8 - q} ${8 - k} ${8 - k} ${8 - q} 8 ${8 - r}Z`;
};

/** An LLM call: a solid spark, alone. Never in a box: at small sizes a boxed spark reads as "add". */
export const IconLLM = (p: P) => (
  <Svg {...p}>
    <path d={spark(5.75)} fill="currentColor" strokeWidth={0.75} />
  </Svg>
);

// The step marks. One plain shape per kind, so a column of them scans at a glance:
// an LLM call is a solid spark, a tool call a pair of braces, a retrieval a hollow circle,
// an agent a solid square, and a failed step a circle with a slash.

export const MarkLLM = (p: P) => (
  <Svg {...p}>
    <path d={spark(4.75)} fill="currentColor" strokeWidth={0.75} />
  </Svg>
);

/** A tool call: function braces. */
export const MarkTool = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 3H5a1.5 1.5 0 0 0-1.5 1.5v1.6c0 .8-.6 1.4-1.3 1.9.7.5 1.3 1.1 1.3 1.9v1.6A1.5 1.5 0 0 0 5 13h.5M10.5 3h.5a1.5 1.5 0 0 1 1.5 1.5v1.6c0 .8.6 1.4 1.3 1.9-.7.5-1.3 1.1-1.3 1.9v1.6A1.5 1.5 0 0 1 11 13h-.5" />
  </Svg>
);

export const MarkRetrieval = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3.9" />
  </Svg>
);

export const MarkAgent = (p: P) => (
  <Svg {...p}>
    <rect x="3.75" y="3.75" width="8.5" height="8.5" rx="2.25" fill="currentColor" stroke="none" />
  </Svg>
);

export const MarkFailed = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.25" />
    <path d="m5 11 6-6" />
  </Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M5.2 3.3c0-.6.7-1 1.2-.6l6 4.5c.4.3.4.9 0 1.2l-6 4.5c-.5.4-1.2 0-1.2-.6Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPause = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="2.75" height="10" rx=".8" fill="currentColor" stroke="none" />
    <rect x="9.25" y="3" width="2.75" height="10" rx=".8" fill="currentColor" stroke="none" />
  </Svg>
);

/** Replay from the start: a loop that closes with an arrowhead. */
export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M3.3 8.6A4.75 4.75 0 1 0 4.7 4.6" />
    <path d="M2.9 2.6v2.6h2.6" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
  </Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 8.4 2.9 2.9 6.1-6.6" />
  </Svg>
);

/** Open a trace: a plain page with an arrow that goes up, into the app. No folded corner: at 16 px it hits the arrow. */
export const IconOpen = (p: P) => (
  <Svg {...p}>
    <rect x="3.25" y="2.25" width="9.5" height="11.5" rx="2" />
    <path d="M8 10.75v-5M5.75 7.75 8 5.5l2.25 2.25" />
  </Svg>
);

export const IconGitHub = (p: P) => (
  <svg viewBox="0 0 16 16" width={p.size ?? 16} height={p.size ?? 16} fill="currentColor" aria-hidden className={p.className}>
    <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z" />
  </svg>
);

/** Compare models: two arrows that point in opposite directions. */
export const IconCompare = (p: P) => (
  <Svg {...p}>
    <path d="M3 5.25h9.5M10 2.75l2.5 2.5-2.5 2.5M13 10.75H3.5M6 8.25l-2.5 2.5 2.5 2.5" />
  </Svg>
);

/** Waste: a drop that leaks from a line. */
export const IconWaste = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 3.5h11" />
    <path d="M8 6c1.6 2 2.5 3.4 2.5 4.6a2.5 2.5 0 0 1-5 0C5.5 9.4 6.4 8 8 6Z" />
  </Svg>
);

/** One step: a crosshair. */
export const IconStep = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5" />
  </Svg>
);

/** Order by time: a clock hand. */
export const IconTime = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Svg>
);

/** Order by cost: bars sorted high to low. */
export const IconCost = (p: P) => (
  <Svg {...p}>
    <path d="M3 4h10M3 8h7M3 12h4" />
  </Svg>
);

export const IconCommand = (p: P) => (
  <Svg {...p}>
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6Zm0 0v4m0-4h4m-4 4v1.5A1.5 1.5 0 1 1 4.5 10H6Zm0 0h4m0-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0v1.5a1.5 1.5 0 1 0 1.5-1.5H10Z" />
  </Svg>
);

export const IconKeyboard = (p: P) => (
  <Svg {...p}>
    <rect x="1.75" y="4" width="12.5" height="8" rx="1.75" />
    <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" />
  </Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
    <path d="M10.75 5.25V4.25a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5h1" />
  </Svg>
);

/** A link: jump to something in the timeline. */
export const IconLocate = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 8h3M10.5 8h3M8 2.5v3M8 10.5v3" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 7.25v3.5M8 5.2h.01" />
  </Svg>
);

/** Faster: two chevrons forward. */
export const IconFaster = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 4.5 3.5 3.5-3.5 3.5M8.5 4.5 12 8l-3.5 3.5" />
  </Svg>
);

/** Slower: two chevrons back. */
export const IconSlower = (p: P) => (
  <Svg {...p}>
    <path d="M12.5 4.5 9 8l3.5 3.5M7.5 4.5 4 8l3.5 3.5" />
  </Svg>
);

/** Undo: an arrow that turns back. */
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 3.25 2.75 6l2.75 2.75" />
    <path d="M2.75 6h6.5a3.75 3.75 0 0 1 0 7.5H7" />
  </Svg>
);
