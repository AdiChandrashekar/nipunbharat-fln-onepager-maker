/**
 * Looks: the visual system a document wears, independent of its template (layout). A look sets colours,
 * type, cards, labels, step numbers, callouts, the masthead and the page background. Every template works
 * with every look. Everything a look produces is ordinary elements, so it stays editable and exports as is.
 */
import type { Language, Style } from "../model/types";
import { alpha, shade, tint } from "../theme/tokens";

type W = NonNullable<Style["weight"]>;

export interface Palette {
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  accent_ink: string;
  /** Domain colours: OL, SE, DC, RF, RC, WR, GA. */
  d: Record<string, string>;
}

/** A solid offset copy of a box behind it (neo-brutalist hard shadow). */
export interface HardShadow { dx: number; dy: number; colour: string }

export interface CardLook {
  style: Style;
  accent?: { side: "top" | "left"; size: number; colour: string };
  hard?: HardShadow;
  /** A strip of tape across the card's top edge (notebook). */
  tape?: string;
}

export type CardKind = "item" | "group" | "hero";

export interface Look {
  id: string;
  name: string;
  blurb: string;
  palette: Palette;
  /** [English face, Hindi face] per role; see fontsFor. */
  fonts: { display: [string, string]; body: [string, string]; label: [string, string] };
  weight: { display: W; name: W; label: W };
  /** Display type is set this much larger/smaller than the template's sizes (condensed faces need more). */
  displayScale: number;
  displayLineHeight: number;
  /** The document's key colour, from the domains it covers (first group first). */
  primary(domains: string[]): string;
  page(domains: string[]): string;
  card(dom: string, kind: CardKind): CardLook;
  image: Style;
  /** Step number marker. */
  badge(dom: string): { style: Style; square: boolean };
  /** Domain line above a competency name: plain coloured text, or a chip. */
  kicker(dom: string): { colour: string; chip?: Style; hard?: HardShadow };
  /** Short colour bar above section headings. */
  headingBar: boolean;
  /** Text colour for coloured labels on light surfaces. */
  onLight(dom: string): string;
  callout(dom: string): { panel: Style; edge?: string; hard?: HardShadow };
  masthead: "band" | "brutal" | "tonal" | "glass" | "riso" | "swiss" | "bauhaus" | "notebook";
  rule: { colour: string; width: number };
  table: { header: string; headerInk: string; zebra?: string };
  /**
   * Full-width section headings: "plain" (kicker + name), "numbered" (a big 01, 02 … beside them),
   * "block" (a colour-blocked bar with white type and its number), "circle" (the number in a colour disc).
   */
  section?: "plain" | "numbered" | "block" | "circle";
  /** Colour of section numbers ("numbered"). */
  numeral?(dom: string): string;
  /** Step numbers as big numerals in every template (otherwise badges, except posters). */
  steps?: "numerals";
  /** Display type printed twice, the second copy offset in another ink (riso misregistration). */
  misregister?: { colour: string; dx: number; dy: number };
  /** Highlighter-pen stroke behind competency names (notebook). */
  highlighter?: string;
  /** Second accent for stickers and big numbers (Bold). */
  hot?: string;
}

const DOMAINS = ["OL", "SE", "DC", "RF", "RC", "WR", "GA"];
const firstDomain = (p: Palette, domains: string[]) => p.d[domains[0]] ?? p.accent;

// ---------------------------------------------------------------- Bold: editorial colour blocking

const boldPalette: Palette = {
  paper: "#FFFFFF", ink: "#0F1B2D", muted: "#465467", rule: "#D5DDE8", accent: "#1A43B8", accent_ink: "#FFFFFF",
  d: { OL: "#E4572E", SE: "#D62F7A", DC: "#14936B", RF: "#1A43B8", RC: "#6D3FD4", WR: "#E08A00", GA: "#465467" },
};
const HOT = "#FFB21A";

