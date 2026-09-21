/**
 * The one-pager document model: the single source of truth for every renderer and exporter.
 *
 * Rules that keep future exporters (Figma plugin, PPTX for Canva, SVG) possible without restructuring:
 * - All geometry is in millimetres, relative to the page's trim box top-left (bleed extends outside it).
 * - Font sizes are in points. Colours are concrete hex strings (never theme references).
 * - Everything the HTML renderer draws is recorded here; the renderer adds no layout of its own.
 * - Only five element primitives: text, image, shape, line, group.
 */

export const SCHEMA_VERSION = 1;

export type Language = "hi" | "en" | "bi"; // bi = Hindi primary, English secondary

export type PageSizeId = "A3" | "A4" | "A5" | "A6" | "Letter" | "Legal" | "custom";
export type Orientation = "portrait" | "landscape";

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSetup {
  size: PageSizeId;
  orientation: Orientation;
  /** Trim size after orientation is applied. */
  width_mm: number;
  height_mm: number;
  margins_mm: Margins;
  /** Extra artwork area outside the trim box for print shops; 0 = none. */
  bleed_mm: number;
}

/**
 * The selection tray: an ordered list of groups, each holding ordered items. The document follows this order.
 * - kind "competency": a competency heading (id = competency_id); items are strategy_ids.
 * - kind "bucket": a general-activity bucket (id = bucket_id, e.g. GA-CFU); items are strategy_ids.
 * - kind "routines": the differentiation routines group (id = "DR"); items are routine_ids.
 * origin records how the group arrived: "competency" = added whole (top strategies pre-ticked),
 * "strategy" = created automatically when a single strategy or routine was added.
 */
export type GroupKind = "competency" | "bucket" | "routines";

export interface SelectionGroup {
  kind: GroupKind;
  id: string;
  origin: "competency" | "strategy";
  items: string[];
}

export type Tier = "spacious" | "standard" | "compact";

/** Strategy fields a template may show; they are the first to drop when space is short. */
export type OptionalField = "explanation" | "example" | "materials" | "variants" | "weeks" | "english";

export interface LayoutSettings {
  template: string;
  tier: "auto" | Tier;
  fit_pages: "auto" | number;
  /** Set once the user hand-edits a populated page; auto re-flow then asks before overwriting. */
  manually_edited: boolean;
  /** Result of the last fit, for the "Standard · 2 pages, A4 portrait" readout. */
  resolved?: { tier: Tier; pages: number; dropped_fields: OptionalField[]; overflow: boolean };
  /** Optional fields the user switched back on even though the tier would drop them. */
  forced_fields?: OptionalField[];
}

export interface Theme {
  palette: Record<string, string>;
  fonts: { display: string; body: string; mono: string };
}

export interface DocMeta {
  organisation: string;
  author: string;
  date: string;
  subtitle: string;
  /** image_ref of the optional header logo. */
  logo_ref?: string;
  created: string;
  updated: string;
}

export interface OnePagerDocument {
  schema_version: number;
  id: string;
  title: string;
  language: Language;
  page: PageSetup;
  selection: SelectionGroup[];
  layout: LayoutSettings;
  theme: Theme;
  meta: DocMeta;
  pages: Page[];
}

export interface Page {
  id: string;
  /** Optional page background; the page is white otherwise. */
  background?: string;
  elements: Element[];
}

export type ElementType = "text" | "image" | "shape" | "line" | "group";

export interface Stroke {
  colour: string;
  width_mm: number;
  dash?: "solid" | "dashed" | "dotted";
}

/** [top, right, bottom, left] like CSS, or one value for all sides. */
export type Box4 = number | [number, number, number, number];

export interface Style {
  font_family?: string;
  font_size_pt?: number;
  weight?: 400 | 500 | 600 | 700;
  italic?: boolean;
  colour?: string;
  align?: "left" | "center" | "right" | "justify";
  vertical_align?: "top" | "middle" | "bottom";
  /** Unitless multiple of font size. */
  line_height?: number;
  letter_spacing_em?: number;
  fill?: string;
  stroke?: Stroke;
  /** Corner radii; four values = [top-left, top-right, bottom-right, bottom-left]. */
  radius_mm?: Box4;
  padding_mm?: Box4;
  opacity?: number;
}

/** Crop is the visible source region as fractions (0–1) of the source image. The renderer scales that
 *  region to cover the frame, centred. Stored as fractions so crops survive re-extraction at another DPI
 *  and map directly onto Figma image transforms and PPTX srcRect. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextContent {
  text: string;
  /** Optional styled runs covering the text; when present they replace `text` for rendering. */
  runs?: { text: string; style?: Pick<Style, "weight" | "italic" | "colour" | "font_family" | "font_size_pt"> }[];
}

export interface ImageContent {
  /** "tg:<image_id>" for the TG library, "upload:<file>" for user uploads. */
  image_ref: string;
  natural_px: [number, number];
  crop: Crop;
  fit: "cover" | "contain";
  alt?: string;
}

export interface ShapeContent {
  shape_kind: "rect" | "ellipse";
}

/** A line runs from (x, y) to (x + w, y + h); w or h may be 0. */
export interface LineContent {
  line: true;
}

export interface GroupContent {
  /** Child geometry is relative to the group's top-left. */
  children: Element[];
}

export interface Binding {
  competency_id?: string;
  strategy_id?: string;
  routine_id?: string;
  bucket_id?: string;
  /** e.g. "name", "how_to", "nipun_chip", "image", "detailed_explanation", "weeks", "footer". */
  field: string;
}

interface ElementBase {
  id: string;
  name?: string; // shown in the layers panel
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  rotation: number; // degrees, clockwise, about the element's centre
  z: number;
  locked: boolean;
  hidden?: boolean;
  style: Style;
  binding?: Binding;
}

export type TextElement = ElementBase & { type: "text"; content: TextContent };
export type ImageElement = ElementBase & { type: "image"; content: ImageContent };
export type ShapeElement = ElementBase & { type: "shape"; content: ShapeContent };
export type LineElement = ElementBase & { type: "line"; content: LineContent };
export type GroupElement = ElementBase & { type: "group"; content: GroupContent };

export type Element = TextElement | ImageElement | ShapeElement | LineElement | GroupElement;
