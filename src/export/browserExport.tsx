/**
 * Export for the web version (no server, so no headless Chromium):
 * - PDF: the pages are mounted off-screen and the browser's print dialog opens at the exact page size;
 *   choose "Save as PDF". In Chrome / Edge this is the same engine the local exporter uses.
 * - PNG: each page is drawn magnified by dpi/96 and rasterised in the browser (modern-screenshot),
 *   at exactly round(mm / 25.4 × dpi) pixels. Several pages come back as a zip.
 */
import { domToPng } from "modern-screenshot";
import { zipSync } from "fflate";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { OnePagerDocument } from "../model/types";
import { docFamilies, ensureFonts } from "../fonts";
import { RenderPages } from "./RenderView";

async function mount(doc: OnePagerDocument, bleed: boolean, scale: number) {
  const host = document.createElement("div");
  host.id = "print-root";
  host.style.cssText = "position: fixed; left: -100000px; top: 0; background: #fff;";
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<RenderPages doc={doc} bleed={bleed} scale={scale} inPage />));
  const imgs = [...host.querySelectorAll("img")];
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((res) => { i.onload = i.onerror = res; }))));
  await ensureFonts(docFamilies(doc));
  await document.fonts.ready;
  // One frame for layout; the timeout covers background tabs, where animation frames are paused.
  await new Promise((r) => { requestAnimationFrame(() => r(null)); setTimeout(r, 100); });
  return { host, done: () => { root.unmount(); host.remove(); } };
}

export async function printToPdf(doc: OnePagerDocument, bleed: boolean): Promise<void> {
  const { done } = await mount(doc, bleed, 1);
  const prevTitle = document.title;
  document.title = doc.title || "One-pager"; // default file name in "Save as PDF"
  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; document.title = prevTitle; done(); };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 1000); // browsers that don't fire afterprint
}

export async function renderPngs(doc: OnePagerDocument, bleed: boolean, dpi: number): Promise<{ name: string; data: Uint8Array }[]> {
  const scale = dpi / 96;
  const b = bleed ? doc.page.bleed_mm : 0;
  const pxW = Math.round(((doc.page.width_mm + 2 * b) / 25.4) * dpi);
  const pxH = Math.round(((doc.page.height_mm + 2 * b) / 25.4) * dpi);
  const { host, done } = await mount(doc, bleed, scale);
  try {
    const files = [];
    const shells = [...host.querySelectorAll<HTMLElement>(".render-pages .page-shell")];
    for (let i = 0; i < shells.length; i++) {
      const url = await domToPng(shells[i], { width: pxW, height: pxH, scale: 1, backgroundColor: "#ffffff" });
      const bin = atob(url.split(",")[1]);
      const data = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) data[j] = bin.charCodeAt(j);
      files.push({ name: `page-${String(i + 1).padStart(2, "0")}.png`, data });
    }
    return files;
  } finally {
    done();
  }
}

export function zipPngs(files: { name: string; data: Uint8Array }[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.data])), { level: 0 });
}
