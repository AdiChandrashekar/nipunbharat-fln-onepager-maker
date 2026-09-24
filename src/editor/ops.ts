/**
 * Pure document edits for the editor. Each returns a new document; the caller commits it to history.
 * Any edit to page content marks the layout as hand-edited, so auto re-flow asks before overwriting.
 */
import { alsoText, continuedText, domainName, groupText, howToSteps, itemText, label, pointerText, summaryText } from "../content/fields";
import { imageById, imagesForRoutine, imagesForStrategy } from "../data/compendium";
import { measureTextHeight } from "../layout/measure";
import type { Binding, Element, OnePagerDocument, Page, Style } from "../model/types";
import { uid } from "../model/units";
import { resolve, selectionCounts } from "../selection/selection";

export type Doc = OnePagerDocument;

const edited = (d: Doc): Doc => ({ ...d, layout: { ...d.layout, manually_edited: true } });

export function findElement(d: Doc, id: string): { page: Page; pageIndex: number; el: Element } | undefined {
  for (let i = 0; i < d.pages.length; i++) {
    const el = d.pages[i].elements.find((e) => e.id === id);
    if (el) return { page: d.pages[i], pageIndex: i, el };
  }
}

export function mapElements(d: Doc, ids: string[], fn: (e: Element) => Element): Doc {
  const set = new Set(ids);
  return edited({
    ...d,
    pages: d.pages.map((p) => (p.elements.some((e) => set.has(e.id)) ? { ...p, elements: p.elements.map((e) => (set.has(e.id) ? fn(e) : e)) } : p)),
  });
}

export function patchElements(d: Doc, ids: string[], patch: Partial<Element>): Doc {
  return mapElements(d, ids, (e) => ({ ...e, ...patch }) as Element);
}

export function patchStyle(d: Doc, ids: string[], style: Partial<Style>): Doc {
  return mapElements(d, ids, (e) => ({ ...e, style: { ...e.style, ...style } }) as Element);
}

/** Text edits grow the box when the new text no longer fits (never shrink: the user may have sized it). */
export function setText(d: Doc, id: string, text: string): Doc {
  return mapElements(d, [id], (e) => {
    if (e.type !== "text") return e;
    const need = measureTextHeight(text || " ", e.style, e.w_mm);
    return { ...e, content: { text }, h_mm: Math.max(e.h_mm, Math.round(need * 100) / 100) };
  });
}

export function addElement(d: Doc, pageIndex: number, el: Omit<Element, "id" | "z">): { doc: Doc; id: string } {
  const id = uid();
  const page = d.pages[pageIndex];
  const z = Math.max(100, ...page.elements.map((e) => e.z)) + 1;
  const full = { ...el, id, z } as Element;
  return { doc: edited({ ...d, pages: d.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, full] } : p)) }), id };
}

export function deleteElements(d: Doc, ids: string[]): Doc {
  const set = new Set(ids);
  return edited({ ...d, pages: d.pages.map((p) => ({ ...p, elements: p.elements.filter((e) => !set.has(e.id)) })) });
}

function cloneWithNewIds(e: Element): Element {
  const c = { ...e, id: uid() } as Element;
  if (c.type === "group") c.content = { children: c.content.children.map(cloneWithNewIds) };
  return c;
}

export function duplicateElements(d: Doc, ids: string[]): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  const newIds: string[] = [];
  const pages = d.pages.map((p) => {
    const dup = p.elements.filter((e) => set.has(e.id));
    if (!dup.length) return p;
    let z = Math.max(...p.elements.map((e) => e.z));
    const copies = dup.map((e) => {
      const c = { ...cloneWithNewIds(e), x_mm: e.x_mm + 4, y_mm: e.y_mm + 4, z: ++z, locked: false } as Element;
      newIds.push(c.id);
      return c;
    });
    return { ...p, elements: [...p.elements, ...copies] };
  });
  return { doc: edited({ ...d, pages }), ids: newIds };
}

/**
 * Paste copies of `els` onto a page: at `at` (their bounding box's top-left goes there) or offset 5 mm
 * from where they were. Copies get new ids, sit on top of the stack and are unlocked.
 */
export function pasteElements(d: Doc, pageIndex: number, els: Element[], at?: { x: number; y: number }): { doc: Doc; ids: string[] } {
  if (!els.length || !d.pages[pageIndex]) return { doc: d, ids: [] };
  const x0 = Math.min(...els.map((e) => e.x_mm)), y0 = Math.min(...els.map((e) => e.y_mm));
  const dx = at ? at.x - x0 : 5, dy = at ? at.y - y0 : 5;
  const page = d.pages[pageIndex];
  let z = Math.max(100, ...page.elements.map((e) => e.z));
  const copies = els.map((e) => ({ ...cloneWithNewIds(e), x_mm: Math.round((e.x_mm + dx) * 100) / 100, y_mm: Math.round((e.y_mm + dy) * 100) / 100, z: ++z, locked: false }) as Element);
  return {
    doc: edited({ ...d, pages: d.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, ...copies] } : p)) }),
    ids: copies.map((c) => c.id),
  };
}

