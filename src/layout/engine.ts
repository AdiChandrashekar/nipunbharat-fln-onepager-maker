/**
 * Auto-population engine: selection + template + resolved tier config → pages of free-form elements.
 * Every block is measured with real rendered text (measure.ts) before it is placed, then blocks flow
 * into columns and pages ("newspaper" order). After this, elements are ordinary model elements.
 */
import { imageById, imagesForBucket, imagesForCompetency, imagesForRoutine, imagesForStrategy } from "../data/compendium";
import { alsoText, continuedText, groupText, itemText, label, pointerText } from "../content/fields";
import { minBodyPt } from "../model/pageSizes";
import type { Binding, Element, OnePagerDocument, OptionalField, Page, PageSetup, Style, Tier } from "../model/types";
import { uid } from "../model/units";
import { resolve, type ResolvedEntry, type ResolvedGroup } from "../selection/selection";
import type { TableColumn, TemplateDef, TierSpec } from "../templates/types";
import { tint } from "../theme/tokens";
import { measureTextHeight, measureTextWidth } from "./measure";

// ---------------------------------------------------------------- config

export interface LayoutConfig {
  tier: Tier;
  /**
   * Rung within the tier. 0 = the tier as designed; 1 = optional fields left out;
   * compact only: 2 = images shrunk as well, 3 = core text at the page's readable minimum.
   */
  step: number;
  spec: TierSpec; // scaled to the page
  cols: number;
  colW: number;
  fields: Set<OptionalField>;
  table?: TableColumn[];
}

const A4_AREA = 210 * 297;

/** `units`: how many cards the selection makes (groups or strategies); never lay out more columns than that. */
export function makeConfig(t: TemplateDef, tierName: Tier, step: number, page: PageSetup, forced: OptionalField[] = [], units = Infinity): LayoutConfig {
  const base = t.tiers[tierName];
  const f = Math.min(1.5, Math.max(0.7, Math.sqrt((page.width_mm * page.height_mm) / A4_AREA)));
  const minBody = minBodyPt(page);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  let type = Object.fromEntries(Object.entries(base.type).map(([k, v]) => [k, r1(v * f)])) as TierSpec["type"];
  if (step >= 3) {
    // Last resort before adding pages: core text down to the page's readable minimum.
    type = { ...type, title: r1(type.title * 0.85), subtitle: r1(Math.max(minBody, type.subtitle * 0.9)),
      group: r1(minBody + 2.5), name: r1(minBody + 1), body: minBody, meta: r1(minBody - 1.5) };
  }
  type.body = Math.max(type.body, minBody);
  type.meta = Math.max(type.meta, r1(minBody - 1.5));
  type.name = Math.max(type.name, type.body + 0.5);
  type.group = Math.max(type.group, type.name + 1);
  const shrink = step >= 2;
  const image = { ...base.image, frac: shrink && base.image.placement === "right" ? base.image.frac * 0.62 : base.image.frac };
  if (shrink && base.image.placement === "top") image.frac = 0.6; // hero images shrink to 60 % of the card width
  const spec: TierSpec = {
    ...base,
    type,
    image,
    col_width_mm: base.col_width_mm * f,
    gap_mm: base.gap_mm * f,
    block_gap_mm: base.block_gap_mm * f,
    frame_pad_mm: base.frame_pad_mm * f,
  };
  const contentW = page.width_mm - page.margins_mm.left - page.margins_mm.right;
  const maxCols = base.max_cols[page.orientation];
  let cols = Math.max(1, Math.min(maxCols, Math.round((contentW + spec.gap_mm) / (spec.col_width_mm + spec.gap_mm))));
  while (cols > 1 && (contentW - spec.gap_mm * (cols - 1)) / cols < 48 * f) cols--;
  cols = Math.max(1, Math.min(cols, units)); // two posters on a landscape page: two columns, not three with one empty
  const colW = (contentW - spec.gap_mm * (cols - 1)) / cols;
  // Order of sacrifice: optional fields go first (step ≥ 1), then image size (2), then text size (3).
  const fields = new Set<OptionalField>([...(step >= 1 ? [] : base.fields), ...forced]);
  return { tier: tierName, step, spec, cols, colW, fields, table: t.table?.[tierName] };
}

/**
 * Tier ladder from most spacious to most compact. Each tier first tries its own optional fields, then
 * leaves them out (so a spacious page isn't abandoned just for a read-more paragraph); compact then
 * shrinks images and finally takes core text to the minimum readable size.
 */
