import { useState } from "react";
import type { Element } from "../model/types";
import { moveZAbove, patchElements, type Doc } from "./ops";

const ICON: Record<Element["type"], string> = { text: "T", image: "▣", shape: "■", line: "—", group: "❏" };

function label(e: Element): string {
  if (e.type === "text") return e.content.text.split("\n")[0].slice(0, 42) || e.name || "text";
  return e.name ?? e.type;
}

/** Layers of the current page, top-most first. Drag a row onto another to restack it above that one. */
export function Layers({ doc, pageIndex, selected, setSelected, commit }: {
  doc: Doc; pageIndex: number; selected: string[]; setSelected: (ids: string[]) => void; commit: (fn: (d: Doc) => Doc) => void;
}) {
  const [drag, setDrag] = useState<string>();
  const page = doc.pages[pageIndex];
  if (!page) return null;
  const rows = [...page.elements].sort((a, b) => b.z - a.z);
  return (
    <div className="layers">
      <p className="hint">Page {pageIndex + 1} · {rows.length} layers (top first). Drag to restack; shift-click to multi-select.</p>
      <ol>
        {rows.map((e) => (
          <li key={e.id}
            className={`${selected.includes(e.id) ? "sel" : ""}${e.hidden ? " hid" : ""}`}
            draggable
            onDragStart={() => setDrag(e.id)}
            onDragOver={(ev) => ev.preventDefault()}
            onDrop={() => { if (drag && drag !== e.id) commit((d) => moveZAbove(d, drag, e.id)); setDrag(undefined); }}
            onClick={(ev) => setSelected(ev.shiftKey ? (selected.includes(e.id) ? selected.filter((s) => s !== e.id) : [...selected, e.id]) : [e.id])}>
            <span className="ic" aria-hidden>{ICON[e.type]}</span>
            <span className="nm" title={label(e)}>{label(e)}</span>
            {e.binding && <span className="bound" title="Auto-populated from data">●</span>}
            <button className="x" title={e.hidden ? "Show" : "Hide"} onClick={(ev) => { ev.stopPropagation(); commit((d) => patchElements(d, [e.id], { hidden: !e.hidden })); }}>{e.hidden ? "◌" : "👁"}</button>
            <button className="x" title={e.locked ? "Unlock" : "Lock"} onClick={(ev) => { ev.stopPropagation(); commit((d) => patchElements(d, [e.id], { locked: !e.locked })); }}>{e.locked ? "🔒" : "🔓"}</button>
          </li>
        ))}
      </ol>
    </div>
  );
}