export type ZMove = "front" | "back" | "forward" | "backward";

export function reorderZ(d: Doc, id: string, move: ZMove): Doc {
  const f = findElement(d, id);
  if (!f) return d;
  const sorted = [...f.page.elements].sort((a, b) => a.z - b.z);
  const i = sorted.findIndex((e) => e.id === id);
  const [el] = sorted.splice(i, 1);
  const to = move === "front" ? sorted.length : move === "back" ? 0 : move === "forward" ? Math.min(sorted.length, i + 1) : Math.max(0, i - 1);
  sorted.splice(to, 0, el);
  const zOf = new Map(sorted.map((e, k) => [e.id, k + 1]));
  return edited({ ...d, pages: d.pages.map((p) => (p === f.page ? { ...p, elements: p.elements.map((e) => ({ ...e, z: zOf.get(e.id)! }) as Element) } : p)) });
}

/** Layers-panel drag: place `id` directly above `targetId` in the stack. */
export function moveZAbove(d: Doc, id: string, targetId: string): Doc {
  const f = findElement(d, id);
  if (!f || id === targetId) return d;
  const sorted = [...f.page.elements].sort((a, b) => a.z - b.z).filter((e) => e.id !== id);
  const t = sorted.findIndex((e) => e.id === targetId);
  sorted.splice(t + 1, 0, f.el);
  const zOf = new Map(sorted.map((e, k) => [e.id, k + 1]));
  return edited({ ...d, pages: d.pages.map((p) => (p === f.page ? { ...p, elements: p.elements.map((e) => ({ ...e, z: zOf.get(e.id)! }) as Element) } : p)) });
}

export function groupElements(d: Doc, ids: string[]): { doc: Doc; id?: string } {
  const f = findElement(d, ids[0]);
  if (!f || ids.length < 2) return { doc: d };
  const members = f.page.elements.filter((e) => ids.includes(e.id));
  const x = Math.min(...members.map((e) => e.x_mm)), y = Math.min(...members.map((e) => e.y_mm));
  const x2 = Math.max(...members.map((e) => e.x_mm + e.w_mm)), y2 = Math.max(...members.map((e) => e.y_mm + e.h_mm));
  const id = uid();
  const group: Element = {
    id, name: "group", type: "group", x_mm: x, y_mm: y, w_mm: x2 - x, h_mm: y2 - y, rotation: 0,
    z: Math.max(...members.map((e) => e.z)), locked: false, style: {},
    content: { children: members.map((e) => ({ ...e, x_mm: e.x_mm - x, y_mm: e.y_mm - y }) as Element) },
  };
  const rest = f.page.elements.filter((e) => !ids.includes(e.id));
  return { doc: edited({ ...d, pages: d.pages.map((p) => (p === f.page ? { ...p, elements: [...rest, group] } : p)) }), id };
}

export function ungroup(d: Doc, id: string): { doc: Doc; ids: string[] } {
  const f = findElement(d, id);
  if (!f || f.el.type !== "group") return { doc: d, ids: [] };
  const g = f.el;
  const kids = g.content.children.map((c) => ({ ...c, x_mm: c.x_mm + g.x_mm, y_mm: c.y_mm + g.y_mm, z: g.z }) as Element);
  const rest = f.page.elements.filter((e) => e.id !== id);
  return { doc: edited({ ...d, pages: d.pages.map((p) => (p === f.page ? { ...p, elements: [...rest, ...kids] } : p)) }), ids: kids.map((k) => k.id) };
}

// ---------------------------------------------------------------- pages

export function addPage(d: Doc, after: number): Doc {
  const pages = [...d.pages];
  pages.splice(after + 1, 0, { id: uid("page"), elements: [] });
  return edited({ ...d, pages });
}

export function duplicatePage(d: Doc, index: number): Doc {
  const src = d.pages[index];
  const pages = [...d.pages];
  pages.splice(index + 1, 0, { ...src, id: uid("page"), elements: src.elements.map(cloneWithNewIds) });
  return edited({ ...d, pages });
}

export function deletePage(d: Doc, index: number): Doc {
  if (d.pages.length <= 1) return d;
  return edited({ ...d, pages: d.pages.filter((_, i) => i !== index) });
}