const bold: Look = {
  id: "bold",
  name: "Bold",
  blurb: "Editorial colour blocking: an electric-blue masthead with an oversized count, full-width colour bars for each competency with big numbers, crisp white cards.",
  palette: boldPalette,
  fonts: { display: ["Inter", "Mukta"], body: ["Inter", "Mukta"], label: ["Inter", "Mukta"] },
  weight: { display: 800, name: 800, label: 800 },
  displayScale: 1.06,
  displayLineHeight: 1.08,
  primary: () => boldPalette.accent,
  page: () => "#FFFFFF",
  card: (dom, kind) =>
    kind === "item"
      ? { style: { fill: "#FFFFFF", stroke: { colour: tint(dom, 0.72), width_mm: 0.35 }, radius_mm: 3.5 }, accent: { side: "left", size: 2, colour: dom } }
      : { style: { fill: tint(dom, kind === "hero" ? 0.9 : 0.92), radius_mm: 3.5 }, accent: { side: "top", size: kind === "hero" ? 3.2 : 2.2, colour: dom } },
  image: { radius_mm: 2.5, fill: "#FFFFFF", stroke: { colour: "#D5DDE8", width_mm: 0.2 } },
  badge: (dom) => ({ style: { fill: dom, colour: "#FFFFFF" }, square: false }),
  kicker: (dom) => ({ colour: dom }),
  headingBar: false,
  onLight: (dom) => dom,
  callout: (dom) => ({ panel: { fill: tint(dom, 0.88), radius_mm: [0, 3, 3, 0] }, edge: dom }),
  masthead: "band",
  rule: { colour: "#D5DDE8", width: 0.25 },
  table: { header: "#0F1B2D", headerInk: "#FFFFFF", zebra: "#F4F7FB" },
  section: "block",
  hot: HOT,
};

// ---------------------------------------------------------------- Neo-brutalist

const brutalPalette: Palette = {
  paper: "#FFF6E0", ink: "#111111", muted: "#2B2B2B", rule: "#111111", accent: "#FFD23F", accent_ink: "#111111",
  d: { OL: "#FF7A45", SE: "#FF6FAE", DC: "#2BD48A", RF: "#5B9BFF", RC: "#B38CFF", WR: "#FFC21A", GA: "#BDBDBD" },
};
const INK = "#111111";

