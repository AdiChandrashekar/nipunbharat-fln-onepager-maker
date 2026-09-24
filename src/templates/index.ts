import type { TableColumn, TemplateDef, TierSpec } from "./types";

/**
 * Fields a template may show by default. "weeks" (संदर्शिका में) and "variants" (अन्य रूप) are deliberately
 * absent from every template: they are opt-in extras the user switches on per document (forced_fields).
 */
const CORE = ["explanation", "example", "materials", "english"] as const;

const tier = (t: Partial<TierSpec> & Pick<TierSpec, "col_width_mm" | "type" | "image">): TierSpec => ({
  max_cols: { portrait: 2, landscape: 3 },
  gap_mm: 6,
  block_gap_mm: 3,
  frame_pad_mm: 4,
  fields: [],
  ...t,
});

export const competencyCards: TemplateDef = {
  id: "competency-cards",
  name: { en: "Competency cards", hi: "दक्षता कार्ड" },
  description: "The overview sheet: one card per competency with its picture and all its strategies, packed in columns.",
  best_for: "Whole competencies or a whole domain on one sheet",
  recipe: "cards",
  frame: "group",
  group_image: true,
  item_image: false,
  heading_style: "card",
  tiers: {
    spacious: tier({
      col_width_mm: 186, max_cols: { portrait: 1, landscape: 2 },
      type: { title: 26, subtitle: 12, group: 19, name: 14, body: 12, meta: 10 },
      image: { placement: "right", frac: 0.38 }, gap_mm: 8, block_gap_mm: 4, frame_pad_mm: 6,
      fields: [...CORE],
    }),
    standard: tier({
      col_width_mm: 90,
      type: { title: 22, subtitle: 11, group: 15, name: 12, body: 10.5, meta: 9 },
      image: { placement: "right", frac: 0.36 }, block_gap_mm: 3,
      fields: ["example", "materials", "english"],
    }),
    compact: tier({
      col_width_mm: 86,
      type: { title: 18, subtitle: 10, group: 12.5, name: 10.5, body: 9.5, meta: 8 },
      image: { placement: "right", frac: 0.32 }, gap_mm: 5, block_gap_mm: 2.2, frame_pad_mm: 3,
    }),
  },
};

export const strategyCards: TemplateDef = {
  id: "strategy-cards",
  name: { en: "Strategy cards", hi: "रणनीति कार्ड" },
  description: "A deck: one equal-size card per strategy with its picture as a banner, in a grid under each competency. Cut them out, pin them up.",
  best_for: "A hand-picked set of strategies; cut-out cards for a training",
  recipe: "cards",
  frame: "item",
  flow: "grid",
  group_image: false,
  item_image: true,
  heading_style: "section",
  tiers: {
    spacious: tier({
      col_width_mm: 88, max_cols: { portrait: 2, landscape: 3 },
      type: { title: 26, subtitle: 12, group: 18, name: 14, body: 11.5, meta: 9.5 },
      image: { placement: "top", frac: 1, aspect: 1.6 }, gap_mm: 7, block_gap_mm: 3, frame_pad_mm: 5,
      fields: [...CORE],
    }),
    standard: tier({
      col_width_mm: 88, max_cols: { portrait: 2, landscape: 3 },
      type: { title: 22, subtitle: 11, group: 15, name: 12.5, body: 10.5, meta: 9 },
      image: { placement: "top", frac: 1, aspect: 1.7 }, gap_mm: 6, block_gap_mm: 2.5, frame_pad_mm: 4,
      fields: ["example", "english"],
    }),
    compact: tier({
      col_width_mm: 58, max_cols: { portrait: 3, landscape: 4 },
      type: { title: 18, subtitle: 10, group: 12.5, name: 10.5, body: 9, meta: 8 },
      image: { placement: "top", frac: 1, aspect: 1.8 }, gap_mm: 4.5, block_gap_mm: 2, frame_pad_mm: 3,
    }),
  },
};

export const deepDive: TemplateDef = {
  id: "deep-dive",
  name: { en: "Deep-dive", hi: "विस्तृत विवरण" },
  description: "A magazine feature: big headlines, the full read-more text, and the example as a pull quote.",
  best_for: "1–4 strategies explained in full, for a workshop handout",
  recipe: "cards",
  frame: "none",
  pull_quote: true,
  name_scale: 1.35,
  group_image: false,
  item_image: true,
  heading_style: "section",
  tiers: {
    spacious: tier({
      col_width_mm: 130, max_cols: { portrait: 1, landscape: 2 },
      type: { title: 26, subtitle: 12, group: 17, name: 16, body: 12, meta: 10.5 },
      image: { placement: "right", frac: 0.44 }, gap_mm: 9, block_gap_mm: 3.5,
      fields: [...CORE],
    }),
    standard: tier({
      col_width_mm: 150, max_cols: { portrait: 1, landscape: 2 },
      type: { title: 22, subtitle: 11, group: 14.5, name: 13.5, body: 11, meta: 9.5 },
      image: { placement: "right", frac: 0.38 }, gap_mm: 8, block_gap_mm: 3,
      fields: [...CORE],
    }),
    compact: tier({
      col_width_mm: 88,
      type: { title: 18, subtitle: 10, group: 12.5, name: 11, body: 9.5, meta: 8.5 },
      image: { placement: "right", frac: 0.34 }, gap_mm: 6, block_gap_mm: 2.2,
      fields: ["explanation"],
    }),
  },
};

