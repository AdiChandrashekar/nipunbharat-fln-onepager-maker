// Bundled fonts (no CDN): export then works offline and embeds exactly what the editor shows. All are Google Fonts.
// The CSS only declares the faces; a face downloads when it is first used or loaded (ensureFonts).
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "@fontsource/noto-sans-devanagari/700.css";
import "@fontsource/noto-sans-devanagari/800.css";
import "@fontsource/noto-sans-devanagari/900.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/poppins/900.css";
import "@fontsource/baloo-2/500.css";
import "@fontsource/baloo-2/600.css";
import "@fontsource/baloo-2/700.css";
import "@fontsource/baloo-2/800.css";
import "@fontsource/anek-devanagari/400.css";
import "@fontsource/anek-devanagari/500.css";
import "@fontsource/anek-devanagari/600.css";
import "@fontsource/anek-devanagari/700.css";
import "@fontsource/anek-devanagari/800.css";
import "@fontsource/khand/500.css";
import "@fontsource/khand/600.css";
import "@fontsource/khand/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
import "@fontsource/bricolage-grotesque/400.css";
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/tiro-devanagari-hindi/400.css";
import { lookFamilies, lookOf } from "./looks";
import type { OnePagerDocument } from "./model/types";
import { BUNDLED_FONTS, DEFAULT_FAMILIES } from "./theme/tokens";

const SAMPLE = "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग Aa 12";
const loaded = new Set<string>();

/** Families named in CSS font stacks ("Inter, Mukta") that the app bundles. */
export function familiesIn(stacks: (string | undefined)[]): string[] {
  const known = new Set(BUNDLED_FONTS.map((f) => f.family));
  return [...new Set(stacks.flatMap((s) => (s ?? "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, ""))).filter((f) => known.has(f)))];
}

/** Loads every bundled weight of these families (once), so text measurement sees final metrics. */
export async function ensureFonts(families: string[]): Promise<void> {
  const todo = BUNDLED_FONTS.filter((f) => families.includes(f.family) && !loaded.has(f.family));
  await Promise.all(todo.flatMap(({ family, weights }) => weights.map((w) => document.fonts.load(`${w} 16px "${family}"`, SAMPLE))));
  todo.forEach((f) => loaded.add(f.family));
  await document.fonts.ready;
}

/** Families a document needs: its look's, and any set by hand on its elements. */
export function docFamilies(doc: OnePagerDocument): string[] {
  const l = lookOf(doc.theme.look);
  const els = doc.pages.flatMap((p) => p.elements);
  return familiesIn([...lookFamilies(l), ...els.map((e) => e.style.font_family)]);
}

/** Startup: the standard families (the default look's and the ones older documents use). */
export function fontsReady(): Promise<void> {
  return ensureFonts(DEFAULT_FAMILIES);
}
