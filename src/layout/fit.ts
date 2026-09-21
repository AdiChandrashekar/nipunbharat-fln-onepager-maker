/**
 * Fit-before-overflow: try the tier ladder from most spacious to most compact and keep the first
 * configuration that needs the fewest pages. Honour a forced tier or a "fit to N pages" target.
 */
import { itemText } from "../content/fields";
import type { OnePagerDocument, OptionalField, Page, Tier } from "../model/types";
import { resolve } from "../selection/selection";
import { templateById } from "../templates";
import { configLadder, layoutDocument, type LayoutConfig } from "./engine";

export interface FitResult {
  pages: Page[];
  tier: Tier;
  step: number;
  cols: number;
  pageCount: number;
  /** Optional fields the most spacious tier would show but this result leaves out (only fields with content). */
  dropped: OptionalField[];
  /** True when the target (fit to N / forced tier) couldn't be met, or a block is taller than a column. */
  overflow: boolean;
  /** Pages each rung of the ladder needed, for the UI. */
  ladder: { tier: Tier; step: number; pages: number }[];
}

export function fitDocument(doc: OnePagerDocument): FitResult {
  const t = templateById.get(doc.layout.template)!;
  const forced = doc.layout.forced_fields ?? [];
  const groups = resolve(doc.selection);
  let ladder = configLadder(t, doc.page, forced);
  if (doc.layout.tier !== "auto") ladder = ladder.filter((c) => c.tier === doc.layout.tier);

  const results = ladder.map((cfg) => ({ cfg, ...layoutDocument(doc, t, cfg, groups) }));
  const target = doc.layout.fit_pages;
  const fewest = Math.min(...results.map((r) => r.pages.length));
  let pick = target === "auto"
    ? results.find((r) => r.pages.length === fewest)!
    : results.find((r) => r.pages.length <= target) ?? results[results.length - 1];
  // Among equal page counts prefer a result without column overflow.
  if (pick.overflow) pick = results.find((r) => r.pages.length === pick.pages.length && !r.overflow) ?? pick;

  const available = contentFields(doc);
  const full = new Set<OptionalField>([...t.tiers.spacious.fields, ...forced]);
  const dropped = [...full].filter((f) => available.has(f) && !pick.cfg.fields.has(f));
  return {
    pages: pick.pages,
    tier: pick.cfg.tier,
    step: pick.cfg.step,
    cols: pick.cfg.cols,
    pageCount: pick.pages.length,
    dropped,
    overflow: pick.overflow || (target !== "auto" && pick.pages.length > target),
    ladder: results.map((r) => ({ tier: r.cfg.tier, step: r.cfg.step, pages: r.pages.length })),
  };
}

/** Which optional fields have content for the current selection and language. */
function contentFields(doc: OnePagerDocument): Set<OptionalField> {
  const out = new Set<OptionalField>();
  for (const g of doc.selection) {
    for (const id of g.items) {
      const it = itemText(g.kind === "routines" ? "routine" : "strategy", id, doc.language);
      for (const [k, v] of Object.entries(it.optional)) {
        if (v && (!Array.isArray(v) || v.length)) out.add((k === "applies" ? "variants" : k) as OptionalField);
      }
    }
  }
  return out;
}

export type { LayoutConfig };
