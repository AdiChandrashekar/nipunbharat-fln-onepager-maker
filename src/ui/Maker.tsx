import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FIELD_NAMES } from "../content/fields";
import { createDocument } from "../doc/newDoc";
import { Canvas, type ContextInfo } from "../editor/Canvas";
import { ExportMenu } from "../export/ExportMenu";
import { ContextMenu, type MenuEntry } from "../editor/ContextMenu";
import { useHistory } from "../editor/history";
import { ImageLibrary, type PickedImage } from "../editor/ImageLibrary";
import { Layers } from "../editor/Layers";
import {
  addElement, addPage, deleteElements, deletePage, duplicateElements, findElement, groupElements, mapElements, pasteElements, patchElements,
  patchMetaTexts, refreshFromData, renumberPages, reorderZ, ungroup, type Doc,
} from "../editor/ops";
import { Pages } from "../editor/Pages";
import { Properties } from "../editor/Properties";
import { fitDocument } from "../layout/fit";
import { measureTextHeight } from "../layout/measure";
import { pageLabel } from "../model/pageSizes";
import type { Element, OptionalField } from "../model/types";
import { SCHEMA_VERSION } from "../model/types";
import { docFamilies, ensureFonts } from "../fonts";
import { docStore, downloadBlob, fileStem, pickJsonFile, WEB } from "../platform";
import { templateById } from "../templates";
import { KOSH_LIGHT, tint } from "../theme/tokens";
import { Selector } from "./Selector";
import { Toolbar } from "./Toolbar";
import { Tray } from "./Tray";
import { usePref } from "./usePref";

const TIER_LABEL = { spacious: "Spacious", standard: "Standard", compact: "Compact" } as const;
const STEP_NOTE = ["", "", "smaller images", "minimum text size"];

/** Inputs auto-population depends on, split so title/footer edits can patch a hand-edited layout in place. */
function keys(d: Doc) {
  const layout = JSON.stringify([d.selection, d.page, d.language, d.layout.template, d.layout.tier, d.layout.fit_pages, d.layout.forced_fields, d.meta.logo_ref, d.theme.look]);
  const text = JSON.stringify([d.title, d.meta.subtitle, d.meta.organisation, d.meta.author, d.meta.date]);
  return { layout, text, full: `${layout}§${text}` };
}

/** Older / hand-written documents: normalise shape and mark them as already laid out (never re-flow on open). */
function normalise(raw: Doc): Doc {
  const d: Doc = {
    ...raw,
    selection: (raw.selection ?? []).map((g) => {
      const old = g as unknown as { kind: string; id: string; strategies?: string[]; items?: string[]; origin?: string };
      return { kind: (old.kind === "routine" ? "routines" : old.kind) as Doc["selection"][number]["kind"], id: old.id, origin: (old.origin ?? "competency") as "competency", items: old.items ?? old.strategies ?? [] };
    }),
  };
  return { ...d, layout: { ...d.layout, fit_key: keys(d).full } };
}

function boundItems(els: Element[]): Set<string> {
  const out = new Set<string>();
  for (const e of els) {
    if (e.binding?.strategy_id) out.add(e.binding.strategy_id);
    if (e.binding?.routine_id) out.add(e.binding.routine_id);
  }
  return out;
}

type LeftTab = "content" | "pages" | "layers";
type RightTab = "props" | "tray";

