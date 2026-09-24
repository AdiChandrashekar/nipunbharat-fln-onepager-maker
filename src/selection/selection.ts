/**
 * Pure functions over the selection tray. Every mutation returns a new array; the UI keeps it in the document.
 */
import { COMPETENCY_TOP_N, MAX_GROUPS, MAX_STRATEGIES } from "../config";
import { routineById, strategies, strategyById, type Strategy } from "../data/compendium";
import type { GroupKind, SelectionGroup } from "../model/types";

export const ROUTINES_GROUP = "DR";

export type Result = { selection: SelectionGroup[]; message?: string };

/** Distinct strategies + routines in the tray (a strategy ticked in two groups counts once). */
export function uniqueItems(sel: SelectionGroup[]): Set<string> {
  return new Set(sel.flatMap((g) => g.items));
}

export function counts(sel: SelectionGroup[]) {
  return { groups: sel.length, items: uniqueItems(sel).size };
}

/** All strategies tagged with a competency, most-used first (the guide's core methods lead). */
export function strategiesForCompetency(cid: string): Strategy[] {
  return strategies
    .filter((s) => s.competency_ids.includes(cid))
    .sort((a, b) => b.frequency_count - a.frequency_count || a.competency_ids.indexOf(cid) - b.competency_ids.indexOf(cid));
}

export function strategiesForBucket(bid: string): Strategy[] {
  return strategies.filter((s) => s.bucket_id === bid).sort((a, b) => b.frequency_count - a.frequency_count);
}

/** Group a strategy belongs to when added on its own. */
export function homeGroup(sel: SelectionGroup[], sid: string): { kind: GroupKind; id: string } {
  const s = strategyById.get(sid)!;
  if (s.type === "general") return { kind: "bucket", id: s.bucket_id! };
  // Prefer a competency already in the tray, else the strategy's primary competency.
  const existing = sel.find((g) => g.kind === "competency" && s.competency_ids.includes(g.id));
  return { kind: "competency", id: existing?.id ?? s.competency_ids[0] };
}

export function limitMessage(kind: "groups" | "items"): string {
  return kind === "groups"
    ? `Limit reached: ${MAX_GROUPS} competency groups per document. Remove a group to add another.`
    : `Limit reached: ${MAX_STRATEGIES} strategies per document. Remove one to add more.`;
}

export function canAddGroup(sel: SelectionGroup[], id: string): string | null {
  if (sel.some((g) => g.id === id)) return null;
  return sel.length >= MAX_GROUPS ? limitMessage("groups") : null;
}

export function canAddItem(sel: SelectionGroup[], itemId: string, groupId: string): string | null {
  const have = uniqueItems(sel);
  if (!have.has(itemId) && have.size >= MAX_STRATEGIES) return limitMessage("items");
  return canAddGroup(sel, groupId);
}

export function addCompetency(sel: SelectionGroup[], cid: string): Result {
  const existing = sel.find((g) => g.id === cid);
  const blocked = canAddGroup(sel, cid);
  if (blocked) return { selection: sel, message: blocked };
  const have = uniqueItems(sel);
  const room = MAX_STRATEGIES - have.size;
  const top = strategiesForCompetency(cid).slice(0, COMPETENCY_TOP_N).map((s) => s.strategy_id);
  // Strategies already in the tray don't use up room: they appear once, with a cross-reference.
  const picked: string[] = [];
  let used = 0;
  for (const sid of top) {
    if (have.has(sid)) picked.push(sid);
    else if (used < room) { picked.push(sid); used++; }
  }
  const skipped = top.length - picked.length;
  const message = skipped ? `${limitMessage("items")} Added ${picked.length} of ${top.length} strategies for ${cid}.` : undefined;
  if (existing) {
    const items = [...existing.items, ...picked.filter((s) => !existing.items.includes(s))];
    return { selection: sel.map((g) => (g === existing ? { ...g, origin: "competency", items } : g)), message };
  }
  return { selection: [...sel, { kind: "competency", id: cid, origin: "competency", items: picked }], message };
}

