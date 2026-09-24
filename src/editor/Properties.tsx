import { competencyById, routineById, strategyById } from "../data/compendium";
import type { Box4, Element, ImageElement, Style } from "../model/types";
import { ensureFonts, familiesIn } from "../fonts";
import { BUNDLED_FONTS } from "../theme/tokens";
import { boundText, findElement, mapElements, patchElements, patchStyle, refreshFromData, type Doc, type ZMove } from "./ops";

interface Props {
  doc: Doc;
  selected: string[];
  commit: (fn: (d: Doc) => Doc) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZ: (m: ZMove) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onSwapImage: () => void;
  onCrop: () => void;
  onAlign: (a: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
}

// Every bundled family (Hindi and English faces); a look's own stacks ("Inter, Mukta") are offered too.
const FONTS = BUNDLED_FONTS.map((f) => f.family).filter((f) => f !== "Tiro Devanagari Hindi");
const SWATCHES = ["#15202C", "#4C5A6B", "#1F4F9A", "#FFFFFF", "#EDF1F6", "#8F5F00", "#FBE9C2", "#B04E28", "#A03A6E", "#2A7553", "#6146A3", "#855F00"];

function Num({ label, value, step = 0.5, min, onChange, suffix }: { label: string; value: number | undefined; step?: number; min?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="prop">
      <span>{label}</span>
      <input type="number" step={step} min={min} value={value === undefined ? "" : Math.round(value * 100) / 100}
        onChange={(e) => e.target.value !== "" && onChange(+e.target.value)} />
      {suffix && <small>{suffix}</small>}
    </label>
  );
}

function Colour({ label, value, onChange, allowNone }: { label: string; value?: string; onChange: (v?: string) => void; allowNone?: boolean }) {
  return (
    <div className="prop colour">
      <span>{label}</span>
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <div className="swatches">
        {SWATCHES.map((c) => <button key={c} style={{ background: c }} title={c} aria-label={c} onClick={() => onChange(c)} />)}
        {allowNone && <button className="none" title="None" aria-label="No colour" onClick={() => onChange(undefined)}>∅</button>}
      </div>
    </div>
  );
}

const first4 = (b: Box4 | undefined) => (b === undefined ? 0 : typeof b === "number" ? b : b[0]);

function provenance(el: Element): string | undefined {
  const b = el.binding;
  if (!b) return undefined;
  const who = b.strategy_id ? strategyById.get(b.strategy_id)?.strategy_name_english
    : b.routine_id ? routineById.get(b.routine_id)?.routine_name_english
    : b.competency_id ? `${b.competency_id} ${competencyById.get(b.competency_id)?.competency_name_english ?? ""}`
    : b.bucket_id ?? "document";
  return `${who} · ${b.field.replace(/_/g, " ")}`;
}

export function Properties(p: Props) {
  const { doc, selected, commit } = p;
  const els = selected.map((id) => findElement(doc, id)?.el).filter(Boolean) as Element[];
  if (!els.length) return <p className="hint">Select something on the page to edit it. Double-click text to type; double-click an image to crop.</p>;
  const el = els[0];
  const ids = els.map((e) => e.id);
  const st = el.style;
  const set = (s: Partial<Style>) => commit((d) => patchStyle(d, ids, s));
  const setEl = (e: Partial<Element>) => commit((d) => patchElements(d, ids, e));
  const hasText = els.some((e) => e.type === "text");
  const prov = els.length === 1 ? provenance(el) : undefined;
  const pageIndex = findElement(doc, el.id)?.pageIndex ?? 0;
  const stale = el.binding && el.type === "text" && (() => { const t = boundText(doc, el.binding!, pageIndex); return t !== undefined && t !== el.content.text; })();

  return (
    <div className="props">
      <div className="props-head">
        <strong>{els.length > 1 ? `${els.length} elements` : el.name ?? el.type}</strong>
        <span className="muted"> {els.length === 1 ? el.type : ""}</span>
      </div>
      {prov && (
        <div className="prov">
          <span className="muted">From data:</span> {prov}
          <button onClick={() => commit((d) => refreshFromData(d, ids))} title="Re-derive this element's text or image from compendium.json">
            {stale ? "Refresh from data" : "Reset to data"}
          </button>
        </div>
      )}

      <section>
        <h4>Arrange</h4>
        {els.length === 1 && (
          <div className="grid4">
            <Num label="X" value={el.x_mm} onChange={(v) => setEl({ x_mm: v })} suffix="mm" />
            <Num label="Y" value={el.y_mm} onChange={(v) => setEl({ y_mm: v })} suffix="mm" />
            <Num label="W" value={el.w_mm} min={el.type === "line" ? undefined : 1} onChange={(v) => setEl({ w_mm: v })} suffix="mm" />
            <Num label="H" value={el.h_mm} min={el.type === "line" ? undefined : 1} onChange={(v) => setEl({ h_mm: v })} suffix="mm" />
            {el.type !== "line" && <Num label="Rotate" value={el.rotation} step={1} onChange={(v) => setEl({ rotation: ((v % 360) + 360) % 360 })} suffix="°" />}
          </div>
        )}
        <div className="btns">
          <button onClick={() => p.onZ("front")} title="Bring to front">⤒ Front</button>
          <button onClick={() => p.onZ("forward")} title="Bring forward">↑</button>
          <button onClick={() => p.onZ("backward")} title="Send backward">↓</button>
          <button onClick={() => p.onZ("back")} title="Send to back">⤓ Back</button>
        </div>
        {els.length > 1 && (
          <div className="btns">
            {(["left", "center", "right", "top", "middle", "bottom"] as const).map((a) => <button key={a} onClick={() => p.onAlign(a)}>Align {a}</button>)}
          </div>
        )}
        <div className="btns">
          <button onClick={p.onDuplicate}>Duplicate</button>
          <button onClick={p.onDelete}>Delete</button>
          {els.length > 1 && <button onClick={p.onGroup}>Group</button>}
          {els.length === 1 && el.type === "group" && <button onClick={p.onUngroup}>Ungroup</button>}
          <label className="check"><input type="checkbox" checked={els.every((e) => e.locked)} onChange={(e) => setEl({ locked: e.target.checked })} /> Locked</label>
          <label className="check"><input type="checkbox" checked={els.every((e) => e.hidden)} onChange={(e) => setEl({ hidden: e.target.checked })} /> Hidden</label>
        </div>
      </section>

      {hasText && (
        <section>
          <h4>Text</h4>
          <label className="prop wide">
            <span>Font</span>
            <select value={st.font_family ?? FONTS[0]} onChange={async (e) => {
              const f = e.target.value;
              await ensureFonts(familiesIn([f]));
              set({ font_family: f });
            }}>
              {[...(st.font_family && !FONTS.includes(st.font_family) ? [st.font_family] : []), ...FONTS].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <div className="grid4">
            <Num label="Size" value={st.font_size_pt} step={0.5} min={4} onChange={(v) => set({ font_size_pt: v })} suffix="pt" />
            <label className="prop">
              <span>Weight</span>
              <select value={st.weight ?? 400} onChange={(e) => set({ weight: +e.target.value as Style["weight"] })}>
                {[400, 500, 600, 700].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <Num label="Line" value={st.line_height ?? 1.4} step={0.05} min={0.8} onChange={(v) => set({ line_height: v })} suffix="×" />
            <Num label="Spacing" value={st.letter_spacing_em ?? 0} step={0.01} onChange={(v) => set({ letter_spacing_em: v })} suffix="em" />
            <Num label="Padding" value={first4(st.padding_mm)} step={0.5} min={0} onChange={(v) => set({ padding_mm: v })} suffix="mm" />
          </div>
          <div className="seg small" role="group" aria-label="Align">
            {(["left", "center", "right", "justify"] as const).map((a) => (
              <button key={a} aria-pressed={(st.align ?? "left") === a} onClick={() => set({ align: a })}>{a === "left" ? "⯇ Left" : a === "center" ? "Centre" : a === "right" ? "Right ⯈" : "Justify"}</button>
            ))}
          </div>
          <div className="seg small" role="group" aria-label="Vertical align">
            {(["top", "middle", "bottom"] as const).map((a) => (
              <button key={a} aria-pressed={(st.vertical_align ?? "top") === a} onClick={() => set({ vertical_align: a })}>{a}</button>
            ))}
          </div>
          <Colour label="Colour" value={st.colour} onChange={(c) => set({ colour: c })} />
        </section>
      )}

      {els.some((e) => e.type === "image") && els.length === 1 && (
        <section>
          <h4>Image</h4>
          <div className="btns">
            <button onClick={p.onSwapImage}>Swap / upload…</button>
            <button onClick={p.onCrop}>Crop</button>
            <button onClick={() => commit((d) => mapElements(d, ids, (e) => (e.type === "image" ? { ...e, content: { ...e.content, crop: { x: 0, y: 0, w: 1, h: 1 } } } : e)))}>Reset crop</button>
          </div>
          <div className="seg small" role="group" aria-label="Fit">
            {(["cover", "contain"] as const).map((f) => (
              <button key={f} aria-pressed={(el as ImageElement).content.fit === f}
                onClick={() => commit((d) => mapElements(d, ids, (e) => (e.type === "image" ? { ...e, content: { ...e.content, fit: f } } : e)))}>{f === "cover" ? "Fill frame" : "Fit inside"}</button>
            ))}
          </div>
          <label className="prop wide">
            <span>Zoom</span>
            <input type="range" min={1} max={4} step={0.05} value={1 / (el as ImageElement).content.crop.w}
              onChange={(e) => {
                const z = +e.target.value;
                commit((d) => mapElements(d, ids, (x) => {
                  if (x.type !== "image") return x;
                  const c = x.content.crop;
                  const w = 1 / z, h = 1 / z;
                  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
                  return { ...x, content: { ...x.content, crop: { w, h, x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)) } } };
                }));
              }} />
          </label>
        </section>
      )}

      {els.some((e) => e.type !== "line") && (
        <section>
          <h4>Box</h4>
          <Colour label="Fill" value={st.fill} onChange={(c) => set({ fill: c })} allowNone />
          <Colour label="Stroke" value={st.stroke?.colour} onChange={(c) => set({ stroke: c ? { colour: c, width_mm: st.stroke?.width_mm ?? 0.3, dash: st.stroke?.dash } : undefined })} allowNone />
          <div className="grid4">
            <Num label="Stroke" value={st.stroke?.width_mm} step={0.1} min={0} onChange={(v) => set({ stroke: { colour: st.stroke?.colour ?? "#15202C", width_mm: v, dash: st.stroke?.dash } })} suffix="mm" />
            <Num label="Radius" value={first4(st.radius_mm)} step={0.5} min={0} onChange={(v) => set({ radius_mm: v })} suffix="mm" />
            <Num label="Opacity" value={st.opacity ?? 1} step={0.05} min={0} onChange={(v) => set({ opacity: Math.min(1, Math.max(0, v)) })} />
          </div>
          {el.type === "shape" && els.length === 1 && (
            <div className="seg small" role="group" aria-label="Shape">
              {(["rect", "ellipse"] as const).map((k) => (
                <button key={k} aria-pressed={el.content.shape_kind === k}
                  onClick={() => commit((d) => mapElements(d, ids, (e) => (e.type === "shape" ? { ...e, content: { shape_kind: k } } : e)))}>{k === "rect" ? "Rectangle" : "Ellipse"}</button>
              ))}
            </div>
          )}
        </section>
      )}

      {els.some((e) => e.type === "line") && (
        <section>
          <h4>Line</h4>
          <Colour label="Colour" value={st.stroke?.colour} onChange={(c) => set({ stroke: { colour: c ?? "#15202C", width_mm: st.stroke?.width_mm ?? 0.3, dash: st.stroke?.dash } })} />
          <div className="grid4">
            <Num label="Width" value={st.stroke?.width_mm ?? 0.3} step={0.1} min={0.05} onChange={(v) => set({ stroke: { colour: st.stroke?.colour ?? "#15202C", width_mm: v, dash: st.stroke?.dash } })} suffix="mm" />
          </div>
          <div className="seg small" role="group" aria-label="Dash">
            {(["solid", "dashed", "dotted"] as const).map((k) => (
              <button key={k} aria-pressed={(st.stroke?.dash ?? "solid") === k} onClick={() => set({ stroke: { colour: st.stroke?.colour ?? "#15202C", width_mm: st.stroke?.width_mm ?? 0.3, dash: k } })}>{k}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