const brutal: Look = {
  id: "brutal",
  name: "Neo-brutalist",
  blurb: "Cream paper on a dot grid, thick black outlines, hard offset shadows, flat bright colour and sticker labels.",
  palette: brutalPalette,
  fonts: { display: ["Space Grotesk", "Anek Devanagari"], body: ["Space Grotesk", "Mukta"], label: ["Space Mono", "Anek Devanagari"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1.08,
  displayLineHeight: 1.05,
  primary: (domains) => firstDomain(brutalPalette, domains),
  page: () => `radial-gradient(circle, rgba(17,17,17,0.16) 0.32mm, transparent 0.38mm) 0 0 / 5mm 5mm, ${brutalPalette.paper}`,
  card: (dom, kind) =>
    kind === "item"
      ? { style: { fill: "#FFFFFF", stroke: { colour: INK, width_mm: 0.6 }, radius_mm: 0 }, accent: { side: "top", size: 2.6, colour: dom }, hard: { dx: 1.6, dy: 1.6, colour: INK } }
      : kind === "group"
        ? { style: { fill: tint(dom, 0.7), stroke: { colour: INK, width_mm: 0.6 }, radius_mm: 0 }, hard: { dx: 1.8, dy: 1.8, colour: INK } }
        : { style: { fill: tint(dom, 0.35), stroke: { colour: INK, width_mm: 0.7 }, radius_mm: 0 }, hard: { dx: 2.2, dy: 2.2, colour: INK } },
  image: { stroke: { colour: INK, width_mm: 0.5 }, radius_mm: 0, fill: "#FFFFFF" },
  badge: () => ({ style: { fill: INK, colour: "#FFFFFF" }, square: true }),
  kicker: (dom) => ({ colour: INK, chip: { fill: dom, stroke: { colour: INK, width_mm: 0.4 }, radius_mm: 0, padding_mm: [0.6, 1.8, 0.4, 1.8] }, hard: { dx: 0.7, dy: 0.7, colour: INK } }),
  headingBar: false,
  onLight: () => INK,
  callout: (dom) => ({ panel: { fill: tint(dom, 0.78), stroke: { colour: INK, width_mm: 0.4 }, radius_mm: 0 }, hard: { dx: 0.9, dy: 0.9, colour: INK } }),
  masthead: "brutal",
  rule: { colour: INK, width: 0.5 },
  table: { header: INK, headerInk: "#FFFFFF", zebra: "#FFFFFF" },
};

// ---------------------------------------------------------------- Material You

const materialPalette: Palette = {
  paper: "#FFFBFE", ink: "#1C1B1F", muted: "#49454F", rule: "#CAC4D0", accent: "#3F5AA9", accent_ink: "#FFFFFF",
  d: { OL: "#9A4521", SE: "#984061", DC: "#1B6D4C", RF: "#3F5AA9", RC: "#6750A4", WR: "#7C5800", GA: "#5D5F62" },
};

const material: Look = {
  id: "material",
  name: "Material You",
  blurb: "Tonal colour drawn from the competencies covered, big rounded containers, pill labels and a colour hero masthead.",
  palette: materialPalette,
  fonts: { display: ["Bricolage Grotesque", "Baloo 2"], body: ["Roboto", "Noto Sans Devanagari"], label: ["Roboto", "Noto Sans Devanagari"] },
  weight: { display: 700, name: 700, label: 600 },
  displayScale: 1.04,
  displayLineHeight: 1.12,
  primary: (domains) => firstDomain(materialPalette, domains),
  page: (domains) => tint(firstDomain(materialPalette, domains), 0.95),
  card: (dom, kind) => ({ style: { fill: tint(dom, kind === "hero" ? 0.8 : kind === "group" ? 0.88 : 0.85), radius_mm: kind === "item" ? 5.5 : 7 } }),
  image: { radius_mm: 4, fill: "#FFFFFF" },
  badge: (dom) => ({ style: { fill: dom, colour: "#FFFFFF" }, square: false }),
  kicker: (dom) => ({ colour: shade(dom, 0.35), chip: { fill: tint(dom, 0.68), radius_mm: 3, padding_mm: [0.7, 2.4, 0.5, 2.4] } }),
  headingBar: false,
  onLight: (dom) => shade(dom, 0.2),
  callout: () => ({ panel: { fill: "rgba(255,255,255,0.62)", radius_mm: 3.5 } }),
  masthead: "tonal",
  rule: { colour: "#CAC4D0", width: 0.25 },
  table: { header: "#3F5AA9", headerInk: "#FFFFFF", zebra: "rgba(255,255,255,0.55)" },
};

// ---------------------------------------------------------------- Liquid Glass

const glassPalette: Palette = {
  paper: "#F4F6FB", ink: "#0E1726", muted: "#4A5568", rule: "rgba(14,23,38,0.14)", accent: "#2D6BEA", accent_ink: "#FFFFFF",
  d: { OL: "#F0642D", SE: "#E0457B", DC: "#16A66A", RF: "#2D6BEA", RC: "#7B5CF0", WR: "#E39A00", GA: "#6B7280" },
};
const GLASS: Style = {
  fill: "rgba(255,255,255,0.58)",
  stroke: { colour: "rgba(255,255,255,0.95)", width_mm: 0.35 },
  shadow: "0 0.9mm 3.2mm rgba(16,24,40,0.10), 0 0.2mm 0.6mm rgba(16,24,40,0.06)",
};

const glass: Look = {
  id: "glass",
  name: "Liquid Glass",
  blurb: "Frosted, translucent cards floating on a soft colour field, with bright white edges and heavy, clean type.",
  palette: glassPalette,
  fonts: { display: ["Inter", "Noto Sans Devanagari"], body: ["Inter", "Noto Sans Devanagari"], label: ["Inter", "Noto Sans Devanagari"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1,
  displayLineHeight: 1.1,
  primary: (domains) => firstDomain(glassPalette, domains),
  page: (domains) => {
    const c = [...new Set(domains.map((d) => glassPalette.d[d] ?? glassPalette.accent))];
    const [a, b, d] = [c[0] ?? glassPalette.accent, c[1] ?? glassPalette.d.RC, c[2] ?? c[0] ?? glassPalette.d.SE];
    return [
      `radial-gradient(ellipse 70% 45% at 8% 4%, ${a}59 0%, transparent 70%)`,
      `radial-gradient(ellipse 60% 45% at 96% 22%, ${b}4D 0%, transparent 70%)`,
      `radial-gradient(ellipse 70% 50% at 70% 100%, ${d}40 0%, transparent 70%)`,
      `radial-gradient(ellipse 50% 40% at 0% 70%, ${b}2E 0%, transparent 70%)`,
      "linear-gradient(165deg, #EEF2FB 0%, #F7F4FB 100%)",
    ].join(", ");
  },
  card: (_dom, kind) => ({ style: { ...GLASS, radius_mm: kind === "item" ? 5 : 6.5 } }),
  image: { radius_mm: 3.5, fill: "#FFFFFF", stroke: { colour: "rgba(255,255,255,0.95)", width_mm: 0.35 } },
  badge: (dom) => ({ style: { fill: dom, colour: "#FFFFFF" }, square: false }),
  kicker: (dom) => ({ colour: shade(dom, 0.18) }),
  headingBar: true,
  onLight: (dom) => shade(dom, 0.18),
  callout: () => ({ panel: { fill: "rgba(255,255,255,0.6)", stroke: { colour: "rgba(255,255,255,0.95)", width_mm: 0.3 }, radius_mm: 3 } }),
  masthead: "glass",
  rule: { colour: "rgba(14,23,38,0.14)", width: 0.25 },
  table: { header: "rgba(14,23,38,0.86)", headerInk: "#FFFFFF", zebra: "rgba(255,255,255,0.45)" },
};

// ---------------------------------------------------------------- Risograph

const RISO_PINK = "#FF48B0";
const RISO_BLUE = "#0078BF";
const RISO_YELLOW = "#F2A900";
const risoPalette: Palette = {
  paper: "#F6F0E4", ink: "#1D2A6B", muted: "#3F4A7A", rule: "rgba(29,42,107,0.35)", accent: RISO_PINK, accent_ink: "#FFFFFF",
  d: { OL: "#FF6C4A", SE: RISO_PINK, DC: "#00A95C", RF: RISO_BLUE, RC: "#765BA7", WR: RISO_YELLOW, GA: "#88898A" },
};
const risoText = (dom: string) => (dom === RISO_YELLOW ? "#9A6B00" : dom);

const riso: Look = {
  id: "riso",
  name: "Risograph",
  blurb: "Two-ink zine print: fluorescent pink and blue overprinting on warm paper, a touch of grain, and headlines slightly out of register.",
  palette: risoPalette,
  fonts: { display: ["Bricolage Grotesque", "Khand"], body: ["Space Grotesk", "Mukta"], label: ["Space Mono", "Khand"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1.12,
  displayLineHeight: 1.02,
  primary: () => RISO_PINK,
  page: () => `radial-gradient(circle, rgba(29,42,107,0.07) 0.14mm, transparent 0.18mm) 0 0 / 0.9mm 0.9mm, radial-gradient(circle, rgba(255,72,176,0.05) 0.14mm, transparent 0.18mm) 0.45mm 0.45mm / 0.9mm 0.9mm, ${risoPalette.paper}`,
  card: (dom, kind) => ({
    style: { fill: alpha(dom, kind === "item" ? 0.13 : kind === "hero" ? 0.2 : 0.16), radius_mm: 1 },
    hard: { dx: 1.2, dy: 1.2, colour: alpha(dom === RISO_BLUE ? RISO_PINK : RISO_BLUE, 0.18) },
  }),
  image: { radius_mm: 0, fill: "#FFFFFF", opacity: 0.92 },
  badge: (dom) => ({ style: { fill: alpha(dom, 0.9), colour: "#FFFFFF" }, square: false }),
  kicker: (dom) => ({ colour: risoText(dom) }),
  headingBar: false,
  onLight: risoText,
  callout: (dom) => ({ panel: { fill: alpha(dom, 0.2), radius_mm: 0 }, hard: { dx: 0.8, dy: 0.8, colour: alpha(RISO_PINK, 0.25) } }),
  masthead: "riso",
  rule: { colour: "rgba(29,42,107,0.35)", width: 0.3 },
  table: { header: "#1D2A6B", headerInk: "#FFFFFF", zebra: "rgba(255,72,176,0.07)" },
  misregister: { colour: "rgba(255,72,176,0.6)", dx: 0.7, dy: 0.45 },
};

// ---------------------------------------------------------------- Swiss (International Typographic Style)

const SWISS_RED = "#E30613";
const swissPalette: Palette = {
  paper: "#FFFFFF", ink: "#111111", muted: "#555555", rule: "#111111", accent: SWISS_RED, accent_ink: "#FFFFFF",
  d: { OL: SWISS_RED, SE: SWISS_RED, DC: SWISS_RED, RF: SWISS_RED, RC: SWISS_RED, WR: SWISS_RED, GA: SWISS_RED },
};

const swiss: Look = {
  id: "swiss",
  name: "Swiss",
  blurb: "The International Typographic Style: a strict grid, flush-left sans-serif, black on white with one red, big section numbers, rules instead of boxes.",
  palette: swissPalette,
  fonts: { display: ["Inter", "Mukta"], body: ["Inter", "Mukta"], label: ["Inter", "Mukta"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1.05,
  displayLineHeight: 1.05,
  primary: () => SWISS_RED,
  page: () => "#FFFFFF",
  card: (_dom, kind) => ({ style: {}, accent: { side: "top", size: kind === "hero" ? 1.6 : 0.9, colour: "#111111" } }),
  image: { radius_mm: 0 },
  badge: () => ({ style: { fill: SWISS_RED, colour: "#FFFFFF" }, square: true }),
  kicker: () => ({ colour: SWISS_RED }),
  headingBar: false,
  onLight: () => SWISS_RED,
  callout: () => ({ panel: { fill: "#F2F2F2", radius_mm: 0 }, edge: SWISS_RED }),
  masthead: "swiss",
  rule: { colour: "#111111", width: 0.35 },
  table: { header: "#111111", headerInk: "#FFFFFF", zebra: "#F4F4F4" },
  section: "numbered",
  numeral: () => SWISS_RED,
  steps: "numerals",
};

// ---------------------------------------------------------------- Bauhaus

const BH = { red: "#D6312B", blue: "#1F4E9C", yellow: "#F2B705", black: "#161616" };
const bauhausPalette: Palette = {
  paper: "#F1EADB", ink: BH.black, muted: "#3D3D3D", rule: BH.black, accent: BH.red, accent_ink: "#FFFFFF",
  d: { OL: BH.red, SE: BH.yellow, DC: BH.blue, RF: BH.blue, RC: BH.red, WR: BH.yellow, GA: BH.black },
};
const onBH = (dom: string) => (dom === BH.yellow ? BH.black : "#FFFFFF");

const bauhaus: Look = {
  id: "bauhaus",
  name: "Bauhaus",
  blurb: "Primary red, blue and yellow with black, built from circles and squares: a geometric masthead, numbered discs, flat colour edges.",
  palette: bauhausPalette,
  fonts: { display: ["Poppins", "Poppins"], body: ["Poppins", "Mukta"], label: ["Poppins", "Poppins"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1,
  displayLineHeight: 1.1,
  primary: () => BH.red,
  page: () => bauhausPalette.paper,
  card: (dom, kind) =>
    kind === "item"
      ? { style: { fill: "#FFFFFF", radius_mm: 0 }, accent: { side: "top", size: 3, colour: dom } }
      : { style: { fill: kind === "hero" ? "#FFFFFF" : tint(dom, 0.82), radius_mm: 0 }, accent: { side: "left", size: kind === "hero" ? 4 : 3, colour: dom } },
  image: { radius_mm: 0, fill: "#FFFFFF" },
  badge: (dom) => ({ style: { fill: dom, colour: onBH(dom) }, square: false }),
  kicker: (dom) => ({ colour: onBH(dom), chip: { fill: dom, radius_mm: 0, padding_mm: [0.6, 2, 0.4, 2] } }),
  headingBar: false,
  onLight: (dom) => (dom === BH.yellow ? BH.black : dom),
  callout: (dom) => ({ panel: { fill: tint(dom, 0.8), radius_mm: 0 } }),
  masthead: "bauhaus",
  rule: { colour: BH.black, width: 0.5 },
  table: { header: BH.black, headerInk: "#FFFFFF", zebra: "rgba(255,255,255,0.6)" },
  section: "circle",
};

// ---------------------------------------------------------------- Notebook

const notebookPalette: Palette = {
  paper: "#FFFDF6", ink: "#1E2A55", muted: "#4A5578", rule: "rgba(30,42,85,0.25)", accent: "#E03131", accent_ink: "#FFFFFF",
  d: { OL: "#D9480F", SE: "#C2255C", DC: "#2B8A3E", RF: "#1971C2", RC: "#7048E8", WR: "#E67700", GA: "#495057" },
};
const STICKY: Record<string, string> = {
  "#D9480F": "#FFE1CC", "#C2255C": "#FFD9E8", "#2B8A3E": "#D8F5DC", "#1971C2": "#D6ECFF", "#7048E8": "#E7DEFF", "#E67700": "#FFF1B8", "#495057": "#EEF0F2",
};
const sticky = (dom: string) => STICKY[dom] ?? tint(dom, 0.85);

const notebook: Look = {
  id: "notebook",
  name: "Notebook",
  blurb: "A teacher's notebook: ruled paper with a margin line, sticky notes held on with tape, handwritten headings and a highlighter pen.",
  palette: notebookPalette,
  fonts: { display: ["Kalam", "Kalam"], body: ["Inter", "Mukta"], label: ["Kalam", "Kalam"] },
  weight: { display: 700, name: 700, label: 700 },
  displayScale: 1.14,
  displayLineHeight: 1.12,
  primary: () => "#FFE066",
  page: () => [
    "linear-gradient(90deg, transparent 8mm, rgba(224,49,49,0.5) 8mm, rgba(224,49,49,0.5) 8.3mm, transparent 8.3mm)",
    "repeating-linear-gradient(180deg, transparent 0, transparent 7.8mm, rgba(25,113,194,0.2) 7.8mm, rgba(25,113,194,0.2) 8mm)",
    notebookPalette.paper,
  ].join(", "),
  card: (dom, kind) => ({
    style: { fill: sticky(dom), radius_mm: 0.6, shadow: "0 0.8mm 2mm rgba(30,42,85,0.18), 0 0.2mm 0.4mm rgba(30,42,85,0.12)" },
    tape: kind === "group" ? undefined : "rgba(236,225,190,0.85)",
  }),
  image: { radius_mm: 0.4, fill: "#FFFFFF", stroke: { colour: "#FFFFFF", width_mm: 1.3 }, shadow: "0 0.6mm 1.6mm rgba(30,42,85,0.2)" },
  badge: (dom) => ({ style: { fill: "#FFFFFF", colour: dom, stroke: { colour: dom, width_mm: 0.35 } }, square: false }),
  kicker: (dom) => ({ colour: dom }),
  headingBar: false,
  onLight: (dom) => dom,
  callout: () => ({ panel: { fill: "rgba(255,255,255,0.7)", radius_mm: 0.6, stroke: { colour: "rgba(30,42,85,0.3)", width_mm: 0.25, dash: "dashed" } } }),
  masthead: "notebook",
  rule: { colour: "rgba(30,42,85,0.25)", width: 0.3 },
  table: { header: "#1E2A55", headerInk: "#FFFFFF", zebra: "rgba(255,241,184,0.45)" },
  highlighter: "rgba(255,224,102,0.8)",
};

export const LOOKS: Look[] = [brutal, bold, material, glass, riso, swiss, bauhaus, notebook];
export const lookById = new Map(LOOKS.map((l) => [l.id, l]));
export const DEFAULT_LOOK = "brutal";
export const lookOf = (id: string | undefined): Look => lookById.get(id ?? DEFAULT_LOOK) ?? brutal;

/** Palette in the shape older code expects (d_OL …), for the editor's colour swatches. */
export function flatPalette(l: Look): Record<string, string> {
  const { d, ...rest } = l.palette;
  return { ...rest, ...Object.fromEntries(DOMAINS.map((k) => [`d_${k}`, d[k]])) };
}

/**
 * CSS font stacks for a document's language. The primary language's face comes first and supplies every
 * glyph it has (the Hindi faces have Latin too, so a Hindi page keeps one face's digits and spacing); the
 * other face takes over only for the other script, e.g. English glosses in a Hindi document.
 */
export function fontsFor(l: Look, lang: Language): { display: string; body: string; label: string } {
  const stack = ([en, hi]: [string, string]) => (lang === "en" ? `${en}, ${hi}` : `${hi}, ${en}`);
  return { display: stack(l.fonts.display), body: stack(l.fonts.body), label: stack(l.fonts.label) };
}

/** Every family a look uses, in either language. */
export function lookFamilies(l: Look): string[] {
  return [...l.fonts.display, ...l.fonts.body, ...l.fonts.label];
}
