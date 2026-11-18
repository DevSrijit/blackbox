import { ImageResponse } from "next/og";
import snapshot from "@/data/models.snapshot.json";
import { allOn, costCurve, priceMap, totals, traceCost, usd } from "@/lib/cost";
import { DEMOS } from "@/lib/demos";
import type { Model } from "@/lib/types";

// The share card. It draws the billing demo from the same cost math as the site, on the saved price
// list, so the numbers in a link preview match what the demo shows on the day the site was built.

export const alt = "Blackbox replays an AI agent run and prices it on another model. The saved money shows as a hatched band between the two cost lines.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A model about half the price, so the new line sits mid-height and the saved band reads clearly.
const MODEL = "anthropic/claude-sonnet-5.5";
const W = 1072;
const H = 236;

/** A cost curve as a step line, in chart pixels. */
function steps(curve: { t: number; c: number }[], duration: number, max: number) {
  const x = (t: number) => (t / duration) * W;
  const y = (c: number) => H - 3 - (c / max) * (H - 16);
  const pts: [number, number][] = [[0, H - 3]];
  let yy = H - 3;
  for (const p of curve) {
    pts.push([x(p.t), yy]);
    yy = y(p.c);
    pts.push([x(p.t), yy]);
  }
  pts.push([W, yy]);
  return pts;
}
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

export default function Image() {
  const prices = priceMap(snapshot.models as Model[]);
  const run = DEMOS[0];
  const duration = totals(run).duration;
  const recorded = traceCost(run, prices);
  const repriced = traceCost(run, prices, allOn(run, MODEL));
  const a = steps(costCurve(run, prices), duration, recorded);
  const b = steps(costCurve(run, prices, allOn(run, MODEL)), duration, recorded);
  const band = `${path(a)} ${[...b].reverse().map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} Z`;
  const less = Math.round((1 - repriced / recorded) * 100);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#08080a", color: "#ededef", padding: "56px 64px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#ededef", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 10, height: 10, borderRadius: 10, background: "#ff5f1f" }} />
          </div>
          <div style={{ fontSize: 28, letterSpacing: -0.5 }}>Blackbox</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 44 }}>
          <div style={{ fontSize: 70, lineHeight: 1.02, letterSpacing: -2.6, width: 640 }}>A flight recorder for AI agents.</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontSize: 22, color: "#8a8a93" }}>
            <div style={{ display: "flex", gap: 10 }}>
              recorded <span style={{ color: "#ff5f1f" }}>{usd(recorded)}</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              on {MODEL.split("/")[1]} <span style={{ color: "#ededef" }}>{usd(repriced)}</span>
            </div>
            <div style={{ display: "flex", color: "#ededef", fontSize: 40, letterSpacing: -1, marginTop: 4 }}>{less}% less</div>
          </div>
        </div>

        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: "auto" }}>
          <defs>
            <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ededef" stopOpacity="0.2" />
              <stop offset="0.55" stopColor="#ededef" stopOpacity="0.05" />
              <stop offset="1" stopColor="#ededef" stopOpacity="0" />
            </linearGradient>
            <filter id="glow" x="-5%" y="-50%" width="110%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)">
              <rect width="1.4" height="9" fill="#ff5f1f" fillOpacity="0.45" />
            </pattern>
          </defs>
          <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#ffffff" strokeOpacity="0.08" />
          <path d={`${path(b)} L${W},${H} L0,${H} Z`} fill="url(#fade)" />
          <path d={band} fill="#ff5f1f" fillOpacity="0.1" />
          <path d={band} fill="url(#hatch)" />
          <path d={path(b)} fill="none" stroke="#ededef" strokeOpacity="0.55" strokeWidth="6" filter="url(#glow)" />
          <path d={path(a)} fill="none" stroke="#ff5f1f" strokeWidth="2.5" />
          <path d={path(b)} fill="none" stroke="#ededef" strokeWidth="2.5" />
        </svg>
      </div>
    ),
    size,
  );
}
