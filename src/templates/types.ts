import type { OptionalField, Tier } from "../model/types";

/**
 * A template is pure data: it picks a layout recipe and sets its parameters for every density tier.
 * Sizes are for A4; the engine scales them by page size (and never below the page's minimum body size).
 * New templates are added by writing another TemplateDef; the editor and engine need no changes.
 */
export interface TierSpec {
  /** Target column width; the engine picks the column count that best matches it (capped by max_cols). */
  col_width_mm: number;
  max_cols: { portrait: number; landscape: number };
  /** Point sizes at A4. */
  type: { title: number; subtitle: number; group: number; name: number; body: number; meta: number };
  /** `aspect`: top pictures cropped to this width/height (a banner) instead of their own shape. */
  image: { placement: "right" | "top" | "none"; frac: number; aspect?: number };
  gap_mm: number; // between columns
  block_gap_mm: number; // between blocks
  frame_pad_mm: number; // inside card frames
  fields: OptionalField[];
}

export interface TableColumn {
  key: "name" | "how_to" | "details" | "image";
  label_hi: string;
  label_en: string;
  frac: number;
}

export interface TemplateDef {
  id: string;
  name: { en: string; hi: string };
  description: string;
  best_for: string;
  recipe: "cards" | "table";
  /** cards recipe: which unit gets a card background. */
  frame: "group" | "item" | "none";
  /** One image per competency group, on its heading (competency cards). */
  group_image: boolean;
  /** One image per strategy. */
  item_image: boolean;
  /** "card" = heading inside the group's card; "section" = heading with a rule above its items. */
  heading_style: "card" | "section";
  /** "columns": blocks flow down balanced columns; "grid": one card per strategy in rows of equal height. */
  flow?: "columns" | "grid";
  /** Step numbers: small badges (default) or big display numerals (posters). */
  steps_style?: "badges" | "numerals";
  /** Example as a pull quote in the display face (features). */
  pull_quote?: boolean;
  /** Card style for strategy frames: "item" or the larger "hero" (posters). */
  card_kind?: "item" | "hero";
  /** Strategy names this much larger than the tier's name size. */
  name_scale?: number;
  tiers: Record<Tier, TierSpec>;
  /** table recipe: columns per tier (fractions of the table width). */
  table?: Record<Tier, TableColumn[]>;
}
