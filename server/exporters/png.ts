/**
 * PNG exporter: screenshots each page of the render view at the chosen DPI (device scale = dpi / 96).
 * One PNG per page; several pages come back as a zip.
 */
import { zipSync } from "fflate";
import { openRender } from "./browser";

interface Doc { page: { width_mm: number; height_mm: number; bleed_mm: number } }

export async function exportPng(origin: string, doc: Doc, opts: { bleed: boolean; dpi: number }): Promise<{ files: { name: string; data: Buffer }[] }> {
  const scale = opts.dpi / 96;
  // Chrome captures whole CSS pixels only, so draw each page magnified by dpi/96 (vector text and art are
  // re-laid out at that size, not upscaled) and capture it 1:1: the output is then exactly
  // round(mm / 25.4 × dpi) pixels, e.g. A4 at 300 dpi = 2480 × 3508.
  const page = await openRender(origin, doc, { bleed: opts.bleed, scale: 1, zoom: scale });
  try {
    const b = opts.bleed ? doc.page.bleed_mm : 0;
    const pxW = Math.round(((doc.page.width_mm + 2 * b) / 25.4) * opts.dpi);
    const pxH = Math.round(((doc.page.height_mm + 2 * b) / 25.4) * opts.dpi);
    const cdp = await page.context().newCDPSession(page);
    const tops = await page.$$eval(".render-pages .page-shell", (ns) => ns.map((n) => n.getBoundingClientRect().top + scrollY));
    const files = [];
    for (let i = 0; i < tops.length; i++) {
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: tops[i], width: pxW, height: pxH, scale: 1 },
      });
      files.push({ name: `page-${String(i + 1).padStart(2, "0")}.png`, data: Buffer.from(shot.data, "base64") });
    }
    return { files };
  } finally {
    await page.context().close();
  }
}

export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(files.map((f) => [f.name, new Uint8Array(f.data)])), { level: 0 }));
}
