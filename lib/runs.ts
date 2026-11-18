// The run menu's items: the demos, plus a file the visitor opened.

import type { RunItem } from "@/components/RunMenu";
import { DEMOS } from "./demos";

export const demoRuns = (): RunItem[] => DEMOS.map((d) => ({ key: d.id, title: d.title, description: d.description, demo: true, href: `/demo/${d.id}` }));