const tableCols = (image: boolean, details: boolean): TableColumn[] => {
  const cols: TableColumn[] = [{ key: "name", label_hi: "रणनीति", label_en: "Strategy", frac: 0.24 }];
  cols.push({ key: "how_to", label_hi: "कैसे करें", label_en: "How to do it", frac: details ? 0.44 : 0.76 });
  if (details) cols.push({ key: "details", label_hi: "विवरण", label_en: "Details", frac: 0.32 });
  if (image) {
    // Make room for a thumbnail column by trimming the others proportionally.
    for (const c of cols) c.frac *= 0.84;
    cols.push({ key: "image", label_hi: "", label_en: "", frac: 0.16 });
  }
  return cols;
};

export const strategyTable: TemplateDef = {
  id: "strategy-table",
  name: { en: "Strategy table", hi: "रणनीति तालिका" },
  description: "At a glance: competencies as bands, one striped row per strategy, steps and details in columns.",
  best_for: "Many strategies side by side; a mentor's checklist; landscape pages",
  recipe: "table",
  frame: "none",
  group_image: false,
  item_image: true,
  heading_style: "section",
  tiers: {
    spacious: tier({
      col_width_mm: 400, max_cols: { portrait: 1, landscape: 1 },
      type: { title: 24, subtitle: 11.5, group: 13, name: 11.5, body: 11, meta: 9.5 },
      image: { placement: "right", frac: 1 }, block_gap_mm: 0, frame_pad_mm: 2.5,
      fields: ["example", "materials", "english"],
    }),
    standard: tier({
      col_width_mm: 400, max_cols: { portrait: 1, landscape: 1 },
      type: { title: 21, subtitle: 10.5, group: 12, name: 11, body: 10, meta: 9 },
      image: { placement: "none", frac: 0 }, block_gap_mm: 0, frame_pad_mm: 2,
      fields: ["example", "materials"],
    }),
    compact: tier({
      col_width_mm: 400, max_cols: { portrait: 1, landscape: 1 },
      type: { title: 18, subtitle: 10, group: 11, name: 10, body: 9.5, meta: 8.5 },
      image: { placement: "none", frac: 0 }, block_gap_mm: 0, frame_pad_mm: 1.6,
    }),
  },
  table: {
    spacious: tableCols(true, true),
    standard: tableCols(false, true),
    compact: tableCols(false, false),
  },
};

export const poster: TemplateDef = {
  id: "poster",
  name: { en: "Poster", hi: "पोस्टर" },
  description: "For the wall: a hero picture, a huge name and giant step numbers on a bold colour card.",
  best_for: "Classroom or training-room walls; one to four strategies; A3 or A4",
  recipe: "cards",
  frame: "item",
  flow: "grid",
  steps_style: "numerals",
  card_kind: "hero",
  name_scale: 1.25,
  group_image: false,
  item_image: true,
  heading_style: "section",
  tiers: {
    spacious: tier({
      col_width_mm: 130, max_cols: { portrait: 1, landscape: 2 },
      type: { title: 40, subtitle: 16, group: 22, name: 24, body: 17, meta: 13 },
      image: { placement: "top", frac: 1 }, gap_mm: 10, block_gap_mm: 6, frame_pad_mm: 7,
      fields: ["english"],
    }),
    standard: tier({
      col_width_mm: 90, max_cols: { portrait: 2, landscape: 3 },
      type: { title: 32, subtitle: 13, group: 17, name: 17, body: 13, meta: 11 },
      image: { placement: "top", frac: 1 }, gap_mm: 8, block_gap_mm: 5, frame_pad_mm: 5,
      fields: ["english"],
    }),
    compact: tier({
      col_width_mm: 62, max_cols: { portrait: 3, landscape: 4 },
      type: { title: 26, subtitle: 12, group: 13, name: 13, body: 10.5, meta: 9 },
      image: { placement: "top", frac: 1 }, gap_mm: 6, block_gap_mm: 4, frame_pad_mm: 3.5,
    }),
  },
};

export const TEMPLATES: TemplateDef[] = [competencyCards, strategyCards, deepDive, strategyTable, poster];
export const templateById = new Map(TEMPLATES.map((t) => [t.id, t]));
