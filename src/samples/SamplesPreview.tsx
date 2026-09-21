import { useEffect, useMemo, useRef, useState } from "react";
import { pageLabel } from "../model/pageSizes";
import type { OnePagerDocument, Orientation, PageSizeId } from "../model/types";
import { PX_PER_MM } from "../model/units";
import { PageView } from "../render/PageView";
import { buildSample } from "./sample";

/** Phase 2 preview: the hand-written sample at A4 portrait, A4 landscape and A5, for checking size and Devanagari. */
const FORMATS: [PageSizeId, Orientation][] = [
  ["A4", "portrait"],
  ["A4", "landscape"],
  ["A5", "portrait"],
];

export function SamplesPreview() {
  const params = new URLSearchParams(location.search);
  const only = params.get("only"); // e.g. ?only=1 shows just A4 landscape
  const docs = useMemo(() => FORMATS.filter((_, i) => only === null || String(i) === only).map(([s, o]) => buildSample(s, o)), [only]);
  const [zoom, setZoom] = useState(Number(params.get("zoom") ?? 0.6));
  const [guides, setGuides] = useState(true);
  const [saved, setSaved] = useState("");

  // ?bare=1: page only, no chrome (used for image renders; export will use the same idea).
  if (params.get("bare")) {
    return (
      <div className="bare">
        {docs.map((d) => <PageView key={d.id} page={d.pages[0]} setup={d.page} scale={zoom} />)}
      </div>
    );
  }

  async function saveAll() {
    for (const d of docs) {
      await fetch(`/api/documents/${d.id}`, { method: "PUT", body: JSON.stringify(d) });
    }
    setSaved(`Saved ${docs.map((d) => `${d.id}.json`).join(", ")} to onepager/documents/`);
  }

  return (
    <div className="preview-app">
      <header className="bar">
        <strong>One-Pager Maker · Phase 2 renderer check</strong>
        <label>
          Zoom <input type="range" min={0.3} max={1.5} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} /> {Math.round(zoom * 100)}%
        </label>
        <label>
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Margin guides
        </label>
        <button onClick={saveAll}>Save sample JSON</button>
        {saved && <span className="muted">{saved}</span>}
      </header>
      <main className="spread">
        {docs.map((d) => (
          <SampleCard key={d.id} doc={d} zoom={zoom} guides={guides} />
        ))}
      </main>
    </div>
  );
}

function SampleCard({ doc, zoom, guides }: { doc: OnePagerDocument; zoom: number; guides: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState("");
  const { page } = doc;

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".page");
    if (!el) return;
    // Layout size is unaffected by the display transform: compare it with the model's mm.
    const cs = getComputedStyle(el);
    const wmm = parseFloat(cs.width) / PX_PER_MM;
    const hmm = parseFloat(cs.height) / PX_PER_MM;
    const overflow = [...el.querySelectorAll<HTMLElement>("[data-el]")].filter((n) => {
      const r = n.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      return r.right > p.right + 0.5 || r.bottom > p.bottom + 0.5;
    }).length;
    setCheck(`DOM ${wmm.toFixed(2)} × ${hmm.toFixed(2)} mm · ${doc.pages[0].elements.length} elements · ${overflow ? `${overflow} outside page` : "all inside page"}`);
  }, [doc, zoom]);

  const m = page.margins_mm;
  const overlay = guides ? (
    <div className="margin-guide" style={{ left: `${m.left}mm`, top: `${m.top}mm`, right: `${m.right}mm`, bottom: `${m.bottom}mm` }} />
  ) : null;

  return (
    <section className="sample" ref={ref}>
      <h2>
        {pageLabel(page)} <span className="muted">· {page.width_mm} × {page.height_mm} mm · margins {m.top} mm</span>
      </h2>
      <p className="muted mono">{check}</p>
      <div className="paper">
        <PageView page={doc.pages[0]} setup={page} scale={zoom} overlay={overlay} />
      </div>
    </section>
  );
}
