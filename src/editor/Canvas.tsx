import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { flushSync } from "react-dom";
import Moveable, { type OnDragEnd, type OnResizeEnd, type OnRotateEnd } from "react-moveable";
import Selecto from "react-selecto";
import type { Crop, Element, ImageElement } from "../model/types";
import { PX_PER_MM } from "../model/units";
import { PageView } from "../render/PageView";
import { imagePlacement, imageUrl } from "../render/styles";
import { findElement, mapElements, setText, type Doc } from "./ops";

export interface CanvasProps {
  doc: Doc;
  zoom: number;
  selected: string[];
  setSelected: (ids: string[]) => void;
  editingId?: string;
  setEditingId: (id?: string) => void;
  cropId?: string;
  setCropId: (id?: string) => void;
  setCurrentPage: (i: number) => void;
  commit: (fn: (d: Doc) => Doc) => void;
  showGuides: boolean;
  /** Right-click: the element under the pointer (already selected by then) and the page point in mm. */
  onContextMenu: (info: ContextInfo) => void;
}

export interface ContextInfo {
  clientX: number;
  clientY: number;
  pageIndex: number;
  /** Pointer position on the page, in mm from the trim box's top-left. */
  at: { x: number; y: number };
  elementId?: string;
}

const px2mm = (v: string) => (v.endsWith("px") ? parseFloat(v) / PX_PER_MM : parseFloat(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

function topNode(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.canvas-edit [data-top][data-el="${CSS.escape(id)}"]`);
}

export function Canvas(p: CanvasProps) {
  const { doc, zoom, selected, setSelected } = p;
  const moveable = useRef<Moveable>(null);
  const pointerDown = useRef(false);
  const lastDown = useRef<{ id: string; at: number } | null>(null);
  const resizeStart = useRef<{ w: number; h: number; l: number; t: number } | null>(null);
  useEffect(() => {
    const up = () => { pointerDown.current = false; };
    window.addEventListener("pointerup", up, true);
    return () => window.removeEventListener("pointerup", up, true);
  }, []);
  const container = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [guideNodes, setGuideNodes] = useState<HTMLElement[]>([]);
  const selectedEls = useMemo(() => selected.map((id) => findElement(doc, id)?.el).filter(Boolean) as Element[], [doc, selected]);
  const movable = selectedEls.filter((e) => !e.locked && e.id !== p.editingId && e.id !== p.cropId);
  const single = movable.length === 1 ? movable[0] : undefined;
  const pageOfSelection = selected.length ? findElement(doc, selected[0])?.pageIndex : undefined;

  // Resolve DOM targets and snap guides after every render that could move them.
  useEffect(() => {
    setTargets(movable.map((e) => topNode(e.id)).filter(Boolean) as HTMLElement[]);
    if (pageOfSelection === undefined) return setGuideNodes([]);
    const page = document.querySelectorAll<HTMLElement>(".canvas-edit .page")[pageOfSelection];
    if (!page) return;
    const others = [...page.querySelectorAll<HTMLElement>("[data-top]")].filter((n) => !selected.includes(n.dataset.el!));
    setGuideNodes([...others.slice(0, 250), ...page.querySelectorAll<HTMLElement>(".snap-guide")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, selected.join(","), p.editingId, p.cropId, zoom]);

  useEffect(() => moveable.current?.updateRect(), [doc, zoom]);

  function onPointerDown(e: RPointerEvent<HTMLDivElement>, pageIndex: number) {
    if ((e.target as HTMLElement).closest(".editing-text, .crop-live")) return;
    pointerDown.current = true;
    p.setCurrentPage(pageIndex);
    const node = (e.target as HTMLElement).closest<HTMLElement>("[data-top]");
    if (p.cropId && node?.dataset.el !== p.cropId) p.setCropId(undefined);
    if (p.editingId && node?.dataset.el !== p.editingId) p.setEditingId(undefined);
    if (!node) {
      // Empty page area: clear (unless shift, which extends a marquee selection).
      if (!e.shiftKey && !moveable.current?.isMoveableElement(e.target as HTMLElement)) setSelected([]);
      return;
    }
    if (e.button !== 0) return; // right-click is handled by onContextMenu
    const id = node.dataset.el!;
    // Double-click detection here (Moveable's drag handling can swallow native dblclick events).
    const now = performance.now();
    const isDouble = lastDown.current?.id === id && now - lastDown.current.at < 450;
    lastDown.current = { id, at: now };
    if (isDouble && !e.shiftKey) {
      e.preventDefault(); // keep the browser from moving focus away from the editor we're about to open
      pointerDown.current = false;
      enter(node);
      return;
    }
    if (e.shiftKey) {
      setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      return;
    }
    const el = findElement(doc, id)?.el;
    const native = e.nativeEvent;
    if (selected.includes(id)) {
      if (el && !el.locked && selected.length === 1) moveable.current?.dragStart(native);
      return;
    }
    flushSync(() => setSelected([id]));
    // Start dragging in the same gesture once Moveable has picked up the new target — but only if the
    // button is still held (a quick click must not leave the element following the pointer).
    if (el && !el.locked) moveable.current?.waitToChangeTarget().then(() => { if (pointerDown.current) moveable.current?.dragStart(native); });
  }

  function onContextMenu(e: React.MouseEvent) {
    const onHandle = !!moveable.current?.isMoveableElement(e.target as HTMLElement);
    // Right-clicking a selection handle (drawn outside the page DOM) means "the current selection".
    const handlePage = onHandle && selected.length ? findElement(doc, selected[0])?.page.id : undefined;
    const pageNode = (e.target as HTMLElement).closest<HTMLElement>(".canvas-edit .page")
      ?? (handlePage ? document.querySelector<HTMLElement>(`.canvas-edit .page[data-page="${CSS.escape(handlePage)}"]`) : null);
    if (!pageNode) return;
    e.preventDefault();
    const pageIndex = doc.pages.findIndex((pg) => pg.id === pageNode.dataset.page);
    const trim = pageNode.querySelector<HTMLElement>(".trim")!.getBoundingClientRect();
    const at = { x: (e.clientX - trim.left) / (PX_PER_MM * zoom), y: (e.clientY - trim.top) / (PX_PER_MM * zoom) };
    const node = (e.target as HTMLElement).closest<HTMLElement>("[data-top]");
    const id = node?.dataset.el;
    if (id && !selected.includes(id)) setSelected([id]);
    if (!id && !moveable.current?.isMoveableElement(e.target as HTMLElement)) setSelected([]);
    p.setCurrentPage(pageIndex);
    p.onContextMenu({ clientX: e.clientX, clientY: e.clientY, pageIndex, at, elementId: id ?? (moveable.current?.isMoveableElement(e.target as HTMLElement) ? selected[0] : undefined) });
  }

  /** Double-click: edit text in place, or enter crop mode for an image. */
  function enter(target: EventTarget | null) {
    const node = (target as HTMLElement | null)?.closest<HTMLElement>("[data-top]");
    const el = node && findElement(doc, node.dataset.el!)?.el;
    if (!el || el.locked) return;
    if (el.type === "text") p.setEditingId(el.id);
    if (el.type === "image") p.setCropId(el.id);
  }

  // ---- commit helpers (read the px values Moveable wrote during the gesture)
  const commitFrames = (nodes: HTMLElement[], withSize: boolean) => {
    const updates = new Map<string, Partial<Element>>();
    for (const n of nodes) {
      const id = n.dataset.el!;
      const u: Partial<Element> = { x_mm: r2(px2mm(n.style.left)), y_mm: r2(px2mm(n.style.top)) };
      if (withSize) Object.assign(u, { w_mm: r2(px2mm(n.style.width)), h_mm: r2(px2mm(n.style.height)) });
      updates.set(id, u);
    }
    p.commit((d) => mapElements(d, [...updates.keys()], (el) => {
      const u: Partial<Element> = { ...updates.get(el.id) };
      // Lines render half a stroke above their y (see ElementView), so undo that offset.
      if (el.type === "line" && u.y_mm !== undefined) u.y_mm = r2(u.y_mm + (el.style.stroke?.width_mm ?? 0.3) / 2);
      return { ...el, ...u } as Element;
    }));
  };

  const onDragEnd = (e: OnDragEnd) => e.isDrag && commitFrames([e.target as HTMLElement], false);
  const onResizeEnd = (e: OnResizeEnd) => e.isDrag && commitFrames([e.target as HTMLElement], true);
  const onRotateEnd = (e: OnRotateEnd) => {
    if (!e.isDrag || !single) return;
    const m = /rotate\(([-\d.]+)deg\)/.exec((e.target as HTMLElement).style.transform);
    const deg = m ? Math.round((((parseFloat(m[1]) % 360) + 360) % 360) * 10) / 10 : 0;
    p.commit((d) => mapElements(d, [single.id], (el) => ({ ...el, rotation: deg }) as Element));
  };

  return (
    <div className="canvas-edit" ref={container} onDoubleClick={(e) => enter(e.target)} onContextMenu={onContextMenu}>
      {doc.pages.map((page, i) => (
        <div key={page.id} className="page-wrap" onPointerDown={(e) => onPointerDown(e, i)}>
          <div className="page-label mono">{i + 1}</div>
          <div className="paper">
            <PageView
              page={page}
              setup={doc.page}
              scale={zoom}
              hooks={{ editingId: p.editingId, onTextCommit: (id, t) => { p.setEditingId(undefined); p.commit((d) => (findElement(d, id)?.el.type === "text" && (findElement(d, id)!.el as { content: { text: string } }).content.text === t ? d : setText(d, id, t))); } }}
              overlay={
                <>
                  <Guides doc={doc} show={p.showGuides} />
                  {p.cropId && page.elements.some((el) => el.id === p.cropId) && (
                    <CropOverlay el={page.elements.find((el) => el.id === p.cropId) as ImageElement} zoom={zoom} commit={p.commit} />
                  )}
                  {selectedEls.filter((el) => el.locked && page.elements.includes(el)).map((el) => (
                    <div key={el.id} className="locked-outline" style={{ left: `${el.x_mm}mm`, top: `${el.y_mm}mm`, width: `${el.w_mm}mm`, height: `${el.h_mm}mm` }} />
                  ))}
                </>
              }
            />
          </div>
        </div>
      ))}
      {/* Marquee selection: drag on empty page area to select everything fully inside the box. */}
      <Selecto
        dragContainer={container.current ?? undefined}
        selectableTargets={[".canvas-edit [data-top]"]}
        hitRate={100}
        selectByClick={false}
        selectFromInside={false}
        toggleContinueSelect={["shift"]}
        ratio={0}
        onDragStart={(e) => {
          const t = e.inputEvent.target as HTMLElement;
          const onPage = t.closest(".canvas-edit .page");
          // Only start from empty page space: elements, handles, editors and the gaps between pages don't count.
          if (!onPage || t.closest("[data-top], .editing-text, .crop-live") || moveable.current?.isMoveableElement(t) || (e.inputEvent as MouseEvent).button > 0) e.stop();
        }}
        onSelectEnd={(e) => {
          if (!e.isDragStart && !e.selected.length && !e.added.length) return;
          const start = (e.inputEvent.target as HTMLElement).closest(".canvas-edit .page")?.getAttribute("data-page");
          // One page at a time: keep what lies on the page where the drag began.
          const ids = e.selected
            .filter((n) => n.closest(".page")?.getAttribute("data-page") === start)
            .map((n) => (n as HTMLElement).dataset.el!)
            .filter((id) => !findElement(doc, id)?.el.hidden);
          const extend = (e.inputEvent as MouseEvent).shiftKey;
          const onStart = selected.filter((id) => doc.pages.find((pg) => pg.id === start)?.elements.some((x) => x.id === id));
          setSelected(extend ? [...new Set([...onStart, ...ids])] : ids);
        }}
      />
      <Moveable
        ref={moveable}
        target={targets.length === 1 ? targets[0] : targets}
        draggable
        resizable={!!single && single.type !== "line"}
        rotatable={!!single && single.type !== "line"}
        throttleDrag={0}
        throttleResize={0}
        throttleRotate={0}
        snapRotationDegrees={[0, 90, 180, 270]}
        snapRotationThreshold={4}
        origin={false}
        keepRatio={false}
        snappable
        snapThreshold={6}
        isDisplaySnapDigit
        snapGap={false}
        snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
        elementSnapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
        elementGuidelines={guideNodes}
        onDrag={(e) => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; }}
        onDragEnd={onDragEnd}
        onClick={(e) => { if (e.isDouble) enter(e.inputTarget ?? e.target); }}
        onDragGroup={(e) => e.events.forEach((ev) => { ev.target.style.left = `${ev.left}px`; ev.target.style.top = `${ev.top}px`; })}
        onDragGroupEnd={(e) => e.isDrag && commitFrames(e.targets as HTMLElement[], false)}
        onResizeStart={(e) => {
          const t = e.target as HTMLElement;
          resizeStart.current = { w: t.offsetWidth, h: t.offsetHeight, l: t.offsetLeft, t: t.offsetTop };
        }}
        onResize={(e) => {
          // Size from the start rect plus Moveable's distance (its own width/height readings are unreliable
          // inside a scaled page). A handle on the left/top edge also moves the box.
          const s0 = resizeStart.current!;
          const [dw, dh] = e.dist;
          const w = Math.max(4, s0.w + dw), h = Math.max(4, s0.h + dh);
          e.target.style.width = `${w}px`;
          e.target.style.height = `${h}px`;
          e.target.style.left = `${e.direction[0] === -1 ? s0.l - (w - s0.w) : s0.l}px`;
          e.target.style.top = `${e.direction[1] === -1 ? s0.t - (h - s0.h) : s0.t}px`;
        }}
        onResizeEnd={onResizeEnd}
        onRotate={(e) => { e.target.style.transform = `rotate(${e.rotation}deg)`; }}
        onRotateEnd={onRotateEnd}
      />
    </div>
  );
}

/** Invisible snap lines (margins, centre) plus the visible dashed margin guide. */
function Guides({ doc, show }: { doc: Doc; show: boolean }) {
  const { width_mm: W, height_mm: H, margins_mm: m } = doc.page;
  const v = [m.left, W / 2, W - m.right];
  const h = [m.top, H / 2, H - m.bottom];
  return (
    <>
      {show && <div className="margin-guide" style={{ left: `${m.left}mm`, top: `${m.top}mm`, right: `${m.right}mm`, bottom: `${m.bottom}mm` }} />}
      {v.map((x) => <div key={`v${x}`} className="snap-guide" style={{ left: `${x}mm`, top: 0, width: 0, height: `${H}mm` }} />)}
      {h.map((y) => <div key={`h${y}`} className="snap-guide" style={{ top: `${y}mm`, left: 0, height: 0, width: `${W}mm` }} />)}
    </>
  );
}

/**
 * Crop mode: the whole source image shows faded around the frame; drag inside to reposition, scroll to zoom.
 * The model keeps the crop as fractions of the source; the frame itself doesn't move.
 */
function CropOverlay({ el, zoom, commit }: { el: ImageElement; zoom: number; commit: (fn: (d: Doc) => Doc) => void }) {
  const [draft, setDraft] = useState<Crop>(el.content.crop);
  const start = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => setDraft(el.content.crop), [el.content.crop]);
  const c = { ...el.content, crop: draft };
  const pl = imagePlacement(c, el.w_mm, el.h_mm);
  const [nw, nh] = el.content.natural_px;
  const mmPerSrcPx = pl.width_mm / nw;

  const clamp = (k: Crop): Crop => {
    const w = Math.min(1, Math.max(0.05, k.w)), h = Math.min(1, Math.max(0.05, k.h));
    return { w, h, x: Math.min(1 - w, Math.max(0, k.x)), y: Math.min(1 - h, Math.max(0, k.y)) };
  };
  const save = (k: Crop) => commit((d) => mapElements(d, [el.id], (e) => (e.type === "image" ? { ...e, content: { ...e.content, crop: k } } : e)));

  // Native, non-passive wheel listener so zooming the crop doesn't scroll the canvas.
  useEffect(() => {
    const node = box.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = draftRef.current;
      const f = e.deltaY > 0 ? 1.06 : 1 / 1.06;
      const cx = k.x + k.w / 2, cy = k.y + k.h / 2;
      const next = clamp({ w: k.w * f, h: k.h * f, x: cx - (k.w * f) / 2, y: cy - (k.h * f) / 2 });
      setDraft(next);
      save(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id]);

  return (
    <div
      ref={box}
      className="crop-live"
      style={{ position: "absolute", left: `${el.x_mm}mm`, top: `${el.y_mm}mm`, width: `${el.w_mm}mm`, height: `${el.h_mm}mm`, zIndex: 100001, cursor: "grab" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, crop: draft };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dxMm = (e.clientX - start.current.x) / (PX_PER_MM * zoom);
        const dyMm = (e.clientY - start.current.y) / (PX_PER_MM * zoom);
        setDraft(clamp({ ...start.current.crop, x: start.current.crop.x - dxMm / mmPerSrcPx / nw, y: start.current.crop.y - dyMm / mmPerSrcPx / nh }));
      }}
      onPointerUp={() => {
        if (start.current) save(draft);
        start.current = null;
      }}
    >
      <img
        src={imageUrl(el.content.image_ref)}
        alt=""
        draggable={false}
        style={{ position: "absolute", left: `${pl.left_mm}mm`, top: `${pl.top_mm}mm`, width: `${pl.width_mm}mm`, height: `${pl.height_mm}mm`, opacity: 0.35, maxWidth: "none", pointerEvents: "none" }}
      />
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", outline: "0.5mm solid #1F4F9A", pointerEvents: "none" }}>
        <img
          src={imageUrl(el.content.image_ref)}
          alt=""
          draggable={false}
          style={{ position: "absolute", left: `${pl.left_mm}mm`, top: `${pl.top_mm}mm`, width: `${pl.width_mm}mm`, height: `${pl.height_mm}mm`, maxWidth: "none" }}
        />
      </div>
      <div className="crop-hint">Drag to reposition · scroll to zoom · Esc when done</div>
    </div>
  );
}
