/**
 * PDF exporter: prints the render view with Chromium. Page size = trim size (+ bleed if requested), taken
 * from the document model via @page; vector text with embedded fonts; one PDF page per document page.
 */
import { openRender } from "./browser";

interface Doc { page: { width_mm: number; height_mm: number; bleed_mm: number } }

export async function exportPdf(origin: string, doc: Doc, opts: { bleed: boolean }): Promise<Buffer> {
  const page = await openRender(origin, doc, { bleed: opts.bleed, scale: 1 });
  try {
    const b = opts.bleed ? doc.page.bleed_mm : 0;
    return await page.pdf({
      width: `${doc.page.width_mm + 2 * b}mm`,
      height: `${doc.page.height_mm + 2 * b}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      tagged: true,
    });
  } finally {
    await page.context().close();
  }
}
