import { label } from "../content/fields";
import { makePage } from "../model/pageSizes";
import type { Language, OnePagerDocument, Orientation, PageSizeId, SelectionGroup } from "../model/types";
import { SCHEMA_VERSION } from "../model/types";
import { uid } from "../model/units";
import { addCompetency, addStrategy, strategiesForCompetency, uniqueItems } from "../selection/selection";
import { DEFAULT_LOOK } from "../looks";
import { KOSH_LIGHT } from "../theme/tokens";

export function createDocument(opts: {
  language?: Language; size?: PageSizeId; orientation?: Orientation; template?: string; selection?: SelectionGroup[]; id?: string;
} = {}): OnePagerDocument {
  const language = opts.language ?? "hi";
  const now = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    id: opts.id ?? uid("doc"),
    title: "",
    language,
    page: makePage(opts.size ?? "A4", opts.orientation ?? "portrait"),
    selection: opts.selection ?? [],
    layout: { template: opts.template ?? "competency-cards", tier: "auto", fit_pages: "auto", manually_edited: false },
    theme: { ...KOSH_LIGHT, look: DEFAULT_LOOK },
    meta: { organisation: "", author: "", date: "", subtitle: label("defaultSubtitle", language), created: now, updated: now },
    pages: [],
  };
}

/**
 * Demo selections used for the Phase 3 scaling check (2, 8 and 24 strategies).
 * 24 = a whole domain (Oral Language OL1–OL7) + SE2, topped up with more of their strategies.
 */
export function demoSelection(n: 2 | 8 | 24): SelectionGroup[] {
  let sel: SelectionGroup[] = [];
  const addAll = (cids: string[]) => cids.forEach((c) => (sel = addCompetency(sel, c).selection));
  if (n === 2) addAll(["RF3"]);
  if (n === 8) addAll(["RF1", "RF2", "RF3"]);
  if (n === 24) {
    const cids = ["OL1", "OL2", "OL3", "OL4", "OL5", "OL6", "OL7", "SE2"];
    addAll(cids);
    for (const c of cids) {
      for (const s of strategiesForCompetency(c)) {
        if (uniqueItems(sel).size >= 24) break;
        if (!uniqueItems(sel).has(s.strategy_id)) sel = addStrategy(sel, s.strategy_id, c).selection;
      }
    }
  }
  return sel;
}