export function configLadder(t: TemplateDef, page: PageSetup, forced: OptionalField[], units = Infinity): LayoutConfig[] {
  const rungs: [Tier, number][] = [["spacious", 0], ["spacious", 1], ["standard", 0], ["standard", 1], ["compact", 0], ["compact", 1], ["compact", 2], ["compact", 3]];
  return rungs
    .map(([tier, step]) => makeConfig(t, tier, step, page, forced, units))
    // A "leave fields out" rung is pointless when the tier shows no optional fields anyway.
    .filter((c, i, all) => !(c.step === 1 && all[i - 1].tier === c.tier && all[i - 1].fields.size === c.fields.size));
}

// ---------------------------------------------------------------- element factories

interface Ctx {
  doc: OnePagerDocument;
  t: TemplateDef;
  cfg: LayoutConfig;
  P: Record<string, string>;
  F: OnePagerDocument["theme"]["fonts"];
  z: number;
  /** Usable column height (mm) on continuation pages; hero images are capped against it. */
  colH: number;
}

interface Block {
  h: number;
  /** Card frame key: consecutive blocks with the same key in a column share one background. */
  frame?: string;
  frameStyle?: Style;
  keepWithNext?: boolean;
  /** Selection group this block belongs to; a group continuing into a new column gets a "continued" label. */
  group?: string;
  cont?: Block;
  /** One strategy's blocks (main + its fields) share a unit and move to a new column together when they fit. */
  unit?: string;
  render(ctx: Ctx, x: number, y: number): Element[];
}

const R = (v: number) => Math.round(v * 100) / 100;

function textEl(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, style: Style, binding?: Binding, name?: string): Element {
  return { id: uid(), name, type: "text", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: ctx.z++, locked: false, style, content: { text }, binding };
}

function rectEl(ctx: Ctx, x: number, y: number, w: number, h: number, style: Style, name: string, z?: number): Element {
  return { id: uid(), name, type: "shape", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: z ?? ctx.z++, locked: false, style, content: { shape_kind: "rect" } };
}

function lineEl(ctx: Ctx, x: number, y: number, w: number, colour: string, width: number, name: string): Element {
  return { id: uid(), name, type: "line", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: 0, rotation: 0, z: ctx.z++, locked: false, style: { stroke: { colour, width_mm: width } }, content: { line: true } };
}

