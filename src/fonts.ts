// Bundled fonts (no CDN): export then works offline and embeds exactly what the editor shows.
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/tiro-devanagari-hindi/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "@fontsource/noto-sans-devanagari/700.css";
import { BUNDLED_FONTS } from "./theme/tokens";

const SAMPLE = "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग Aa";

/** Resolves once every bundled face is loaded, so text measurement and export see final metrics. */
export async function fontsReady(): Promise<void> {
  const loads = BUNDLED_FONTS.flatMap(({ family, weights }) =>
    weights.map((w) => document.fonts.load(`${w} 16px "${family}"`, SAMPLE)),
  );
  await Promise.all(loads);
  await document.fonts.ready;
}
