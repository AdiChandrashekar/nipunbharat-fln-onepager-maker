import type { Style } from "../model/types";
import { pxToMm } from "../model/units";
import { textCss } from "../render/styles";

/**
 * Measures real rendered text height (mm) for a given box width, using the renderer's own CSS,
 * so Devanagari line heights and shaping are measured, not estimated. Call after fontsReady().
 */
let host: HTMLDivElement | null = null;
const cache = new Map<string, number>();

function getHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, { position: "absolute", left: "-10000px", top: "0", visibility: "hidden", contain: "layout" });
    document.body.appendChild(host);
  }
  return host;
}

export function measureTextHeight(text: string, style: Style, widthMm: number): number {
  const key = `${widthMm.toFixed(3)}|${JSON.stringify(style)}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const el = document.createElement("div");
  const css = textCss(style);
  Object.assign(el.style, css, { width: `${widthMm}mm`, fontSize: css.fontSize, lineHeight: String(css.lineHeight) });
  el.textContent = text;
  getHost().appendChild(el);
  const mm = pxToMm(el.getBoundingClientRect().height);
  el.remove();
  cache.set(key, mm);
  return mm;
}

/** Width the text needs on one line (for chips and labels). */
export function measureTextWidth(text: string, style: Style): number {
  const el = document.createElement("div");
  const css = textCss(style);
  Object.assign(el.style, css, { width: "max-content", whiteSpace: "pre", lineHeight: String(css.lineHeight) });
  el.textContent = text;
  getHost().appendChild(el);
  const mm = pxToMm(el.getBoundingClientRect().width);
  el.remove();
  return mm;
}
