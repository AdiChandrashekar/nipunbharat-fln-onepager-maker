import type { ReactNode } from "react";
import { label } from "../content/fields";
import { uploadImage } from "../editor/ImageLibrary";
import { makePage, PAGE_SIZES } from "../model/pageSizes";
import type { Language, OnePagerDocument, Orientation, PageSizeId, Tier } from "../model/types";
import { familiesIn, ensureFonts } from "../fonts";
import { LOOKS, lookFamilies, lookOf } from "../looks";
import { TEMPLATES } from "../templates";

interface Props {
  doc: OnePagerDocument;
  /** mergeKey groups rapid edits (typing) into one undo step. */
  update: (fn: (d: OnePagerDocument) => OnePagerDocument, mergeKey?: string) => void;
  readout: string;
  overflow: boolean;
  actions?: ReactNode;
}

const LANGS: [Language, string][] = [["hi", "हिंदी"], ["en", "English"], ["bi", "द्विभाषी"]];

export function Toolbar({ doc, update, readout, overflow, actions }: Props) {
  const p = doc.page;
  const setPage = (size: PageSizeId, orientation: Orientation, custom?: { w: number; h: number }) =>
    update((d) => {
      const next = makePage(size, orientation, { custom: custom ?? (size === "custom" ? { w: d.page.width_mm, h: d.page.height_mm } : undefined), bleed_mm: d.page.bleed_mm });
      return { ...d, page: next };
    });
  const setLayout = (patch: Partial<OnePagerDocument["layout"]>) => update((d) => ({ ...d, layout: { ...d.layout, ...patch } }));
  const setMeta = (patch: Partial<OnePagerDocument["meta"]>, key?: string) => update((d) => ({ ...d, meta: { ...d.meta, ...patch } }), key);

  return (
    <header className="toolbar">
      <div className="row">
        <strong className="brand">One-Pager Maker</strong>
        {actions}
        <input className="title-input" value={doc.title} placeholder={label("defaultTitle", doc.language)}
          onChange={(e) => update((d) => ({ ...d, title: e.target.value }), "title")} aria-label="Title" />
        <input className="sub-input" value={doc.meta.subtitle} placeholder="Subtitle (optional)"
          onChange={(e) => setMeta({ subtitle: e.target.value }, "subtitle")} aria-label="Subtitle" />
        <span className={`readout mono${overflow ? " warn" : ""}`} aria-live="polite">{readout}</span>
      </div>
      <div className="row controls">
        <label>Template
          <select value={doc.layout.template} onChange={(e) => setLayout({ template: e.target.value })}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id} title={t.description}>{t.name.en} · {t.name.hi}</option>)}
          </select>
        </label>
        <label>Look
          <select value={lookOf(doc.theme.look).id} title={lookOf(doc.theme.look).blurb} onChange={async (e) => {
            const l = lookOf(e.target.value);
            // Load the look's faces first, so the re-fit measures with them.
            await ensureFonts(familiesIn(lookFamilies(l)));
            update((d) => ({ ...d, theme: { ...d.theme, look: l.id } }));
          }}>
            {LOOKS.map((l) => <option key={l.id} value={l.id} title={l.blurb}>{l.name}</option>)}
          </select>
        </label>
        <label>Page
          <select value={p.size} onChange={(e) => setPage(e.target.value as PageSizeId, p.orientation)}>
            {Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="custom">Custom (mm)</option>
          </select>
        </label>
        {p.size === "custom" && (
          <span className="custom-size">
            <input type="number" min={50} max={1200} value={p.width_mm} aria-label="Width mm"
              onChange={(e) => setPage("custom", p.orientation, { w: +e.target.value, h: p.height_mm })} />
            ×
            <input type="number" min={50} max={1200} value={p.height_mm} aria-label="Height mm"
              onChange={(e) => setPage("custom", p.orientation, { w: p.width_mm, h: +e.target.value })} /> mm
          </span>
        )}
        <div className="seg" role="group" aria-label="Orientation">
          {(["portrait", "landscape"] as Orientation[]).map((o) => (
            <button key={o} aria-pressed={p.orientation === o} onClick={() => setPage(p.size, o)}>{o === "portrait" ? "Portrait" : "Landscape"}</button>
          ))}
        </div>
        <label>Margins
          <input type="number" min={0} max={40} step={0.5} value={p.margins_mm.top}
            onChange={(e) => { const v = +e.target.value; update((d) => ({ ...d, page: { ...d.page, margins_mm: { top: v, right: v, bottom: v, left: v } } })); }} /> mm
        </label>
        <label>Bleed
          <input type="number" min={0} max={10} step={0.5} value={p.bleed_mm}
            onChange={(e) => update((d) => ({ ...d, page: { ...d.page, bleed_mm: +e.target.value } }))} /> mm
        </label>
        <div className="seg" role="group" aria-label="Language">
          {LANGS.map(([l, name]) => (
            <button key={l} aria-pressed={doc.language === l}
              onClick={() => update((d) => ({ ...d, language: l, meta: { ...d.meta, subtitle: d.meta.subtitle === label("defaultSubtitle", d.language) ? label("defaultSubtitle", l) : d.meta.subtitle } }))}>{name}</button>
          ))}
        </div>
        <label>Tier
          <select value={doc.layout.tier} onChange={(e) => setLayout({ tier: e.target.value as "auto" | Tier })}>
            <option value="auto">Auto</option>
            <option value="spacious">Spacious</option>
            <option value="standard">Standard</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label>Pages
          <select value={String(doc.layout.fit_pages)} onChange={(e) => setLayout({ fit_pages: e.target.value === "auto" ? "auto" : +e.target.value })}>
            <option value="auto">Auto (fewest)</option>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Fit to {n}</option>)}
          </select>
        </label>
      </div>
      <div className="row details">
        <input value={doc.meta.organisation} placeholder="Organisation" onChange={(e) => setMeta({ organisation: e.target.value }, "org")} aria-label="Organisation" />
        <input value={doc.meta.author} placeholder="Author" onChange={(e) => setMeta({ author: e.target.value }, "author")} aria-label="Author" />
        <input value={doc.meta.date} placeholder="Date" onChange={(e) => setMeta({ date: e.target.value }, "date")} aria-label="Date" />
        <label className="file-btn">
          {doc.meta.logo_ref ? "Replace logo…" : "Add logo…"}
          <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const img = await uploadImage(f);
              setMeta({ logo_ref: img.image_ref, logo_px: img.natural_px });
            } catch (err) { alert((err as Error).message); }
            e.target.value = "";
          }} />
        </label>
        {doc.meta.logo_ref && <button onClick={() => setMeta({ logo_ref: undefined, logo_px: undefined })}>Remove logo</button>}
      </div>
    </header>
  );
}
