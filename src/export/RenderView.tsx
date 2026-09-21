import { useEffect, useState } from "react";
import type { OnePagerDocument } from "../model/types";
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
      .then(() => document.fonts.ready)
      .then(() => requestAnimationFrame(() => { (window as unknown as { __renderReady: boolean }).__renderReady = true; }));
  }, [doc]);

  if (error) return <pre id="render-error">{error}</pre>;
  if (!doc) return null;
  const b = bleed ? doc.page.bleed_mm : 0;
  const w = doc.page.width_mm + 2 * b;
  const h = doc.page.height_mm + 2 * b;
  return (
    <>
      <style>{`
        @page { size: ${w}mm ${h}mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
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