export function addStrategy(sel: SelectionGroup[], sid: string, toGroup?: string): Result {
  const home = toGroup ? { kind: sel.find((g) => g.id === toGroup)!.kind, id: toGroup } : homeGroup(sel, sid);
  const blocked = canAddItem(sel, sid, home.id);
  if (blocked) return { selection: sel, message: blocked };
  const g = sel.find((x) => x.id === home.id);
  if (g) {
    if (g.items.includes(sid)) return { selection: sel };
    return { selection: sel.map((x) => (x === g ? { ...x, items: [...x.items, sid] } : x)) };
  }
  return { selection: [...sel, { kind: home.kind, id: home.id, origin: "strategy", items: [sid] }] };
}

export function addRoutine(sel: SelectionGroup[], rid: string): Result {
  if (!routineById.has(rid)) return { selection: sel };
  const blocked = canAddItem(sel, rid, ROUTINES_GROUP);
  if (blocked) return { selection: sel, message: blocked };
  const g = sel.find((x) => x.id === ROUTINES_GROUP);
  if (g) {
    if (g.items.includes(rid)) return { selection: sel };
    return { selection: sel.map((x) => (x === g ? { ...x, items: [...x.items, rid] } : x)) };
  }
  return { selection: [...sel, { kind: "routines", id: ROUTINES_GROUP, origin: "strategy", items: [rid] }] };
}

export function removeGroup(sel: SelectionGroup[], gid: string): SelectionGroup[] {
  return sel.filter((g) => g.id !== gid);
}

/** Unticking the last item of an auto-created group removes the group; a whole competency keeps its heading. */
export function removeItem(sel: SelectionGroup[], gid: string, itemId: string): SelectionGroup[] {
  return sel.flatMap((g) => {
    if (g.id !== gid) return [g];
    const items = g.items.filter((i) => i !== itemId);
    return items.length || g.origin === "competency" ? [{ ...g, items }] : [];
  });
}

export function moveGroup(sel: SelectionGroup[], from: number, to: number): SelectionGroup[] {
  const next = [...sel];
  const [g] = next.splice(from, 1);
  next.splice(to, 0, g);
  return next;
}

export function moveItem(sel: SelectionGroup[], gid: string, from: number, to: number): SelectionGroup[] {
  return sel.map((g) => {
    if (g.id !== gid) return g;
    const items = [...g.items];
    const [i] = items.splice(from, 1);
    items.splice(to, 0, i);
    return { ...g, items };
  });
}

/**
 * Tray → document order with de-duplication: a strategy ticked under several groups is shown in full
 * under the first, and as a one-line pointer under the others. `also` lists the other selected groups
 * the strategy serves (its competency tags), for the "also OL2" note.
 */
export interface ResolvedEntry {
  kind: "strategy" | "routine";
  id: string;
  /** Set when this entry is a pointer to the full entry in an earlier group. */
  pointerTo?: string;
  also: string[];
}
export interface ResolvedGroup {
  group: SelectionGroup;
  entries: ResolvedEntry[];
}

export function resolve(sel: SelectionGroup[]): ResolvedGroup[] {
  const firstGroup = new Map<string, string>();
  for (const g of sel) for (const i of g.items) if (!firstGroup.has(i)) firstGroup.set(i, g.id);
  const selectedIds = sel.map((g) => g.id);
  return sel.map((g) => ({
    group: g,
    entries: g.items.map((id) => {
      if (g.kind === "routines") return { kind: "routine", id, also: [] };
      const s = strategyById.get(id)!;
      const first = firstGroup.get(id)!;
      const tagged = new Set([...s.competency_ids, ...(s.bucket_id ? [s.bucket_id] : [])]);
      const also = selectedIds.filter((gid) => gid !== g.id && tagged.has(gid));
      return first === g.id ? { kind: "strategy", id, also } : { kind: "strategy", id, pointerTo: first, also: [] };
    }),
  }));
}

/** What the document covers, for the summary line under the title (shown entries only, no duplicates). */
export function selectionCounts(sel: SelectionGroup[]): { competencies: number; strategies: number; routines: number } {
  const groups = resolve(sel);
  const shown = groups.flatMap((g) => g.entries.filter((e) => !e.pointerTo));
  return {
    competencies: groups.filter((g) => g.group.kind === "competency").length,
    strategies: new Set(shown.filter((e) => e.kind === "strategy").map((e) => e.id)).size,
    routines: new Set(shown.filter((e) => e.kind === "routine").map((e) => e.id)).size,
  };
}
