import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Opener } from "@/components/Opener";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Geist is the fallback only. Apple devices get SF Pro and SF Mono from the system stack.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Blackbox · A flight recorder for AI agents", template: "%s · Blackbox" },
  description: "Replay an AI agent run. See the cost of each LLM call, find the waste, and price the run on another model.",
  openGraph: {
    title: "Blackbox · A flight recorder for AI agents",
    description: "Replay an AI agent run. See the cost of each LLM call, find the waste, and price the run on another model.",
    type: "website",
    siteName: "Blackbox",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#08080a", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Opener>{children}</Opener>
      </body>
    </html>
  );
}
