import { useMemo, useState } from "react";
import { buckets, domains, routines, strategies, type Strategy } from "../data/compendium";
import type { OnePagerDocument } from "../model/types";
import {
  addCompetency, addRoutine, addStrategy, canAddGroup, canAddItem, homeGroup, limitMessage, strategiesForCompetency, uniqueItems,
} from "../selection/selection";
import { COMPETENCY_TOP_N, MAX_GROUPS, MAX_STRATEGIES } from "../config";

interface Props {
  doc: OnePagerDocument;
  update: (fn: (d: OnePagerDocument) => OnePagerDocument) => void;
  setMessage: (m?: string) => void;
}

type Tab = "competencies" | "strategies" | "routines";

/** Lower-cased search text per strategy: both languages, how-tos and ids. */
const haystack = new Map(strategies.map((s) => [s.strategy_id, [s.strategy_id, s.strategy_name_hindi, s.strategy_name_english,
  s.how_to_hindi, s.how_to_english, s.competency_ids.join(" "), s.bucket_id ?? ""].join(" ").toLowerCase()]));

const weekOf = (s: Strategy) => new Set(s.source_refs.map((r) => Number(/^W(\d+)/.exec(r)?.[1])).filter(Boolean));

export function Selector({ doc, update, setMessage }: Props) {
  const [tab, setTab] = useState<Tab>("competencies");
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [comp, setComp] = useState("");
  const [week, setWeek] = useState("");
  const sel = doc.selection;
  const have = uniqueItems(sel);

  const apply = (r: { selection: OnePagerDocument["selection"]; message?: string }) => {
    update((d) => ({ ...d, selection: r.selection }));
    setMessage(r.message);
  };

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return strategies
      .filter((s) => words.every((w) => haystack.get(s.strategy_id)!.includes(w)))
      .filter((s) => !domain || (domain === "GA" ? s.type === "general" : s.competency_ids.some((c) => c.startsWith(domain))))
      .filter((s) => !comp || s.competency_ids.includes(comp) || s.bucket_id === comp)
      .filter((s) => !week || weekOf(s).has(+week))
      .sort((a, b) => b.frequency_count - a.frequency_count);
  }, [q, domain, comp, week]);

  const groupsFull = sel.length >= MAX_GROUPS;
  const itemsFull = have.size >= MAX_STRATEGIES;

  return (
    <div className="selector">
      <div className="tabs" role="tablist">
        {(["competencies", "strategies", "routines"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "competencies" ? "Competencies" : t === "strategies" ? "Strategies" : "Routines"}
          </button>
        ))}
      </div>
      {(groupsFull || itemsFull) && (
        <p className="limit-note">{groupsFull ? limitMessage("groups") : limitMessage("items")}</p>
      )}

      {tab === "competencies" && (
        <div className="list">
          <p className="hint">Adding a competency brings in its heading and its top {COMPETENCY_TOP_N} strategies by use in the guide.</p>
          {domains.map((d) => (
            <section key={d.domain_id}>
              <h3 style={{ color: `var(--d-${d.domain_id})` }}>{d.domain_name_hindi} <span className="muted">· {d.domain_name_english}</span></h3>
              {d.competencies.map((c) => {
                const inTray = sel.find((g) => g.id === c.competency_id);
                const blocked = canAddGroup(sel, c.competency_id) ?? (itemsFull ? limitMessage("items") : null);
                const n = strategiesForCompetency(c.competency_id).length;
                return (
                  <div key={c.competency_id} className="pick">
                    <span className="code" data-d={d.domain_id}>{c.competency_id}</span>
                    <span className="pick-name">
                      {c.competency_name_hindi}
                      <small>{c.competency_name_english} · {n} {n === 1 ? "strategy" : "strategies"}{c.nipun_codes.length ? ` · ${c.nipun_codes.join(", ")}` : ""}</small>
                    </span>
                    <button disabled={inTray?.origin === "competency" || !!blocked} title={blocked ?? (inTray?.origin === "competency" ? "Already in the tray" : "Add competency")}
                      onClick={() => apply(addCompetency(sel, c.competency_id))}>
                      {inTray?.origin === "competency" ? "✓" : "+"}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {tab === "strategies" && (
        <div className="list">
          <input className="search" type="search" placeholder="Search Hindi or English: ब्लेंडिंग, dictation, poster…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="filters">
            <select value={domain} onChange={(e) => { setDomain(e.target.value); setComp(""); }} aria-label="Domain">
              <option value="">All domains</option>
              {domains.map((d) => <option key={d.domain_id} value={d.domain_id}>{d.domain_id} · {d.domain_name_english}</option>)}
              <option value="GA">General activities</option>
            </select>
            <select value={comp} onChange={(e) => setComp(e.target.value)} aria-label="Competency or bucket">
              <option value="">All competencies</option>
              {domains.filter((d) => !domain || d.domain_id === domain).flatMap((d) => d.competencies).map((c) => (
                <option key={c.competency_id} value={c.competency_id}>{c.competency_id} · {c.competency_name_english}</option>
              ))}
              {(!domain || domain === "GA") && buckets.map((b) => <option key={b.bucket_id} value={b.bucket_id}>{b.bucket_name_english}</option>)}
            </select>
            <select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
              <option value="">Any week</option>
              {Array.from({ length: 25 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
            </select>
          </div>
          <p className="hint">{list.length} of {strategies.length} strategies</p>
          {list.map((s) => {
            const home = homeGroup(sel, s.strategy_id);
            const blocked = have.has(s.strategy_id) ? null : canAddItem(sel, s.strategy_id, home.id);
            return (
              <div key={s.strategy_id} className="pick">
                <span className="pick-name">
                  {s.strategy_name_hindi}
                  <small>
                    {s.strategy_name_english} · {(s.type === "general" ? [s.bucket_id!.replace("GA-", "")] : s.competency_ids).join(" ")}
                    {s.frequency_count ? ` · ${s.frequency_count} days` : ""}
                  </small>
                </span>
                <button disabled={have.has(s.strategy_id) || !!blocked} title={blocked ?? (have.has(s.strategy_id) ? "Already in the tray" : `Add under ${home.id}`)}
                  onClick={() => apply(addStrategy(sel, s.strategy_id))}>
                  {have.has(s.strategy_id) ? "✓" : "+"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "routines" && (
        <div className="list">
          <p className="hint">Differentiation routines are added under their own heading.</p>
          {routines.map((r) => {
            const blocked = have.has(r.routine_id) ? null : canAddItem(sel, r.routine_id, "DR");
            return (
              <div key={r.routine_id} className="pick">
                <span className="code" data-d="GA">{r.routine_id}</span>
                <span className="pick-name">{r.routine_name_hindi}<small>{r.routine_name_english}</small></span>
                <button disabled={have.has(r.routine_id) || !!blocked} title={blocked ?? "Add routine"} onClick={() => apply(addRoutine(sel, r.routine_id))}>
                  {have.has(r.routine_id) ? "✓" : "+"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
