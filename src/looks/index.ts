/**
 * Looks: the visual system a document wears, independent of its template (layout). A look sets colours,
 * type, cards, labels, step numbers, callouts, the masthead and the page background. Every template works
 * with every look. Everything a look produces is ordinary elements, so it stays editable and exports as is.
 */
import type { Language, Style } from "../model/types";
import { shade, tint } from "../theme/tokens";

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
  masthead: "band" | "brutal" | "tonal" | "glass";
  rule: { colour: string; width: number };
  table: { header: string; headerInk: string; zebra?: string };
}

const DOMAINS = ["OL", "SE", "DC", "RF", "RC", "WR", "GA"];
const firstDomain = (p: Palette, domains: string[]) => p.d[domains[0]] ?? p.accent;

// ---------------------------------------------------------------- Bold (the kosh, made louder)

const boldPalette: Palette = {
  paper: "#FFFFFF", ink: "#15202C", muted: "#4C5A6B", rule: "#D5DDE8", accent: "#1F4F9A", accent_ink: "#FFFFFF",
  d: { OL: "#B04E28", SE: "#A03A6E", DC: "#2A7553", RF: "#1F4F9A", RC: "#6146A3", WR: "#855F00", GA: "#4C5A6B" },
};

const bold: Look = {
  id: "bold",
  name: "Bold",
  blurb: "The रणनीति कोश look, turned up: a solid colour masthead, heavy Mukta headings, crisp cards with a colour edge.",
  palette: boldPalette,
  fonts: { display: ["Inter", "Mukta"], body: ["Inter", "Mukta"], label: ["Inter", "Mukta"] },
  weight: { display: 800, name: 700, label: 700 },
  displayScale: 1,
  displayLineHeight: 1.12,
  primary: () => boldPalette.accent,
  page: () => "#FFFFFF",
  card: (dom, kind) =>
    kind === "item"
      ? { style: { fill: "#FFFFFF", stroke: { colour: tint(dom, 0.7), width_mm: 0.3 }, radius_mm: 3 }, accent: { side: "left", size: 1.4, colour: dom } }
      : { style: { fill: tint(dom, kind === "hero" ? 0.94 : 0.93), radius_mm: 3 }, accent: { side: "top", size: kind === "hero" ? 2.2 : 1.6, colour: dom } },
  image: { stroke: { colour: "#D5DDE8", width_mm: 0.2 }, radius_mm: 2, fill: "#FFFFFF" },
  badge: (dom) => ({ style: { fill: dom, colour: "#FFFFFF" }, square: false }),
  kicker: (dom) => ({ colour: dom }),
  headingBar: true,
  onLight: (dom) => dom,
  callout: (dom) => ({ panel: { fill: tint(dom, 0.9), radius_mm: [0, 2, 2, 0] }, edge: dom }),
  masthead: "band",
  rule: { colour: "#D5DDE8", width: 0.25 },
  table: { header: "#15202C", headerInk: "#FFFFFF", zebra: "#F6F8FB" },
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

export const LOOKS: Look[] = [bold, brutal, material, glass];
export const lookById = new Map(LOOKS.map((l) => [l.id, l]));
export const DEFAULT_LOOK = "bold";
export const lookOf = (id: string | undefined): Look => lookById.get(id ?? DEFAULT_LOOK) ?? bold;

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
