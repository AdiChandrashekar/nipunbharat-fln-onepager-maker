import type { Theme } from "../model/types";

/** Flat light palette and type from web/kosh.template.html (no glass/blur: it doesn't print or export). */
export const KOSH_LIGHT: Theme = {
  palette: {
    paper: "#FFFFFF",
    ink: "#15202C",
    muted: "#4C5A6B",
    accent: "#1F4F9A",
    accent_ink: "#FFFFFF",
    tint: "#EDF1F6", // kosh page background, used for soft panels
    rule: "#D5DDE8",
    mark: "#8F5F00", // NIPUN chip text
    mark_bg: "#FBE9C2", // kosh --mark-bg (rgba(240,180,50,.26)) flattened onto white
    d_OL: "#B04E28",
    d_SE: "#A03A6E",
    d_DC: "#2A7553",
    d_RF: "#1F4F9A",
    d_RC: "#6146A3",
    d_WR: "#855F00",
    d_GA: "#4C5A6B",
  },
  fonts: {
    display: "Mukta",
    body: "Mukta",
    mono: "IBM Plex Mono",
  },
};

/** Fallback appended to every font stack: Noto Sans Devanagari is a Google Font available in Figma and Canva. */
export const FALLBACK_FAMILY = "Noto Sans Devanagari";

/**
 * CSS font stack for a style's family. A family may be a list ("Inter, Mukta"): the browser takes each glyph
 * from the first face that has it, so Latin comes from the English face and Devanagari from the Hindi one.
 */
export function fontStack(family: string | undefined): string {
  const fams = (family ?? KOSH_LIGHT.fonts.body).split(",").map((f) => f.trim()).filter(Boolean);
  return [...fams, FALLBACK_FAMILY].map((f) => `"${f}"`).join(", ") + ", sans-serif";
}

/** Families the app bundles (via @fontsource), with the weights loaded. All are Google Fonts. */
export const BUNDLED_FONTS: { family: string; weights: number[]; note: string }[] = [
  { family: "Mukta", weights: [400, 500, 600, 700, 800], note: "Hindi + English: the standard body face" },
  { family: "Noto Sans Devanagari", weights: [400, 500, 600, 700, 800, 900], note: "Hindi: the standard alternative, up to Black" },
  { family: "Poppins", weights: [400, 500, 600, 700, 800, 900], note: "Hindi + English: geometric, heavy weights" },
  { family: "Baloo 2", weights: [500, 600, 700, 800], note: "Hindi + English: rounded, friendly" },
  { family: "Anek Devanagari", weights: [400, 500, 600, 700, 800], note: "Hindi + English: modern, sturdy" },
  { family: "Khand", weights: [500, 600, 700], note: "Hindi + English: condensed display" },
  { family: "Inter", weights: [400, 500, 600, 700, 800, 900], note: "English: neutral UI sans" },
  { family: "Space Grotesk", weights: [400, 500, 600, 700], note: "English: quirky grotesk" },
  { family: "Roboto", weights: [400, 500, 700, 900], note: "English: Material's face" },
  { family: "Bricolage Grotesque", weights: [400, 600, 700, 800], note: "English: expressive display" },
  { family: "Space Mono", weights: [400, 700], note: "English: monospace labels" },
  { family: "IBM Plex Mono", weights: [500], note: "English: monospace (older documents)" },
  { family: "Tiro Devanagari Hindi", weights: [400], note: "Hindi serif (older documents only)" },
];

/** Loaded at startup; other families load when a look or the properties panel first uses them. */
export const DEFAULT_FAMILIES = ["Mukta", "Noto Sans Devanagari", "Inter", "IBM Plex Mono", "Tiro Devanagari Hindi"];

/** Soft tint of a domain colour for card backgrounds: mix with white. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

/** Darker shade of a colour for text on tinted surfaces: mix with black. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}