export function Maker() {
  const h = useHistory<Doc>(() => createDocument());
  const doc = h.doc;
  const [pendingReflow, setPendingReflow] = useState(false);
  const [message, setMessage] = useState<string>();
  const [zoom, setZoom] = useState(0.62);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [cropId, setCropId] = useState<string>();
  const [currentPage, setCurrentPage] = useState(0);
  const [left, setLeft] = useState<LeftTab>("content");
  const [right, setRight] = useState<RightTab>("tray");
  const [library, setLibrary] = useState<{ mode: "swap" | "insert"; id?: string; pageIndex?: number; at?: { x: number; y: number } } | null>(null);
  const [menu, setMenu] = useState<ContextInfo | null>(null);
  const clipboard = useRef<Element[]>([]);
  const [guides, setGuides] = useState(true);
  // Workspace layout, remembered in this browser: side panel widths and which bars are minimised.
  const [leftW, setLeftW] = usePref("leftW", 330);
  const [rightW, setRightW] = usePref("rightW", 320);
  const [leftOpen, setLeftOpen] = usePref("leftOpen", true);
  const [rightOpen, setRightOpen] = usePref("rightOpen", true);
  const [barsOpen, setBarsOpen] = usePref("barsOpen", true);
  const canvasRef = useRef<HTMLElement>(null);
  // Ctrl/Cmd + scroll (and trackpad pinch, which browsers report the same way) zooms around the pointer.
  const zoomAnchor = useRef<{ px: number; py: number; cx: number; cy: number; ratio: number } | null>(null);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest(".crop-live")) return;
      e.preventDefault();
      const edit = node.querySelector(".canvas-edit");
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      setZoom((z) => {
        const next = Math.min(3, Math.max(0.25, Math.round(z * Math.exp((-e.deltaY * unit) / 500) * 1000) / 1000));
        if (next !== z && edit) {
          const r = edit.getBoundingClientRect();
          zoomAnchor.current = { px: e.clientX - r.left, py: e.clientY - r.top, cx: e.clientX, cy: e.clientY, ratio: next / z };
        }
        return next;
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const node = canvasRef.current;
    const edit = node?.querySelector(".canvas-edit");
    if (!a || !node || !edit) return;
    zoomAnchor.current = null;
    const r = edit.getBoundingClientRect();
    // Keep the point that was under the pointer under it after the zoom.
    node.scrollBy(r.left + a.px * a.ratio - a.cx, r.top + a.py * a.ratio - a.cy);
  }, [zoom]);
  /** Drag a panel edge: the width follows the pointer, within limits. */
  const startResize = (side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = side === "left" ? leftW : rightW;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(620, Math.max(220, w0 + (side === "left" ? ev.clientX - x0 : x0 - ev.clientX))));
      (side === "left" ? setLeftW : setRightW)(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [openList, setOpenList] = useState<{ id: string; title: string; updated?: string }[] | null>(null);
  const savedRef = useRef<Doc | null>(null);
  const [savedAt, setSavedAt] = useState<string>();

  const update = useCallback((fn: (d: Doc) => Doc, mergeKey?: string) => h.commit(fn, mergeKey), [h]);
  // Dev-only hook for automated editor tests (scripts/editor-test.mjs); not present in builds.
  if (import.meta.env.DEV) (window as unknown as { __onepager: unknown }).__onepager = { get: h.get, undo: h.undo, redo: h.redo };

  // ---------------------------------------------------------------- auto-population
  const k = keys(doc);
  const reflow = useCallback((asUndoStep: boolean) => {
    const d = h.get();
    const r = fitDocument(d);
    const apply = (cur: Doc): Doc => ({
      ...cur,
      pages: r.pages,
      layout: { ...cur.layout, manually_edited: false, fit_key: keys(cur).full,
        resolved: { tier: r.tier, step: r.step, pages: r.pageCount, dropped_fields: r.dropped, extra_fields: r.extras, overflow: r.overflow } },
    });
    if (asUndoStep) h.commit(apply); else h.replace(apply);
    setPendingReflow(false);
    setSelected([]);
  }, [h]);

  useEffect(() => {
    const d = h.get();
    if (!templateById.has(d.layout.template)) return; // hand-made documents (e.g. samples) are never re-flowed
    if (d.layout.fit_key === k.full) { setPendingReflow(false); return; }
    if (d.layout.manually_edited) {
      if (d.layout.fit_key?.startsWith(`${k.layout}§`)) {
        // Only title / subtitle / footer changed: update those elements in place, keep the hand-edited layout.
        h.replace((cur) => ({ ...patchMetaTexts(cur), layout: { ...cur.layout, fit_key: keys(cur).full } }));
      } else setPendingReflow(true);
      return;
    }
    reflow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.full]);

  function keepAndAppend() {
    const d = h.get();
    const have = boundItems(d.pages.flatMap((p) => p.elements));
    const fresh = d.selection.map((g) => ({ ...g, items: g.items.filter((i) => !have.has(i)) })).filter((g) => g.items.length);
    const extra = fresh.length ? fitDocument({ ...d, selection: fresh }).pages : [];
    h.commit((cur) => ({ ...cur, pages: [...cur.pages, ...extra], layout: { ...cur.layout, fit_key: keys(cur).full } }));
    setPendingReflow(false);
  }

  // Page numbers in footers follow page adds/deletes/moves (folded into the same undo step).
  const pageOrder = doc.pages.map((p) => p.id).join(",");
  useEffect(() => {
    const d = h.get();
    const next = renumberPages(d);
    if (next !== d) h.replace(() => next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageOrder]);

  // ---------------------------------------------------------------- selection helpers
  useEffect(() => {
    // Drop selections whose elements no longer exist (undo, re-flow, delete).
    const alive = selected.filter((id) => findElement(doc, id));
    if (alive.length !== selected.length) setSelected(alive);
    if (currentPage >= doc.pages.length) setCurrentPage(Math.max(0, doc.pages.length - 1));
  }, [doc, selected, currentPage]);

  useEffect(() => { if (selected.length) setRight("props"); }, [selected.length]);

  const del = () => { if (selected.length) { h.commit((d) => deleteElements(d, selected)); setSelected([]); } };
  const dup = () => {
    if (!selected.length) return;
    const r = duplicateElements(h.get(), selected);
    h.commit(() => r.doc);
    setSelected(r.ids);
  };
  const nudge = (dx: number, dy: number) =>
    selected.length && h.commit((d) => mapElements(d, selected, (e) => (e.locked ? e : ({ ...e, x_mm: e.x_mm + dx, y_mm: e.y_mm + dy }) as Element)), "nudge");
  const align = (a: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    const els = selected.map((id) => findElement(doc, id)?.el).filter(Boolean) as Element[];
    const x0 = Math.min(...els.map((e) => e.x_mm)), x1 = Math.max(...els.map((e) => e.x_mm + e.w_mm));
    const y0 = Math.min(...els.map((e) => e.y_mm)), y1 = Math.max(...els.map((e) => e.y_mm + e.h_mm));
    h.commit((d) => mapElements(d, selected, (e) => {
      const n = { ...e } as Element;
      if (a === "left") n.x_mm = x0;
      if (a === "right") n.x_mm = x1 - e.w_mm;
      if (a === "center") n.x_mm = (x0 + x1) / 2 - e.w_mm / 2;
      if (a === "top") n.y_mm = y0;
      if (a === "bottom") n.y_mm = y1 - e.h_mm;
      if (a === "middle") n.y_mm = (y0 + y1) / 2 - e.h_mm / 2;
      return n;
    }));
  };

  // ---------------------------------------------------------------- insert
  const P = KOSH_LIGHT.palette;
  /** Add an element at the page centre, or with its top-left at `place.at` (right-click "Add … here"). */
  function insert(kind: "text" | "rect" | "ellipse" | "line", place?: { pageIndex: number; at: { x: number; y: number } }) {
    const d = h.get();
    if (!d.pages.length) return;
    const pi = place?.pageIndex ?? Math.min(currentPage, d.pages.length - 1);
    const { width_mm: W, height_mm: H } = d.page;
    let el: Omit<Element, "id" | "z">;
    if (kind === "text") {
      const style = { font_family: KOSH_LIGHT.fonts.body, font_size_pt: 12, line_height: 1.4, colour: P.ink };
      const text = d.language === "en" ? "New text" : "नया पाठ";
      el = { type: "text", name: "text", x_mm: W / 2 - 30, y_mm: H / 2 - 5, w_mm: 60, h_mm: measureTextHeight(text, style, 60), rotation: 0, locked: false, style, content: { text } };
    } else if (kind === "line") {
      el = { type: "line", name: "line", x_mm: W / 2 - 30, y_mm: H / 2, w_mm: 60, h_mm: 0, rotation: 0, locked: false, style: { stroke: { colour: P.ink, width_mm: 0.4 } }, content: { line: true } };
    } else {
      el = { type: "shape", name: kind === "rect" ? "rectangle" : "ellipse", x_mm: W / 2 - 20, y_mm: H / 2 - 12, w_mm: 40, h_mm: 25, rotation: 0, locked: false,
        style: { fill: tint(P.accent, 0.85), radius_mm: kind === "rect" ? 2 : 0 }, content: { shape_kind: kind } };
    }
    if (place) el = { ...el, x_mm: Math.round(place.at.x * 10) / 10, y_mm: Math.round(place.at.y * 10) / 10 };
    const r = addElement(d, pi, el);
    h.commit(() => r.doc);
    setSelected([r.id]);
    if (kind === "text") setEditingId(r.id);
  }

  // ---------------------------------------------------------------- clipboard (in-app)
  const copy = () => {
    const d = h.get();
    clipboard.current = selected.map((id) => findElement(d, id)?.el).filter(Boolean).map((e) => structuredClone(e)) as Element[];
  };
  const cut = () => { copy(); del(); };
  const paste = (pageIndex = currentPage, at?: { x: number; y: number }) => {
    if (!clipboard.current.length) return;
    const r = pasteElements(h.get(), Math.min(pageIndex, h.get().pages.length - 1), clipboard.current, at);
    h.commit(() => r.doc);
    setSelected(r.ids);
    if (!at) clipboard.current = clipboard.current.map((e) => ({ ...e, x_mm: e.x_mm + 5, y_mm: e.y_mm + 5 }) as Element); // repeated pastes cascade
  };
  const selectAll = (pageIndex = currentPage) => setSelected((h.get().pages[pageIndex]?.elements ?? []).filter((e) => !e.locked && !e.hidden).map((e) => e.id));
  const doGroup = () => { const r = groupElements(h.get(), selected); h.commit(() => r.doc); if (r.id) setSelected([r.id]); };
  const doUngroup = () => { const r = ungroup(h.get(), selected[0]); h.commit(() => r.doc); setSelected(r.ids); };

  function onPickImage(img: PickedImage) {
    const mode = library;
    setLibrary(null);
    if (!mode) return;
    if (mode.mode === "swap" && mode.id) {
      h.commit((d) => mapElements(d, [mode.id!], (e) => (e.type === "image"
        ? { ...e, content: { ...e.content, image_ref: img.image_ref, natural_px: img.natural_px, crop: { x: 0, y: 0, w: 1, h: 1 }, alt: img.alt } } : e)));
      return;
    }
    const d = h.get();
    const pi = Math.min(mode.pageIndex ?? currentPage, d.pages.length - 1);
    const w = 70, hgt = w * (img.natural_px[1] / img.natural_px[0]);
    const r = addElement(d, pi, {
      type: "image", name: img.alt, x_mm: mode.at?.x ?? d.page.width_mm / 2 - w / 2, y_mm: mode.at?.y ?? d.page.height_mm / 2 - hgt / 2, w_mm: w, h_mm: hgt, rotation: 0, locked: false,
      style: { radius_mm: 1.5 }, content: { image_ref: img.image_ref, natural_px: img.natural_px, crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover", alt: img.alt },
    });
    h.commit(() => r.doc);
    setSelected([r.id]);
  }

  // ---------------------------------------------------------------- right-click menu
  function menuItems(m: ContextInfo): MenuEntry[] {
    const d = h.get();
    // The canvas has already selected the element under the pointer; act on the whole selection.
    const ids = m.elementId ? (selected.includes(m.elementId) ? selected : [m.elementId]) : [];
    const els = ids.map((id) => findElement(d, id)?.el).filter(Boolean) as Element[];
    const one = els.length === 1 ? els[0] : undefined;
    const here = { pageIndex: m.pageIndex, at: m.at };
    const canPaste = clipboard.current.length > 0;
    if (!els.length) {
      return [
        { label: "Paste here", hint: "Ctrl+V", onClick: () => paste(m.pageIndex, m.at), disabled: !canPaste },
        "sep",
        { label: "Add text here", onClick: () => insert("text", here) },
        { label: "Add image here…", onClick: () => setLibrary({ mode: "insert", ...here }) },
        { label: "Add rectangle here", onClick: () => insert("rect", here) },
        { label: "Add ellipse here", onClick: () => insert("ellipse", here) },
        { label: "Add line here", onClick: () => insert("line", here) },
        "sep",
        { label: "Select all on this page", hint: "Ctrl+A", onClick: () => selectAll(m.pageIndex) },
        { label: "Add blank page after this", onClick: () => h.commit((x) => addPage(x, m.pageIndex)) },
        { label: "Delete this page", onClick: () => h.commit((x) => deletePage(x, m.pageIndex)), disabled: d.pages.length <= 1, danger: true },
      ];
    }
    const allLocked = els.every((e) => e.locked);
    const alignTo = (a: Parameters<typeof align>[0]) => () => align(a);
    return [
      ...(one?.type === "text" && !one.locked ? [{ label: "Edit text", hint: "Enter", onClick: () => setEditingId(one.id) }] : []),
      ...(one?.type === "image" && !one.locked ? [
        { label: "Crop / reposition image", onClick: () => setCropId(one.id) },
        { label: "Swap or upload image…", onClick: () => setLibrary({ mode: "swap", id: one.id }) },
      ] : []),
      ...(els.some((e) => e.binding) ? [{ label: "Refresh from data", onClick: () => h.commit((x) => refreshFromData(x, ids)) }] : []),
      "sep",
      { label: "Cut", hint: "Ctrl+X", onClick: cut },
      { label: "Copy", hint: "Ctrl+C", onClick: copy },
      { label: "Paste", hint: "Ctrl+V", onClick: () => paste(m.pageIndex), disabled: !canPaste },
      { label: "Duplicate", hint: "Ctrl+D", onClick: dup },
      { label: "Delete", hint: "Del", onClick: del, danger: true },
      "sep",
      { label: "Bring to front", onClick: () => h.commit((x) => ids.reduce((acc, id) => reorderZ(acc, id, "front"), x)) },
      { label: "Bring forward", onClick: () => h.commit((x) => ids.reduce((acc, id) => reorderZ(acc, id, "forward"), x)) },
      { label: "Send backward", onClick: () => h.commit((x) => ids.reduce((acc, id) => reorderZ(acc, id, "backward"), x)) },
      { label: "Send to back", onClick: () => h.commit((x) => [...ids].reverse().reduce((acc, id) => reorderZ(acc, id, "back"), x)) },
      "sep",
      ...(els.length > 1 ? [
        { label: "Group", hint: "Ctrl+G", onClick: doGroup },
        { label: "Align left", onClick: alignTo("left") },
        { label: "Align centre", onClick: alignTo("center") },
        { label: "Align right", onClick: alignTo("right") },
        { label: "Align top", onClick: alignTo("top") },
        { label: "Align middle", onClick: alignTo("middle") },
        { label: "Align bottom", onClick: alignTo("bottom") },
        "sep" as const,
      ] : []),
      ...(one?.type === "group" ? [{ label: "Ungroup", hint: "Ctrl+Shift+G", onClick: doUngroup }, "sep" as const] : []),
      { label: allLocked ? "Unlock" : "Lock", onClick: () => h.commit((x) => patchElements(x, ids, { locked: !allLocked })) },
      { label: "Hide", onClick: () => { h.commit((x) => patchElements(x, ids, { hidden: true })); setSelected([]); } },
      { label: "Select all on this page", hint: "Ctrl+A", onClick: () => selectAll(m.pageIndex) },
    ];
  }

  // ---------------------------------------------------------------- files
  const dirty = savedRef.current !== doc;
  // Worth a "discard?" prompt only if something was picked or edited since the last save.
  const hasWork = dirty && (doc.selection.length > 0 || doc.layout.manually_edited);
  async function save() {
    h.replace((cur) => ({ ...cur, meta: { ...cur.meta, updated: new Date().toISOString() } }));
    const d = { ...h.get(), schema_version: SCHEMA_VERSION };
    try {
      await docStore.put(d);
    } catch (e) {
      return setMessage(`Save failed: ${(e as Error).message}`);
    }
    savedRef.current = h.get();
    setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setMessage(`Saved to ${docStore.where(d.id)}`);
  }
  async function showOpen() {
    setOpenList(await docStore.list());
  }
  function download() {
    const d = { ...h.get(), schema_version: SCHEMA_VERSION };
    downloadBlob(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }), `${fileStem(d)}.json`);
  }
  async function openFile() {
    if (hasWork && !confirm("Discard unsaved changes?")) return;
    try {
      const raw = await pickJsonFile();
      if (raw) load(raw);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function open(id: string) {
    if (hasWork && !confirm("Discard unsaved changes?")) return;
    load(await docStore.get(id));
  }
  async function load(raw: unknown) {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as Doc).pages)) return setMessage("That file is not a One-Pager document.");
    const d = normalise(raw as Doc);
    await ensureFonts(docFamilies(d));
    if (d.schema_version !== SCHEMA_VERSION) setMessage(`This document uses schema v${d.schema_version}; it was opened as v${SCHEMA_VERSION}.`);
    h.reset(d);
    savedRef.current = h.get();
    setOpenList(null);
    setSelected([]);
    setCurrentPage(0);
  }
  function newDoc() {
    if (hasWork && !confirm("Discard unsaved changes?")) return;
    h.reset(createDocument({ language: doc.language, size: doc.page.size === "custom" ? "A4" : doc.page.size, orientation: doc.page.orientation, template: templateById.has(doc.layout.template) ? doc.layout.template : undefined }));
    savedRef.current = null;
    setSelected([]);
  }

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; } // works from any field
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) h.redo(); else h.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); h.redo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dup(); return; }
      if (mod && e.key.toLowerCase() === "c") { if (selected.length) { e.preventDefault(); copy(); } return; }
      if (mod && e.key.toLowerCase() === "x") { if (selected.length) { e.preventDefault(); cut(); } return; }
      if (mod && e.key.toLowerCase() === "v") { if (clipboard.current.length) { e.preventDefault(); paste(); } return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); return; }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey && selected.length === 1) doUngroup();
        else if (selected.length > 1) doGroup();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); return; }
      if (e.key === "Escape") { setCropId(undefined); setEditingId(undefined); setSelected([]); return; }
      if (e.key === "Enter" && selected.length === 1) {
        const el = findElement(h.get(), selected[0])?.el;
        if (el?.type === "text" && !el.locked) { e.preventDefault(); setEditingId(el.id); }
        return;
      }
      const step = e.shiftKey ? 5 : 0.5;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key] && selected.length) { e.preventDefault(); nudge(...arrows[e.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- render
  const res = doc.layout.resolved;
  const readout = useMemo(() => {
    if (!templateById.has(doc.layout.template)) return `Hand-made layout · ${doc.pages.length} ${doc.pages.length === 1 ? "page" : "pages"}, ${pageLabel(doc.page)}`;
    if (!res) return "";
    const note = STEP_NOTE[res.step] ? ` (${STEP_NOTE[res.step]})` : "";
    const edited = doc.layout.manually_edited ? " · edited" : "";
    return `${TIER_LABEL[res.tier]}${note} · ${doc.pages.length} ${doc.pages.length === 1 ? "page" : "pages"}, ${pageLabel(doc.page)}${edited}`;
  }, [res, doc.page, doc.pages.length, doc.layout.manually_edited, doc.layout.template]);

  const forced = doc.layout.forced_fields ?? [];
  const toggleField = (f: OptionalField) =>
    update((d) => ({ ...d, layout: { ...d.layout, forced_fields: forced.includes(f) ? forced.filter((x) => x !== f) : [...forced, f] } }));
  const selectedImage = selected.length === 1 ? findElement(doc, selected[0])?.el : undefined;

  const actions = (
    <span className="file-actions">
      <button onClick={newDoc} title="New document">New</button>
      <button onClick={showOpen} title="Open a saved document">Open…</button>
      <button onClick={save} title={WEB ? "Save in this browser (Ctrl+S)" : "Save (Ctrl+S)"} className={dirty ? "primary" : ""}>{dirty ? "Save" : "Saved"}</button>
      {WEB && <button onClick={download} title="Download this document as a .json file, to keep or share">Download</button>}
      {savedAt && <span className="muted small">{dirty ? "unsaved changes" : `at ${savedAt}`}</span>}
      <button onClick={h.undo} disabled={!h.canUndo} title="Undo (Ctrl+Z)">↶</button>
      <button onClick={h.redo} disabled={!h.canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
      <ExportMenu doc={doc} setMessage={setMessage} />
    </span>
  );

  return (
    <div className="maker">
      <Toolbar doc={doc} update={update} readout={readout} overflow={!!res?.overflow} actions={actions} collapsed={!barsOpen} onToggle={() => setBarsOpen(!barsOpen)} />
      {barsOpen && (res?.dropped_fields.length || res?.extra_fields?.length || forced.length) && templateById.has(doc.layout.template) ? (
        <div className="fieldbar">
          {res?.dropped_fields.length ? <span className="muted">Left out to fit — click to switch back on:</span> : null}
          {res?.dropped_fields.map((f) => (
            <button key={f} className="chip off" onClick={() => toggleField(f)} title="Show this field (may add a page)">+ {FIELD_NAMES[f]}</button>
          ))}
          {res?.extra_fields?.length ? <span className="muted">Optional extras (not in any template):</span> : null}
          {res?.extra_fields?.map((f) => (
            <button key={f} className="chip off extra" onClick={() => toggleField(f)} title="Add this to every strategy in the document (may add a page)">+ {FIELD_NAMES[f]}</button>
          ))}
          {forced.length ? <span className="muted">Kept on:</span> : null}
          {forced.map((f) => (
            <button key={f} className="chip on" onClick={() => toggleField(f)} title="Let the fitter drop this field again">✓ {FIELD_NAMES[f]}</button>
          ))}
        </div>
      ) : null}
      {pendingReflow && (
        <div className="banner" role="alert">
          <span>You've edited this layout by hand. <b>Re-flow</b> rebuilds it from the data (your edits are replaced; undo brings them back). <b>Keep my layout</b> leaves your pages and adds only newly selected items on new pages at the end.</span>
          <button onClick={() => reflow(true)}>Re-flow</button>
          <button onClick={keepAndAppend}>Keep my layout</button>
        </div>
      )}
      <div className="workspace" style={{ gridTemplateColumns: `${leftOpen ? leftW : 30}px ${leftOpen ? 6 : 0}px minmax(0, 1fr) ${rightOpen ? 6 : 0}px ${rightOpen ? rightW : 30}px` }}>
        {!leftOpen ? (
          <aside className="panel rail">
            <button onClick={() => setLeftOpen(true)} title="Show the Content / Pages / Layers panel" aria-label="Show left panel">»</button>
            <span>Content · Pages · Layers</span>
          </aside>
        ) : (
        <aside className="panel left">
          <div className="tabs" role="tablist">
            <button className="collapse" onClick={() => setLeftOpen(false)} title="Hide this panel" aria-label="Hide left panel">«</button>
            {(["content", "pages", "layers"] as LeftTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={left === t} onClick={() => setLeft(t)}>{t === "content" ? "Content" : t === "pages" ? `Pages (${doc.pages.length})` : "Layers"}</button>
            ))}
          </div>
          {left === "content" && <Selector doc={doc} update={update} setMessage={setMessage} />}
          {left === "pages" && <Pages doc={doc} current={currentPage} setCurrent={setCurrentPage} commit={h.commit} />}
          {left === "layers" && <Layers doc={doc} pageIndex={currentPage} selected={selected} setSelected={setSelected} commit={h.commit} />}
        </aside>
        )}
        <div className="splitter" hidden={!leftOpen} onPointerDown={startResize("left")} onDoubleClick={() => setLeftW(330)} title="Drag to resize · double-click to reset" />
        <main className="canvas" ref={canvasRef}>
          <div className="insert-bar">
            <button onClick={() => insert("text")}>+ Text</button>
            <button onClick={() => setLibrary({ mode: "insert" })}>+ Image</button>
            <button onClick={() => insert("rect")}>+ Rectangle</button>
            <button onClick={() => insert("ellipse")}>+ Ellipse</button>
            <button onClick={() => insert("line")}>+ Line</button>
            <span className="sep" />
            <button onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))} aria-label="Zoom out">−</button>
            <span className="mono" title="Ctrl + scroll (or pinch) to zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))} aria-label="Zoom in">+</button>
            <button onClick={() => {
              const w = (document.querySelector(".canvas")?.clientWidth ?? 800) - 80;
              setZoom(Math.round((w / (doc.page.width_mm * 3.7795)) * 100) / 100);
            }}>Fit width</button>
            <label className="check"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Margins</label>
            {templateById.has(doc.layout.template) && doc.layout.manually_edited && !pendingReflow && (
              <button onClick={() => confirm("Re-flow from the data? Your hand edits will be replaced (Undo brings them back).") && reflow(true)}>Re-flow from data</button>
            )}
          </div>
          {message && (
            <div className="limit-msg" role="status">
              {message} <button onClick={() => setMessage(undefined)} aria-label="Dismiss">×</button>
            </div>
          )}
          {!doc.selection.length && !doc.pages.some((p) => p.elements.some((e) => e.binding?.strategy_id)) && (
            <div className="empty-hint">Add competencies or strategies from <b>Content</b>. The document lays itself out as you pick; then click anything on the page to edit it.</div>
          )}
          {res?.overflow && templateById.has(doc.layout.template) && (
            <div className="limit-msg warn">
              {doc.layout.fit_pages !== "auto" && res.pages > doc.layout.fit_pages
                ? `This selection doesn't fit on ${doc.layout.fit_pages} page(s) even at the compact tier and minimum text size.`
                : "One item is taller than a whole column at this size; it runs past the bottom margin."}
            </div>
          )}
          <Canvas
            doc={doc} zoom={zoom} selected={selected} setSelected={setSelected}
            editingId={editingId} setEditingId={setEditingId} cropId={cropId} setCropId={setCropId}
            setCurrentPage={setCurrentPage} commit={h.commit} showGuides={guides} onContextMenu={setMenu}
          />
        </main>
        <div className="splitter" hidden={!rightOpen} onPointerDown={startResize("right")} onDoubleClick={() => setRightW(320)} title="Drag to resize · double-click to reset" />
        {!rightOpen ? (
          <aside className="panel rail">
            <button onClick={() => setRightOpen(true)} title="Show the Properties / Selection tray panel" aria-label="Show right panel">«</button>
            <span>Properties · Selection tray</span>
          </aside>
        ) : (
        <aside className="panel right">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={right === "props"} onClick={() => setRight("props")}>Properties</button>
            <button role="tab" aria-selected={right === "tray"} onClick={() => setRight("tray")}>Selection tray</button>
            <button className="collapse" onClick={() => setRightOpen(false)} title="Hide this panel" aria-label="Hide right panel">»</button>
          </div>
          <div className="panel-body">
            {right === "props" ? (
              <Properties
                doc={doc} selected={selected} commit={h.commit}
                onDuplicate={dup} onDelete={del}
                onZ={(m) => selected[0] && h.commit((d) => reorderZ(d, selected[0], m))}
                onGroup={doGroup}
                onUngroup={doUngroup}
                onSwapImage={() => selectedImage && setLibrary({ mode: "swap", id: selectedImage.id })}
                onCrop={() => selectedImage && setCropId(selectedImage.id)}
                onAlign={align}
              />
            ) : (
              <Tray doc={doc} update={update} setMessage={setMessage} />
            )}
          </div>
        </aside>
        )}
      </div>
      {menu && <ContextMenu x={menu.clientX} y={menu.clientY} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {library && (
        <ImageLibrary binding={library.id ? findElement(doc, library.id)?.el.binding : undefined} lang={doc.language} onPick={onPickImage} onClose={() => setLibrary(null)} />
      )}
      {openList && (
        <div className="modal-back" onClick={() => setOpenList(null)}>
          <div className="modal small" role="dialog" aria-label="Open document" onClick={(e) => e.stopPropagation()}>
            <header><strong>Open a document</strong><button className="x" onClick={() => setOpenList(null)} aria-label="Close">×</button></header>
            {WEB && <p className="hint">Documents saved in this browser. <button onClick={() => { setOpenList(null); openFile(); }}>Open a .json file…</button></p>}
            {!openList.length && <p className="hint">{WEB ? "Nothing saved in this browser yet." : "No saved documents yet in documents/."}</p>}
            <ul className="open-list">
              {openList.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).map((d) => (
                <li key={d.id}><button onClick={() => open(d.id)}>{d.title || "(untitled)"} <small className="muted">{d.id} · {d.updated?.slice(0, 16).replace("T", " ")}</small></button></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