export function movePage(d: Doc, from: number, to: number): Doc {
  const pages = [...d.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  return edited({ ...d, pages });
}

// ---------------------------------------------------------------- provenance: refresh from data

/** Current data text for a bound text element (in the document's language), or undefined if not derivable. */
export function boundText(d: Doc, b: Binding, pageIndex: number): string | undefined {
  const lang = d.language;
  const f = b.field;
  if (f === "title" || f === "running_title") return d.title || label("defaultTitle", lang);
  if (f === "subtitle") return d.meta.subtitle;
  if (f === "footer_credit") return label("credit", lang);
  if (f === "summary") return summaryText(selectionCounts(d.selection), lang);
  if (f === "footer_meta") {
    const meta = [d.meta.organisation, d.meta.author, d.meta.date].filter(Boolean).join(" · ");
    const pageNo = `${label("page", lang)} ${pageIndex + 1} / ${d.pages.length}`;
    return meta ? `${meta}\n${pageNo}` : pageNo;
  }
  const group = d.selection.find((g) => (b.competency_id ? g.id === b.competency_id : b.bucket_id ? g.id === b.bucket_id : f.startsWith("routines_") && g.kind === "routines"));
  if (group && !b.strategy_id && !b.routine_id) {
    const gt = groupText(group, lang);
    const key = f.replace(/^routines_/, "");
    if (key === "name") return gt.name;
    if (key === "name_english") return gt.name_secondary;
    if (key === "continued") return continuedText(gt.name, lang);
    if (key === "domain_name") return domainName(gt.domain, lang);
  }
  const itemId = b.strategy_id ?? b.routine_id;
  if (!itemId) return undefined;
  const it = itemText(b.strategy_id ? "strategy" : "routine", itemId, lang);
  if (f === "name") return it.name;
  if (f === "name_english") return it.name_secondary;
  if (f === "how_to") return b.part === undefined ? it.how_to : howToSteps(it.how_to, lang)[b.part];
  if (f === "also") {
    const e = resolve(d.selection).flatMap((g) => g.entries).find((x) => x.id === itemId && !x.pointerTo);
    return e?.also.length ? alsoText(d.selection, e.also, lang) : undefined;
  }
  if (f === "pointer") {
    const e = resolve(d.selection).flatMap((g) => g.entries).find((x) => x.id === itemId && x.pointerTo);
    return e ? pointerText(d.selection, it.name, e.pointerTo!, lang) : undefined;
  }
  const v = it.optional[f as keyof typeof it.optional];
  if (v) return Array.isArray(v) ? v.map((s) => `• ${s}`).join("\n") : v;
  return undefined;
}

/** "Refresh from data": re-derive a bound element's content (text, or the default image with no crop). */
export function refreshFromData(d: Doc, ids: string[]): Doc {
  return mapElements(d, ids, (e) => {
    if (!e.binding) return e;
    if (e.type === "text") {
      const pageIndex = d.pages.findIndex((p) => p.elements.some((x) => x.id === e.id));
      const t = boundText(d, e.binding, pageIndex);
      if (t === undefined) return e;
      const need = measureTextHeight(t || " ", e.style, e.w_mm);
      return { ...e, content: { text: t }, h_mm: Math.max(e.h_mm, need) };
    }
    if (e.type === "image") {
      const id = e.binding.strategy_id ? imagesForStrategy(e.binding.strategy_id)[0] : e.binding.routine_id ? imagesForRoutine(e.binding.routine_id)[0] : undefined;
      const im = id ? imageById.get(id) : undefined;
      if (!im) return { ...e, content: { ...e.content, crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover" } };
      return { ...e, content: { ...e.content, image_ref: `tg:${im.image_id}`, natural_px: [im.width_px, im.height_px], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover" } };
    }
    return e;
  });
}

/** Keep "पृष्ठ 2 / 3" / "Page 2 / 3" footers right when pages are added, removed or reordered by hand. */
export function renumberPages(d: Doc): Doc {
  const n = d.pages.length;
  let changed = false;
  const pages = d.pages.map((p, i) => ({
    ...p,
    elements: p.elements.map((e) => {
      if (e.type !== "text" || e.binding?.field !== "footer_meta") return e;
      const text = e.content.text.replace(/(पृष्ठ|Page) \d+ \/ \d+/, `$1 ${i + 1} / ${n}`);
      if (text === e.content.text) return e;
      changed = true;
      return { ...e, content: { text } };
    }),
  }));
  return changed ? { ...d, pages } : d;
}

/** Title / subtitle / footer changes on a hand-edited layout: update bound elements in place instead of re-flowing. */
export function patchMetaTexts(d: Doc): Doc {
  const fields = new Set(["title", "running_title", "subtitle", "footer_meta"]);
  return {
    ...d,
    pages: d.pages.map((p, i) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (e.type !== "text" || !e.binding || !fields.has(e.binding.field)) return e;
        const t = boundText(d, e.binding, i);
        return t === undefined || t === e.content.text ? e : { ...e, content: { text: t } };
      }),
    })),
  };
}
