import { useState } from "react";
import { MAX_GROUPS, MAX_STRATEGIES } from "../config";
import { groupText } from "../content/fields";
import { routineById, strategyById } from "../data/compendium";
import type { OnePagerDocument, SelectionGroup } from "../model/types";
import {
  addStrategy, canAddItem, counts, moveGroup, moveItem, removeGroup, removeItem, resolve, strategiesForBucket, strategiesForCompetency,
} from "../selection/selection";

interface Props {
  doc: OnePagerDocument;
  update: (fn: (d: OnePagerDocument) => OnePagerDocument) => void;
  setMessage: (m?: string) => void;
}

type Drag = { kind: "group"; from: number } | { kind: "item"; gid: string; from: number } | null;

function itemName(g: SelectionGroup, id: string) {
  if (g.kind === "routines") return routineById.get(id)!.routine_name_hindi;
  return strategyById.get(id)!.strategy_name_hindi;
}

export function Tray({ doc, update, setMessage }: Props) {
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string>("");
  const [open, setOpen] = useState<string>("");
  const sel = doc.selection;
  const c = counts(sel);
  const resolved = resolve(sel);
  const setSel = (s: SelectionGroup[]) => update((d) => ({ ...d, selection: s }));

  return (
    <div className="tray">
      <h2>Selection</h2>
      <p className="counts mono">
        <span className={c.groups >= MAX_GROUPS ? "full" : ""}>{c.groups}/{MAX_GROUPS} groups</span> ·{" "}
        <span className={c.items >= MAX_STRATEGIES ? "full" : ""}>{c.items}/{MAX_STRATEGIES} strategies</span>
      </p>
      {!sel.length && <p className="hint">Nothing selected yet.</p>}
      <p className="hint">Drag to reorder; the document follows this order.</p>
      {resolved.map(({ group: g, entries }, gi) => {
        const gt = groupText(g, "hi");
        const more = g.kind === "competency" ? strategiesForCompetency(g.id) : g.kind === "bucket" ? strategiesForBucket(g.id) : [];
        const extra = more.filter((s) => !g.items.includes(s.strategy_id));
        return (
          <section key={g.id}
            className={`tray-group${over === `g${gi}` ? " drop" : ""}`}
            onDragOver={(e) => { if (drag?.kind === "group") { e.preventDefault(); setOver(`g${gi}`); } }}
            onDragLeave={() => setOver("")}
            onDrop={() => { if (drag?.kind === "group") setSel(moveGroup(sel, drag.from, gi)); setDrag(null); setOver(""); }}>
            <header draggable onDragStart={() => setDrag({ kind: "group", from: gi })} onDragEnd={() => setDrag(null)}>
              <span className="grip" aria-hidden>⠿</span>
              <span className="code" data-d={gt.domain}>{gt.code}</span>
              <span className="pick-name">{gt.name}<small>{g.origin === "competency" ? "whole competency" : "added via a strategy"}</small></span>
              <button className="x" onClick={() => setSel(removeGroup(sel, g.id))} aria-label={`Remove ${gt.code}`}>×</button>
            </header>
            <ol>
              {entries.map((e, ii) => (
                <li key={e.id}
                  draggable
                  className={over === `${g.id}:${ii}` ? "drop" : ""}
                  onDragStart={(ev) => { ev.stopPropagation(); setDrag({ kind: "item", gid: g.id, from: ii }); }}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(ev) => { if (drag?.kind === "item" && drag.gid === g.id) { ev.preventDefault(); ev.stopPropagation(); setOver(`${g.id}:${ii}`); } }}
                  onDrop={(ev) => { if (drag?.kind === "item" && drag.gid === g.id) { ev.stopPropagation(); setSel(moveItem(sel, g.id, drag.from, ii)); } setDrag(null); setOver(""); }}>
                  <span className="grip" aria-hidden>⠿</span>
                  <span className="pick-name">
                    {itemName(g, e.id)}
                    {e.pointerTo && <small>shown under {e.pointerTo}; a cross-reference appears here</small>}
                    {!e.pointerTo && e.also.length > 0 && <small>also serves {e.also.join(", ")}</small>}
                  </span>
                  <button className="x" onClick={() => setSel(removeItem(sel, g.id, e.id))} aria-label="Remove">×</button>
                </li>
              ))}
            </ol>
            {extra.length > 0 && (
              <div className="more">
                <button className="link" onClick={() => setOpen(open === g.id ? "" : g.id)}>
                  {open === g.id ? "Hide" : `+ ${extra.length} more ${g.kind === "bucket" ? "in this bucket" : "for " + g.id}`}
                </button>
                {open === g.id && extra.map((s) => {
                  const blocked = canAddItem(sel, s.strategy_id, g.id);
                  return (
                    <label key={s.strategy_id} className={blocked ? "disabled" : ""} title={blocked ?? ""}>
                      <input type="checkbox" checked={false} disabled={!!blocked}
                        onChange={() => { const r = addStrategy(sel, s.strategy_id, g.id); setSel(r.selection); setMessage(r.message); }} />
                      {s.strategy_name_hindi} <small className="muted">{s.frequency_count ? `${s.frequency_count} days` : "method chapter"}</small>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
