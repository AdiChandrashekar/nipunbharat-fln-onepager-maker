import { useEffect, useState } from "react";
import type { OnePagerDocument } from "../model/types";
import { docFamilies, ensureFonts } from "../fonts";
import { PageView } from "../render/PageView";

/**
 * Print/screenshot view used by the exporters: the document's pages, one per printed page, nothing else.
 * The page size comes from the model, so PDF pages are exactly the trim size (plus bleed when requested).
 * `scale` > 1 draws pages magnified, for PNG export at a DPI (captured 1:1 in whole pixels).
 * Sets window.__renderReady once fonts and images have loaded.
 */
export function RenderView({ token, bleed, scale = 1 }: { token: string; bleed: boolean; scale?: number }) {
  const [doc, setDoc] = useState<OnePagerDocument | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch(`/api/render/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`render doc ${r.status}`))))
      .then(setDoc)
      .catch((e) => setError(String(e)));
  }, [token]);

  useEffect(() => {
    if (!doc) return;
    const imgs = [...document.images];
    Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((res) => { i.onload = i.onerror = res; }))))
      .then(() => ensureFonts(docFamilies(doc)))
      .then(() => document.fonts.ready)
      .then(() => requestAnimationFrame(() => { (window as unknown as { __renderReady: boolean }).__renderReady = true; }));
  }, [doc]);

  if (error) return <pre id="render-error">{error}</pre>;
  if (!doc) return null;
  return <RenderPages doc={doc} bleed={bleed} scale={scale} />;
}

/**
 * The pages, one per printed page. `inPage` (web version): mounted inside the editor for window.print(),
 * so the print rules only apply when printing and everything else on the page is hidden then.
 */
export function RenderPages({ doc, bleed, scale = 1, inPage = false }: { doc: OnePagerDocument; bleed: boolean; scale?: number; inPage?: boolean }) {
  const b = bleed ? doc.page.bleed_mm : 0;
  const w = doc.page.width_mm + 2 * b;
  const h = doc.page.height_mm + 2 * b;
  return (
    <>
      <style>{`
        @page { size: ${w}mm ${h}mm; margin: 0; }
        ${inPage ? "@media print { body > *:not(#print-root) { display: none !important; } #print-root { position: static !important; } html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; } }" : "html, body { margin: 0; padding: 0; background: #fff; }"}
        .render-pages .page-shell { break-after: page; page-break-after: always; overflow: hidden; }
        .render-pages .page-shell:last-child { break-after: auto; page-break-after: auto; }
        ${scale !== 1 ? ".render-pages .page-shell { margin-bottom: 16px; }" : ""}
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>
      <div className="render-pages">
        {doc.pages.map((p) => (
          <PageView key={p.id} page={p} setup={doc.page} withBleed={bleed} scale={scale} />
        ))}
      </div>
    </>
  );
}
