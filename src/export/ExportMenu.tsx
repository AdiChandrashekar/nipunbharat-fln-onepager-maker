import { useState } from "react";
import type { OnePagerDocument } from "../model/types";
import { downloadBlob, fileStem, WEB } from "../platform";

type Format = { format: "pdf" } | { format: "png"; dpi: 150 | 300 };

/** Toolbar export control: PDF or PNG (150 / 300 dpi), optionally with the print bleed. */
export function ExportMenu({ doc, setMessage }: { doc: OnePagerDocument; setMessage: (m?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [bleed, setBleed] = useState(false);
  const [busy, setBusy] = useState<string>();

  async function run(f: Format) {
    setOpen(false);
    const label = f.format === "pdf" ? "PDF" : `PNG ${f.dpi} dpi`;
    setBusy(label);
    setMessage(undefined);
    try {
      if (WEB) return await runInBrowser(f, label);
      const q = new URLSearchParams({ format: f.format, bleed: bleed && doc.page.bleed_mm > 0 ? "1" : "0" });
      if (f.format === "png") q.set("dpi", String(f.dpi));
      const res = await fetch(`/api/export?${q}`, { method: "POST", body: JSON.stringify(doc) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "onepager";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMessage(`Exported ${label}: ${name} (a copy is in ${res.headers.get("X-Export-Path") ?? "exports/"})`);
    } catch (e) {
      setMessage(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function runInBrowser(f: Format, label: string) {
    const withBleed = bleed && doc.page.bleed_mm > 0;
    const { printToPdf, renderPngs, zipPngs } = await import("./browserExport");
    if (f.format === "pdf") {
      await printToPdf(doc, withBleed);
      setMessage("In the print dialog, choose “Save as PDF” (margins: none, scale 100%). Chrome or Edge give the best result.");
      return;
    }
    const files = await renderPngs(doc, withBleed, f.dpi);
    const name = `${fileStem(doc)}-${f.dpi}dpi.${files.length === 1 ? "png" : "zip"}`;
    const data = files.length === 1 ? files[0].data : zipPngs(files);
    downloadBlob(new Blob([data as BlobPart], { type: files.length === 1 ? "image/png" : "application/zip" }), name);
    setMessage(`Exported ${label}: ${name}`);
  }

  return (
    <span className="export-menu">
      <button className="primary" onClick={() => setOpen(!open)} disabled={!!busy || !doc.pages.length} aria-expanded={open}>
        {busy ? `Exporting ${busy}…` : "Export ▾"}
      </button>
      {open && (
        <div className="export-pop" role="menu">
          <button role="menuitem" onClick={() => run({ format: "pdf" })}>PDF <small>{WEB ? "opens the print dialog: Save as PDF" : "vector, selectable text"}</small></button>
          <button role="menuitem" onClick={() => run({ format: "png", dpi: 150 })}>PNG · 150 dpi <small>screen, sharing</small></button>
          <button role="menuitem" onClick={() => run({ format: "png", dpi: 300 })}>PNG · 300 dpi <small>print</small></button>
          <label className={doc.page.bleed_mm > 0 ? "" : "disabled"} title={doc.page.bleed_mm > 0 ? "" : "Set a bleed in the toolbar first"}>
            <input type="checkbox" checked={bleed && doc.page.bleed_mm > 0} disabled={doc.page.bleed_mm <= 0} onChange={(e) => setBleed(e.target.checked)} />
            Include {doc.page.bleed_mm || 0} mm bleed
          </label>
          <p className="muted small">{doc.pages.length} {doc.pages.length === 1 ? "page" : "pages"}; several PNG pages download as a zip.</p>
        </div>
      )}
    </span>
  );
}
