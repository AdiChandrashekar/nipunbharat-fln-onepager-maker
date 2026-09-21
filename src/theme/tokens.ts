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
    display: "Tiro Devanagari Hindi",
    body: "Mukta",
    mono: "IBM Plex Mono",
  },
};

/** Fallback appended to every font stack: Noto Sans Devanagari is a Google Font available in Figma and Canva. */
export const FALLBACK_FAMILY = "Noto Sans Devanagari";

export function fontStack(family: string | undefined): string {
  const f = family ?? KOSH_LIGHT.fonts.body;
  return `"${f}", "${FALLBACK_FAMILY}", sans-serif`;
}

/** Families the app bundles (via @fontsource), with the weights loaded. All are Google Fonts. */
export const BUNDLED_FONTS: { family: string; weights: number[] }[] = [
  { family: "Mukta", weights: [400, 500, 600, 700] },
  { family: "Tiro Devanagari Hindi", weights: [400] },
  { family: "IBM Plex Mono", weights: [500] },
  { family: "Noto Sans Devanagari", weights: [400, 500, 600, 700] },
];

/** Soft tint of a domain colour for card backgrounds: mix with white. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}
