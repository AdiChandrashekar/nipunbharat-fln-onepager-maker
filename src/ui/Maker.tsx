import { useEffect, useMemo, useState } from "react";
import { FIELD_NAMES } from "../content/fields";
import { createDocument } from "../doc/newDoc";
import { fitDocument, type FitResult } from "../layout/fit";
import { pageLabel } from "../model/pageSizes";
import type { Element, OnePagerDocument, OptionalField } from "../model/types";
import { PageView } from "../render/PageView";
import { Selector } from "./Selector";
import { Toolbar } from "./Toolbar";
import { Tray } from "./Tray";

const TIER_LABEL = { spacious: "Spacious", standard: "Standard", compact: "Compact" } as const;
const STEP_NOTE = ["", "", "smaller images", "minimum text size"];

/** Items bound on the current pages (used to append only new items when the user keeps a hand-edited layout). */
function boundItems(els: Element[]): Set<string> {
  const out = new Set<string>();
  for (const e of els) {
    if (e.binding?.strategy_id) out.add(e.binding.strategy_id);
    if (e.binding?.routine_id) out.add(e.binding.routine_id);
  }
  return out;
}

export function Maker() {
  const [doc, setDoc] = useState<OnePagerDocument>(() => createDocument());
  const [fit, setFit] = useState<FitResult | null>(null);
  const [pendingReflow, setPendingReflow] = useState(false);
  const [message, setMessage] = useState<string>();
  const [zoom, setZoom] = useState(0.62);

  // Everything that affects auto-population. Pages themselves are not part of the key.
  const fitKey = JSON.stringify([doc.selection, doc.page, doc.language, doc.title, doc.meta.subtitle, doc.meta.organisation,
    doc.meta.author, doc.meta.date, doc.meta.logo_ref, doc.layout.template, doc.layout.tier, doc.layout.fit_pages, doc.layout.forced_fields]);

  useEffect(() => {
    if (doc.layout.manually_edited) {
      setPendingReflow(true);
      return;
    }
    reflow(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function reflow(d: OnePagerDocument) {
    const r = fitDocument(d);
    setFit(r);
    setPendingReflow(false);
    setDoc((cur) => ({
      ...cur,
      pages: r.pages,
      layout: { ...cur.layout, manually_edited: false, resolved: { tier: r.tier, pages: r.pageCount, dropped_fields: r.dropped, overflow: r.overflow } },
    }));
  }

  /** "Keep my layout": leave edited pages alone and lay out only newly selected items on pages after them. */
  function keepAndAppend() {
    const have = boundItems(doc.pages.flatMap((p) => p.elements));
    const fresh = doc.selection.map((g) => ({ ...g, items: g.items.filter((i) => !have.has(i)) })).filter((g) => g.items.length);
    if (fresh.length) {
      const r = fitDocument({ ...doc, selection: fresh });
      setDoc((cur) => ({ ...cur, pages: [...cur.pages, ...r.pages] }));
    }
    setPendingReflow(false);
  }

  const update = (fn: (d: OnePagerDocument) => OnePagerDocument) =>
    setDoc((d) => {
      const n = fn(d);
      return { ...n, meta: { ...n.meta, updated: new Date().toISOString() } };
    });

  const readout = useMemo(() => {
    if (!fit) return "";
    const note = STEP_NOTE[fit.step] ? ` (${STEP_NOTE[fit.step]})` : "";
    return `${TIER_LABEL[fit.tier]}${note} · ${fit.pageCount} ${fit.pageCount === 1 ? "page" : "pages"}, ${pageLabel(doc.page)}`;
  }, [fit, doc.page]);

  const forced = doc.layout.forced_fields ?? [];
  const toggleField = (f: OptionalField) =>
    update((d) => ({ ...d, layout: { ...d.layout, forced_fields: forced.includes(f) ? forced.filter((x) => x !== f) : [...forced, f] } }));

  return (
    <div className="maker">
      <Toolbar doc={doc} update={update} readout={readout} fit={fit} zoom={zoom} setZoom={setZoom} />
      {(fit?.dropped.length || forced.length) ? (
        <div className="fieldbar">
          {fit?.dropped.length ? <span className="muted">Left out to fit — click to switch back on:</span> : null}
          {fit?.dropped.map((f) => (
            <button key={f} className="chip off" onClick={() => toggleField(f)} title="Show this field (may add a page)">+ {FIELD_NAMES[f]}</button>
          ))}
          {forced.length ? <span className="muted">Kept on:</span> : null}
          {forced.map((f) => (
            <button key={f} className="chip on" onClick={() => toggleField(f)} title="Let the fitter drop this field again">✓ {FIELD_NAMES[f]}</button>
          ))}
        </div>
      ) : null}
      {pendingReflow && (
        <div className="banner">
          <span>You've edited this layout by hand. Re-flow it from the data (your edits are replaced), or keep it and add only new items at the end?</span>
          <button onClick={() => reflow({ ...doc, layout: { ...doc.layout, manually_edited: false } })}>Re-flow</button>
          <button onClick={keepAndAppend}>Keep my layout</button>
        </div>
      )}
      <div className="workspace">
        <aside className="panel left">
          <Selector doc={doc} update={update} setMessage={setMessage} />
        </aside>
        <main className="canvas">
          {message && (
            <div className="limit-msg" role="status">
              {message} <button onClick={() => setMessage(undefined)} aria-label="Dismiss">×</button>
            </div>
          )}
          {!doc.selection.length && (
            <div className="empty-hint">Add competencies or strategies on the left. The document lays itself out as you pick.</div>
          )}
          {fit?.overflow && (
            <div className="limit-msg warn">
              {doc.layout.fit_pages !== "auto" && fit.pageCount > doc.layout.fit_pages
                ? `This selection doesn't fit on ${doc.layout.fit_pages} page(s) even at the compact tier and minimum text size.`
                : "One item is taller than a whole column at this size; it runs past the bottom margin."}
            </div>
          )}
          {doc.pages.map((p, i) => (
            <div key={p.id} className="page-wrap">
              <div className="page-label mono">{i + 1}</div>
              <div className="paper">
                <PageView page={p} setup={doc.page} scale={zoom} />
              </div>
            </div>
          ))}
        </main>
        <aside className="panel right">
          <Tray doc={doc} update={update} setMessage={setMessage} />
        </aside>
      </div>
    </div>
  );
}
