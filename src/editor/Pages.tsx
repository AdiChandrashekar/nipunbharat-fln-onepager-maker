import { PageView } from "../render/PageView";
import { addPage, deletePage, duplicatePage, movePage, type Doc } from "./ops";

/** Page thumbnails with page operations. Clicking a thumbnail scrolls the canvas to it. */
export function Pages({ doc, current, setCurrent, commit }: {
  doc: Doc; current: number; setCurrent: (i: number) => void; commit: (fn: (d: Doc) => Doc) => void;
}) {
  const scale = 150 / (doc.page.width_mm * 3.78);
  const go = (i: number) => {
    setCurrent(i);
    document.querySelectorAll(".canvas-edit .page-wrap")[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="pages-panel">
      <div className="btns">
        <button onClick={() => { commit((d) => addPage(d, current)); go(current + 1); }}>+ Blank page</button>
        <button onClick={() => commit((d) => duplicatePage(d, current))}>Duplicate</button>
        <button disabled={doc.pages.length <= 1} onClick={() => { commit((d) => deletePage(d, current)); setCurrent(Math.max(0, current - 1)); }}>Delete</button>
      </div>
      {doc.pages.map((p, i) => (
        <div key={p.id} className={`thumb${i === current ? " cur" : ""}`}>
          <button className="thumb-btn" onClick={() => go(i)} aria-label={`Page ${i + 1}`}>
            <PageView page={p} setup={doc.page} scale={scale} />
          </button>
          <div className="thumb-bar">
            <span className="mono">{i + 1}</span>
            <button className="x" disabled={i === 0} onClick={() => { commit((d) => movePage(d, i, i - 1)); setCurrent(i - 1); }} aria-label="Move page up">↑</button>
            <button className="x" disabled={i === doc.pages.length - 1} onClick={() => { commit((d) => movePage(d, i, i + 1)); setCurrent(i + 1); }} aria-label="Move page down">↓</button>
          </div>
        </div>
      ))}
    </div>
  );
}