function imageEl(ctx: Ctx, x: number, y: number, w: number, h: number, imageId: string, binding: Binding): Element {
  const im = imageById.get(imageId)!;
  return {
    id: uid(), name: im.caption_en, type: "image", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: ctx.z++, locked: false,
    style: { stroke: { colour: ctx.P.rule, width_mm: 0.25 }, radius_mm: 1.5, fill: "#FFFFFF" },
    content: { image_ref: `tg:${imageId}`, natural_px: [im.width_px, im.height_px], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover", alt: ctx.doc.language === "en" ? im.caption_en : im.caption_hi },
    binding,
  };
}

/** A vertical stack of text pieces, measured once; renders at any (x, y). */
interface Piece { text: string; style: Style; binding?: Binding; name?: string; gapBefore?: number }
function stack(pieces: Piece[], w: number) {
  const hs = pieces.map((p) => (p.text ? measureTextHeight(p.text, p.style, w) : 0));
  const h = pieces.reduce((a, p, i) => a + (p.text ? hs[i] + (i && p.gapBefore ? p.gapBefore : 0) : 0), 0);
  return {
    h,
    render(ctx: Ctx, x: number, y: number): Element[] {
      const out: Element[] = [];
      let cy = y;
      pieces.forEach((p, i) => {
        if (!p.text) return;
        if (i && p.gapBefore) cy += p.gapBefore;
        out.push(textEl(ctx, x, cy, w, hs[i], p.text, p.style, p.binding, p.name));
        cy += hs[i];
      });
      return out;
    },
  };
}

// ---------------------------------------------------------------- styles

function styles(ctx: Ctx, domain: string) {
  const { P, F, cfg } = ctx;
  const t = cfg.spec.type;
  const dom = P[`d_${domain}`] ?? P.accent;
  return {
    dom,
    code: { font_family: F.mono, font_size_pt: Math.max(t.meta, t.group * 0.55), weight: 500, colour: dom, fill: tint(dom, 0.84), radius_mm: [3, 3, 3, 1], padding_mm: [0.5, 2, 0.3, 2], line_height: 1.45 } as Style,
    group: { font_family: F.display, font_size_pt: t.group, line_height: 1.25, colour: P.ink } as Style,
    secondary: { font_family: F.body, font_size_pt: t.meta, line_height: 1.3, colour: P.muted } as Style,
    chip: { font_family: F.body, font_size_pt: t.meta, line_height: 1.35, colour: P.mark, fill: P.mark_bg, radius_mm: [2.5, 2.5, 2.5, 0.8], padding_mm: [0.7, 2, 0.5, 2] } as Style,
    name: { font_family: F.body, font_size_pt: t.name, weight: 700, line_height: 1.25, colour: dom } as Style,
    also: { font_family: F.body, font_size_pt: t.meta, line_height: 1.3, colour: P.mark, weight: 500 } as Style,
    body: { font_family: F.body, font_size_pt: t.body, line_height: 1.42, colour: P.ink } as Style,
    fieldLabel: { font_family: F.body, font_size_pt: t.meta, weight: 700, line_height: 1.3, colour: P.muted } as Style,
    field: { font_family: F.body, font_size_pt: Math.max(t.meta, t.body - 0.8), line_height: 1.4, colour: P.ink } as Style,
    pointer: { font_family: F.body, font_size_pt: t.meta, line_height: 1.35, colour: P.muted } as Style,
  };
}

function domainOf(g: ResolvedGroup): string {
  return groupText(g.group, "hi").domain;
}

function groupBinding(g: ResolvedGroup, field: string): Binding {
  const { kind, id } = g.group;
  return kind === "competency" ? { competency_id: id, field } : kind === "bucket" ? { bucket_id: id, field } : { field: `routines_${field}` };
}

function itemBinding(e: ResolvedEntry, field: string): Binding {
  return e.kind === "routine" ? { routine_id: e.id, field } : { strategy_id: e.id, field };
}

function primaryImage(e: ResolvedEntry): string | undefined {
  return (e.kind === "routine" ? imagesForRoutine(e.id) : imagesForStrategy(e.id))[0];
}

function groupImage(g: ResolvedGroup): string | undefined {
  const first = g.entries.find((e) => !e.pointerTo);
  if (first) return primaryImage(first);
  const { kind, id } = g.group;
  return (kind === "competency" ? imagesForCompetency(id) : kind === "bucket" ? imagesForBucket(id) : imagesForRoutine("DR1"))[0];
}

// ---------------------------------------------------------------- blocks: cards recipe

/** Group heading: the competency / activity name (+ English in bilingual documents). No codes, no chips. */
function headingPieces(ctx: Ctx, g: ResolvedGroup, w: number) {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  return stack([
    { text: gt.name, style: st.group, binding: groupBinding(g, "name"), name: "competency name" },
    { text: gt.name_secondary ?? "", style: st.secondary, binding: groupBinding(g, "name_english"), name: "competency name (English)", gapBefore: 0.6 },
  ], w);
}

function itemCore(ctx: Ctx, e: ResolvedEntry, w: number, domain: string) {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const also = alsoText(ctx.doc.selection, e.also, lang);
  return stack([
    { text: it.name, style: st.name, binding: itemBinding(e, "name"), name: "strategy name" },
    { text: it.name_secondary ?? "", style: st.secondary, binding: itemBinding(e, "name_english"), name: "strategy name (English)", gapBefore: 0.3 },
    { text: also, style: st.also, binding: itemBinding(e, "also"), name: "also note", gapBefore: 0.3 },
    { text: it.how_to, style: st.body, binding: itemBinding(e, "how_to"), name: "how-to", gapBefore: 1 },
  ], w);
}

/** Main block of one strategy/routine: text with the image beside it or above it. */
function itemMainBlock(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, withImage: boolean): Omit<Block, "frame"> {
  const { spec } = ctx.cfg;
  const img = withImage && spec.image.placement !== "none" ? primaryImage(e) : undefined;
  const gap = 3.5;
  if (img && spec.image.placement === "right") {
    const im = imageById.get(img)!;
    const imgW = w * spec.image.frac;
    const imgH = imgW / im.aspect;
    const core = itemCore(ctx, e, w - imgW - gap, domain);
    return {
      h: Math.max(core.h, imgH),
      render: (c, x, y) => [...core.render(c, x, y), imageEl(c, x + w - imgW, y + 0.6, imgW, imgH, img, itemBinding(e, "image"))],
    };
  }
  if (img && spec.image.placement === "top") {
    const im = imageById.get(img)!;
    // Hero image: full card width, but never taller than half a column (wide landscape columns).
    const imgH = Math.min((w * spec.image.frac) / im.aspect, w * 0.7, ctx.colH * 0.5);
    const imgW = imgH * im.aspect;
    const core = itemCore(ctx, e, w, domain);
    return {
      h: imgH + gap + core.h,
      render: (c, x, y) => [imageEl(c, x + (w - imgW) / 2, y, imgW, imgH, img, itemBinding(e, "image")), ...core.render(c, x, y + imgH + gap)],
    };
  }
  const core = itemCore(ctx, e, w, domain);
  return { h: core.h, render: (c, x, y) => core.render(c, x, y) };
}

const FIELD_ORDER: (OptionalField | "applies")[] = ["english", "explanation", "example", "materials", "variants", "applies", "weeks"];

function fieldBlocks(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Omit<Block, "frame">[] {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const out: Omit<Block, "frame">[] = [];
  for (const f of FIELD_ORDER) {
    const shown = f === "applies" ? ctx.cfg.fields.has("variants") : ctx.cfg.fields.has(f);
    const v = it.optional[f];
    if (!shown || !v || (Array.isArray(v) && !v.length)) continue;
    const value = Array.isArray(v) ? v.map((s) => `• ${s}`).join("\n") : v;
    const s = stack([
      { text: f === "english" ? "" : label(f, lang), style: st.fieldLabel, name: `${f} label` },
      { text: value, style: f === "english" ? { ...st.field, colour: ctx.P.muted } : st.field, binding: itemBinding(e, f), name: f, gapBefore: 0.2 },
    ], w);
    out.push({ h: s.h, render: (c, x, y) => s.render(c, x, y) });
  }
  return out;
}

function pointerBlock(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Omit<Block, "frame"> {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const text = pointerText(ctx.doc.selection, it.name, e.pointerTo!, lang);
  const st = styles(ctx, domain);
  const s = stack([{ text, style: st.pointer, binding: itemBinding(e, "pointer"), name: "cross-reference" }], w);
  return { h: s.h, render: (c, x, y) => s.render(c, x, y) };
}

/** "मौखिक शब्दावली विकास (जारी)" at the top of a column where a group carries on. */
function contBlock(ctx: Ctx, g: ResolvedGroup, w: number, frame?: string, frameStyle?: Style): Block {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  const text = continuedText(gt.name, lang);
  const s = stack([{ text, style: { ...st.fieldLabel, colour: st.dom }, binding: groupBinding(g, "continued"), name: "continued label" }], w);
  return { h: s.h, frame, frameStyle, group: g.group.id, render: (c, x, y) => s.render(c, x, y) };
}

function cardBlocks(ctx: Ctx, groups: ResolvedGroup[]): Block[] {
  const { t, cfg, P } = ctx;
  const pad = cfg.spec.frame_pad_mm;
  const blocks: Block[] = [];
  for (const g of groups) {
    const groupStart = blocks.length;
    const domain = domainOf(g);
    const dom = P[`d_${domain}`] ?? P.accent;
    const groupFrame = t.frame === "group" ? g.group.id : undefined;
    const groupStyle: Style = { fill: tint(dom, 0.92), radius_mm: [4.5, 4.5, 4.5, 1.5] };
    const itemStyle: Style = { fill: "#FFFFFF", stroke: { colour: tint(dom, 0.55), width_mm: 0.3 }, radius_mm: [4, 4, 4, 1.2] };
    const inner = t.frame === "none" ? cfg.colW : cfg.colW - 2 * pad;
    const headW = t.frame === "group" ? inner : cfg.colW;

    // Heading. Competency cards put the group image beside the heading and the first item's core text.
    const entries = [...g.entries];
    const img = t.group_image && cfg.spec.image.placement !== "none" ? groupImage(g) : undefined;
    if (img) {
      const im = imageById.get(img)!;
      const imgW = headW * cfg.spec.image.frac;
      const imgH = imgW / im.aspect;
      const textW = headW - imgW - 3.5;
      const head = headingPieces(ctx, g, textW);
      const firstIdx = entries.findIndex((e) => !e.pointerTo);
      const first = firstIdx >= 0 ? entries.splice(firstIdx, 1)[0] : undefined;
      const core = first ? itemCore(ctx, first, textW, domain) : undefined;
      const coreGap = 2.5;
      const h = Math.max(head.h + (core ? coreGap + core.h : 0), imgH);
      blocks.push({
        h, frame: groupFrame, frameStyle: groupStyle, keepWithNext: false,
        render: (c, x, y) => [
          ...head.render(c, x, y),
          ...(core ? core.render(c, x, y + head.h + coreGap) : []),
          imageEl(c, x + headW - imgW, y + 0.5, imgW, imgH, img, first ? itemBinding(first, "image") : groupBinding(g, "image")),
        ],
      });
      if (first) for (const fb of fieldBlocks(ctx, first, headW, domain)) blocks.push({ ...fb, frame: groupFrame, frameStyle: groupStyle, unit: `${g.group.id}/${first.id}` });
    } else {
      const head = headingPieces(ctx, g, headW);
      const rule = t.heading_style === "section";
      const ruleGap = rule ? 2.2 : 0;
      blocks.push({
        h: head.h + ruleGap, frame: groupFrame, frameStyle: groupStyle, keepWithNext: true,
        render: (c, x, y) => [...(rule ? [lineEl(c, x, y, headW, dom, 0.7, "section rule")] : []), ...head.render(c, x, y + ruleGap)],
      });
    }

    entries.forEach((e, i) => {
      if (e.pointerTo) {
        blocks.push({ ...pointerBlock(ctx, e, t.frame === "item" ? cfg.colW : inner, domain), frame: groupFrame, frameStyle: groupStyle });
        return;
      }
      const itemFrame = t.frame === "item" ? `${g.group.id}/${e.id}` : groupFrame;
      const style = t.frame === "item" ? itemStyle : groupStyle;
      const w = t.frame === "item" ? cfg.colW - 2 * pad : inner;
      const main = itemMainBlock(ctx, e, w, domain, t.item_image);
      // Deep-dive (no frames) separates items with a hairline.
      const divider = t.frame === "none" && (i > 0 || img) ? 2.5 : 0;
      const unit = `${g.group.id}/${e.id}`;
      blocks.push({
        h: main.h + divider, frame: itemFrame, frameStyle: style, unit,
        render: (c, x, y) => [...(divider ? [lineEl(c, x, y, w, P.rule, 0.25, "divider")] : []), ...main.render(c, x, y + divider)],
      });
      for (const fb of fieldBlocks(ctx, e, w, domain)) blocks.push({ ...fb, frame: itemFrame, frameStyle: style, unit });
    });
    // The label sits inside the group card (competency cards) or above the item cards (other templates).
    const cont = contBlock(ctx, g, headW, groupFrame, groupStyle);
    blocks.slice(groupStart).forEach((b, i) => {
      b.group = g.group.id;
      if (i > 0) b.cont = cont;
    });
  }
  return blocks;
}

// ---------------------------------------------------------------- blocks: table recipe

function tableBlocks(ctx: Ctx, groups: ResolvedGroup[], width: number): { header: Block; rows: Block[] } {
  const { cfg, P, F, doc } = ctx;
  const lang = doc.language;
  const cols = cfg.table!;
  const pad = cfg.spec.frame_pad_mm;
  const colX = (i: number) => cols.slice(0, i).reduce((a, c) => a + c.frac * width, 0);
  const cellW = (i: number) => cols[i].frac * width - 2 * pad;
  const hdrStyle: Style = { font_family: F.body, font_size_pt: cfg.spec.type.meta + 0.5, weight: 700, line_height: 1.3, colour: P.accent_ink };
  const hdrH = Math.max(...cols.map((c, i) => measureTextHeight((lang === "en" ? c.label_en : c.label_hi) || " ", hdrStyle, cellW(i)))) + 2 * pad;
  const header: Block = {
    h: hdrH,
    render: (c, x, y) => [
      rectEl(c, x, y, width, hdrH, { fill: P.accent, radius_mm: [2, 2, 0, 0] }, "table header"),
      ...cols.map((col, i) => textEl(c, x + colX(i) + pad, y + pad, cellW(i), hdrH - 2 * pad, (lang === "en" ? col.label_en : col.label_hi) || "", hdrStyle, undefined, `header ${col.key}`)),
    ],
  };

  const rows: Block[] = [];
  for (const g of groups) {
    const groupStart = rows.length;
    const domain = domainOf(g);
    const dom = P[`d_${domain}`] ?? P.accent;
    const st = styles(ctx, domain);
    const head = headingPieces(ctx, g, width - 2 * pad);
    const gh = head.h + 2 * pad;
    rows.push({
      h: gh, keepWithNext: true,
      render: (c, x, y) => [rectEl(c, x, y, width, gh, { fill: tint(dom, 0.9) }, "group row"), ...head.render(c, x + pad, y + pad)],
    });
    for (const e of g.entries) {
      if (e.pointerTo) {
        const p = pointerBlock(ctx, e, width - 2 * pad, domain);
        rows.push({ h: p.h + 2 * pad, render: (c, x, y) => [...p.render(c, x + pad, y + pad), lineEl(c, x, y + p.h + 2 * pad, width, P.rule, 0.25, "row rule")] });
        continue;
      }
      const it = itemText(e.kind, e.id, lang);
      const cells: ({ h: number; render: (c: Ctx, x: number, y: number) => Element[] })[] = cols.map((col, i) => {
        const w = cellW(i);
        if (col.key === "name") {
          return itemCoreNameOnly(ctx, e, w, domain);
        }
        if (col.key === "how_to") {
          return stack([
            { text: it.how_to, style: st.body, binding: itemBinding(e, "how_to"), name: "how-to" },
            { text: cfg.fields.has("english") ? (it.optional.english as string) ?? "" : "", style: { ...st.field, colour: P.muted }, binding: itemBinding(e, "english"), name: "english", gapBefore: 1 },
          ], w);
        }
        if (col.key === "details") {
          const pieces: Piece[] = [];
          for (const f of FIELD_ORDER) {
            if (f === "english") continue;
            const shown = f === "applies" ? cfg.fields.has("variants") : cfg.fields.has(f);
            const v = it.optional[f];
            if (!shown || !v || (Array.isArray(v) && !v.length)) continue;
            pieces.push({ text: label(f, lang), style: st.fieldLabel, name: `${f} label`, gapBefore: pieces.length ? 1.2 : 0 });
            pieces.push({ text: Array.isArray(v) ? v.map((s) => `• ${s}`).join("\n") : v, style: st.field, binding: itemBinding(e, f), name: f, gapBefore: 0.2 });
          }
          return stack(pieces, w);
        }
        const img = primaryImage(e);
        if (!img) return { h: 0, render: () => [] };
        const im = imageById.get(img)!;
        const ih = w / im.aspect;
        return { h: ih, render: (c, x, y) => [imageEl(c, x, y, w, ih, img, itemBinding(e, "image"))] };
      });
      const rh = Math.max(...cells.map((c) => c.h)) + 2 * pad;
      rows.push({
        h: rh,
        render: (c, x, y) => [
          ...cells.flatMap((cell, i) => cell.render(c, x + colX(i) + pad, y + pad)),
          lineEl(c, x, y + rh, width, P.rule, 0.25, "row rule"),
        ],
      });
    }
    const c0 = contBlock(ctx, g, width - 2 * pad);
    const cont: Block = {
      ...c0, h: c0.h + 2 * pad,
      render: (c, x, y) => [rectEl(c, x, y, width, c0.h + 2 * pad, { fill: tint(dom, 0.94) }, "group row (continued)"), ...c0.render(c, x + pad, y + pad)],
    };
    rows.slice(groupStart).forEach((b, i) => {
      b.group = g.group.id;
      if (i > 0) b.cont = cont;
    });
  }
  return { header, rows };
}

function itemCoreNameOnly(ctx: Ctx, e: ResolvedEntry, w: number, domain: string) {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const also = alsoText(ctx.doc.selection, e.also, lang);
  return stack([
    { text: it.name, style: st.name, binding: itemBinding(e, "name"), name: "strategy name" },
    { text: it.name_secondary ?? "", style: st.secondary, binding: itemBinding(e, "name_english"), name: "strategy name (English)", gapBefore: 0.3 },
    { text: also, style: st.also, binding: itemBinding(e, "also"), name: "also note", gapBefore: 0.5 },
  ], w);
}

// ---------------------------------------------------------------- page furniture

function headerFooter(ctx: Ctx) {
  const { doc, cfg, P, F } = ctx;
  const { width_mm: W, height_mm: H, margins_mm: m, bleed_mm: bleed } = doc.page;
  const lang = doc.language;
  const t = cfg.spec.type;
  const innerW = W - m.left - m.right;
  const title = doc.title || label("defaultTitle", lang);
  const titleStyle: Style = { font_family: F.display, font_size_pt: t.title, line_height: 1.2, colour: P.accent_ink };
  const subStyle: Style = { font_family: F.body, font_size_pt: t.subtitle, line_height: 1.3, colour: "#DCE6F5" };
  const logoH = doc.meta.logo_ref ? t.title * 0.3528 * 1.6 : 0;
  const titleW = innerW - (logoH ? logoH * 2.2 + 4 : 0);
  const titleH = measureTextHeight(title, titleStyle, titleW);
  const sub = doc.meta.subtitle;
  const subH = sub ? measureTextHeight(sub, subStyle, titleW) : 0;
  const top = m.top * 0.8;
  const bandBottom = top + titleH + (subH ? 1 + subH : 0) + m.top * 0.6;

  const runStyle: Style = { font_family: F.body, font_size_pt: t.meta + 0.5, weight: 600, line_height: 1.3, colour: P.accent };
  const runH = measureTextHeight(title, runStyle, innerW * 0.8);
  const footStyle: Style = { font_family: F.body, font_size_pt: Math.max(6.5, t.meta - 0.5), line_height: 1.35, colour: P.muted };
  const credit = label("credit", lang);
  const creditW = innerW * 0.62;
  const creditH = measureTextHeight(credit, footStyle, creditW);
  const footTop = H - m.bottom - creditH;
  const metaText = [doc.meta.organisation, doc.meta.author, doc.meta.date].filter(Boolean).join(" · ");
  const gap = cfg.spec.gap_mm;

  return {
    contentTop: (p: number) => (p === 0 ? bandBottom + gap * 0.9 : m.top + runH + 2.5 + gap * 0.5),
    contentBottom: footTop - 2 - gap * 0.6,
    render(c: Ctx, p: number, pages: number): Element[] {
      const out: Element[] = [];
      if (p === 0) {
        out.push(rectEl(c, -bleed, -bleed, W + 2 * bleed, bandBottom + bleed, { fill: P.accent }, "header band"));
        out.push(textEl(c, m.left, top, titleW, titleH, title, titleStyle, { field: "title" }, "title"));
        if (sub) out.push(textEl(c, m.left, top + titleH + 1, titleW, subH, sub, subStyle, { field: "subtitle" }, "subtitle"));
        if (doc.meta.logo_ref) {
          const lw = logoH * 2.2;
          out.push({
            id: uid(), name: "logo", type: "image", x_mm: R(W - m.right - lw), y_mm: R(top), w_mm: R(lw), h_mm: R(logoH), rotation: 0, z: c.z++, locked: false,
            style: {}, content: { image_ref: doc.meta.logo_ref, natural_px: doc.meta.logo_px ?? [lw * 10, logoH * 10], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "contain" }, binding: { field: "logo" },
          });
        }
      } else {
        out.push(textEl(c, m.left, m.top, innerW * 0.8, runH, title, runStyle, { field: "running_title" }, "running title"));
        out.push(lineEl(c, m.left, m.top + runH + 1.5, innerW, P.rule, 0.3, "header rule"));
      }
      out.push(lineEl(c, m.left, footTop - 2, innerW, P.rule, 0.3, "footer rule"));
      out.push(textEl(c, m.left, footTop, creditW, creditH, credit, footStyle, { field: "footer_credit" }, "source credit"));
      const pageNo = `${label("page", lang)} ${p + 1} / ${pages}`;
      const rightW = innerW - creditW - 4;
      const rightText = metaText ? `${metaText}\n${pageNo}` : pageNo;
      const rightH = measureTextHeight(rightText, { ...footStyle, align: "right" }, rightW);
      out.push(textEl(c, W - m.right - rightW, H - m.bottom - rightH, rightW, rightH, rightText, { ...footStyle, align: "right" }, { field: "footer_meta" }, "org · author · date · page"));
      return out;
    },
  };
}

// ---------------------------------------------------------------- pagination

interface Placed { block: Block; page: number; col: number; y: number }

export interface LayoutResult {
  pages: Page[];
  overflow: boolean;
}

interface PlaceOpts {
  cols: number;
  firstPage: number;
  top: (page: number) => number;
  bottom: number;
  gap: number;
  frameGap: number;
  pad: number;
  /** Table header, repeated at the top of every column. */
  header?: Block;
  /** Group of the block before the first one (for "continued" labels when laying out a tail). */
  prevGroup?: string;
  /** Give up (return null) instead of opening a page beyond this one. */
  maxPage?: number;
}

/** Flows blocks into columns and pages. */
function place(blocks: Block[], o: PlaceOpts): { placed: Placed[]; lastPage: number; overflow: boolean } | null {
  const placed: Placed[] = [];
  let overflow = false;
  let page = o.firstPage, col = 0;
  let y = 0;
  let colStart = true;
  let prevFrame: string | undefined;
  let prevGroup: string | undefined = o.prevGroup;

  const put = (b: Block) => {
    placed.push({ block: b, page, col, y });
    y += b.h;
  };
  const startColumn = () => {
    y = o.top(page);
    colStart = true;
    prevFrame = undefined;
    if (o.header) put(o.header);
  };
  startColumn();

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    // A group carrying on at the top of a new column gets its "continued" label first.
    const cont = colStart && b.cont && b.group === prevGroup ? b.cont : undefined;
    const lead = colStart ? 0 : b.frame !== prevFrame ? o.frameGap : o.gap;
    const padTop = b.frame !== undefined && (b.frame !== prevFrame || cont) ? o.pad : 0;
    let need = lead + padTop + (cont ? cont.h + o.gap : 0) + b.h + (b.frame ? o.pad : 0);
    if (b.keepWithNext && next) need += o.gap + next.h + (next.frame ? o.pad : 0);
    // Keep a strategy's blocks together: at its first block, ask for room for the whole unit — unless the unit
    // is taller than a column anyway, in which case it may split.
    if (b.unit && blocks[i - 1]?.unit !== b.unit) {
      let rest = 0;
      for (let j = i + 1; j < blocks.length && blocks[j].unit === b.unit; j++) rest += o.gap + blocks[j].h;
      if (rest && need + rest <= o.bottom - o.top(page)) need += rest;
    }
    if (y + need > o.bottom && !colStart) {
      col++;
      if (col >= o.cols) {
        col = 0;
        page++;
        if (o.maxPage !== undefined && page > o.maxPage) return null;
      }
      startColumn();
      i--; // retry this block at the top of the new column
      continue;
    }
    y += lead + padTop;
    if (cont) {
      put(cont);
      y += o.gap;
    }
    if (y + b.h > o.bottom + 0.01) overflow = true; // taller than a whole column: placed anyway, flagged
    put(b);
    if (b.frame !== undefined && (!next || next.frame !== b.frame)) y += o.pad;
    prevFrame = b.frame;
    prevGroup = b.group;
    colStart = false;
  }
  return { placed, lastPage: page, overflow };
}

export function layoutDocument(doc: OnePagerDocument, t: TemplateDef, cfg: LayoutConfig, groups = resolve(doc.selection)): LayoutResult {
  const ctx: Ctx = { doc, t, cfg, P: doc.theme.palette, F: doc.theme.fonts, z: 100, colH: 1e6 };
  const { margins_mm: m } = doc.page;
  const hf = headerFooter(ctx);
  ctx.colH = hf.contentBottom - hf.contentTop(1);
  const isTable = t.recipe === "table";
  const tableW = doc.page.width_mm - m.left - m.right;
  const { header: tableHeader, rows } = isTable ? tableBlocks(ctx, groups, tableW) : { header: undefined, rows: [] };
  const blocks = isTable ? rows : cardBlocks(ctx, groups);
  const cols = isTable ? 1 : cfg.cols;
  const colW = isTable ? tableW : cfg.colW;
  const pad = cfg.spec.frame_pad_mm;
  const gap = cfg.spec.block_gap_mm;
  const opts: PlaceOpts = {
    cols, firstPage: 0, top: hf.contentTop, bottom: hf.contentBottom, gap, pad, header: tableHeader,
    frameGap: t.frame === "none" ? gap * 1.6 : Math.max(gap * 1.4, 3),
  };
  const full = place(blocks, opts)!;
  let placed = full.placed;
  const overflow = full.overflow;
  const page = full.lastPage;

  // Balance the last page's columns: the lowest bottom edge that still holds its blocks on that page.
  if (cols > 1) {
    const first = placed.find((p) => p.page === page && p.block !== tableHeader && blocks.includes(p.block));
    const startBlock = first ? blocks.indexOf(first.block) : -1;
    if (startBlock >= 0) {
      const tail = blocks.slice(startBlock);
      let lo = hf.contentTop(page), hi = hf.contentBottom;
      let best: Placed[] | null = null;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        const r = place(tail, { ...opts, firstPage: page, bottom: mid, maxPage: page, prevGroup: blocks[startBlock - 1]?.group });
        // Balancing may not break a strategy across columns (the full pass only does so when it's taller than one).
        const unitCol = new Map<string, number>();
        const splits = r?.placed.some((pl) => {
          const u = pl.block.unit;
          if (!u) return false;
          if (unitCol.has(u) && unitCol.get(u) !== pl.col) return true;
          unitCol.set(u, pl.col);
          return false;
        });
        if (r && !r.overflow && !splits) { best = r.placed; hi = mid; } else lo = mid;
      }
      if (best) placed = [...placed.filter((p) => p.page < page), ...best];
    }
  }

  const pageCount = Math.max(1, page + 1);
  const x0 = (c: number) => m.left + c * (colW + cfg.spec.gap_mm);
  const pages: Page[] = Array.from({ length: pageCount }, () => ({ id: uid("page"), elements: [] as Element[] }));

  // Frames: one background per contiguous run of same-frame blocks in a column.
  let frameZ = 10;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p.block.frame) continue;
    const prev = placed[i - 1];
    if (prev && prev.block.frame === p.block.frame && prev.page === p.page && prev.col === p.col) continue;
    let j = i;
    while (placed[j + 1] && placed[j + 1].block.frame === p.block.frame && placed[j + 1].page === p.page && placed[j + 1].col === p.col) j++;
    const last = placed[j];
    const top = p.y - pad;
    const h = last.y + last.block.h + pad - top;
    pages[p.page].elements.push(rectEl(ctx, x0(p.col), top, colW, h, p.block.frameStyle ?? {}, "card", frameZ++));
  }
  for (const p of placed) {
    const inset = p.block.frame ? pad : 0;
    pages[p.page].elements.push(...p.block.render(ctx, x0(p.col) + inset, p.y));
  }
  pages.forEach((pg, i) => pg.elements.push(...hf.render(ctx, i, pageCount)));
  return { pages, overflow };
}
