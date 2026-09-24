/**
 * Auto-population engine: selection + template + resolved tier config → pages of free-form elements.
 * Every block is measured with real rendered text (measure.ts) before it is placed, then blocks flow
 * into columns and pages ("newspaper" order). After this, elements are ordinary model elements.
 */
import { imageById, imagesForBucket, imagesForCompetency, imagesForRoutine, imagesForStrategy } from "../data/compendium";
import { alsoText, continuedText, domainName, groupText, howToSteps, itemText, label, pointerText, summaryText } from "../content/fields";
import { minBodyPt } from "../model/pageSizes";
import type { Binding, Element, OnePagerDocument, OptionalField, Page, PageSetup, Style, TextContent, Tier } from "../model/types";
import { uid } from "../model/units";
import { resolve, selectionCounts, type ResolvedEntry, type ResolvedGroup } from "../selection/selection";
import type { TableColumn, TemplateDef, TierSpec } from "../templates/types";
import { tint } from "../theme/tokens";
import { measureTextHeight } from "./measure";

// ---------------------------------------------------------------- config

export interface LayoutConfig {
  tier: Tier;
  /** Scale on the tier's type and spacing (> 1 when a small selection grows to fill the page). */
  grow: number;
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

/**
 * `units`: how many cards the selection makes (groups or strategies); never lay out more columns than that.
 * `grow`: scale type and spacing up (spacious tier only), so a small selection fills its page.
 */
export function makeConfig(t: TemplateDef, tierName: Tier, step: number, page: PageSetup, forced: OptionalField[] = [], units = Infinity, grow = 1): LayoutConfig {
  const base = t.tiers[tierName];
  const f = Math.min(1.5, Math.max(0.7, Math.sqrt((page.width_mm * page.height_mm) / A4_AREA)));
  const minBody = minBodyPt(page);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  // The title grows more slowly than the text: it is already large.
  let type = Object.fromEntries(Object.entries(base.type).map(([k, v]) => [k, r1(v * f * (k === "title" ? Math.sqrt(grow) : grow))])) as TierSpec["type"];
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
    block_gap_mm: base.block_gap_mm * f * grow,
    frame_pad_mm: base.frame_pad_mm * f * Math.sqrt(grow),
  };
  const contentW = page.width_mm - page.margins_mm.left - page.margins_mm.right;
  const maxCols = base.max_cols[page.orientation];
  let cols = Math.max(1, Math.min(maxCols, Math.round((contentW + spec.gap_mm) / (spec.col_width_mm + spec.gap_mm))));
  while (cols > 1 && (contentW - spec.gap_mm * (cols - 1)) / cols < 48 * f) cols--;
  cols = Math.max(1, Math.min(cols, units)); // two posters on a landscape page: two columns, not three with one empty
  const colW = (contentW - spec.gap_mm * (cols - 1)) / cols;
  // Order of sacrifice: optional fields go first (step ≥ 1), then image size (2), then text size (3).
  const fields = new Set<OptionalField>([...(step >= 1 ? [] : base.fields), ...forced]);
  return { tier: tierName, grow, step, spec, cols, colW, fields, table: t.table?.[tierName] };
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
  /** TG images already placed: each picture appears once per document. */
  usedImages: Set<string>;
  /** Width inside the margins (full-width section headings). */
  contentW: number;
}

/** Card accent: a solid domain-colour strip along one edge of the card. */
interface FrameAccent { colour: string; side: "top" | "left"; size: number }

interface Block {
  h: number;
  /** Card frame key: consecutive blocks with the same key in a column share one background. */
  frame?: string;
  frameStyle?: Style;
  frameAccent?: FrameAccent;
  keepWithNext?: boolean;
  /** Full-width section heading: its group's blocks flow in columns beneath it. */
  span?: boolean;
  /** Selection group this block belongs to; a group continuing into a new column gets a "continued" label. */
  group?: string;
  cont?: Block;
  /** One strategy's blocks (main + its fields) share a unit and move to a new column together when they fit. */
  unit?: string;
  render(ctx: Ctx, x: number, y: number): Element[];
}

const R = (v: number) => Math.round(v * 100) / 100;
const PT = 0.3528; // mm per point

type Runs = NonNullable<TextContent["runs"]>;

function textEl(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, style: Style, binding?: Binding, name?: string, runs?: Runs): Element {
  return { id: uid(), name, type: "text", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: ctx.z++, locked: false, style, content: runs ? { text, runs } : { text }, binding };
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
    style: { stroke: { colour: ctx.P.rule, width_mm: 0.2 }, radius_mm: 2, fill: "#FFFFFF" },
    content: { image_ref: `tg:${imageId}`, natural_px: [im.width_px, im.height_px], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover", alt: ctx.doc.language === "en" ? im.caption_en : im.caption_hi },
    binding,
  };
}

/** Something measured once that renders at any (x, y). */
interface Part { h: number; render(ctx: Ctx, x: number, y: number): Element[] }
const EMPTY: Part = { h: 0, render: () => [] };

function textPart(text: string, style: Style, w: number, binding?: Binding, name?: string, runs?: Runs): Part {
  if (!text) return EMPTY;
  // Runs may be bolder than the base style: measure at the heaviest weight so the box never clips.
  const heaviest = runs ? Math.max(style.weight ?? 400, ...runs.map((r) => r.style?.weight ?? 400)) as Style["weight"] : style.weight;
  const h = measureTextHeight(text, { ...style, weight: heaviest }, w);
  return { h, render: (c, x, y) => [textEl(c, x, y, w, h, text, style, binding, name, runs)] };
}

/** Parts one under another; `gap` (mm) goes before every non-empty part except the first. */
function vstack(parts: (Part | [Part, number])[], gap = 0): Part {
  const items = parts.map((p) => (Array.isArray(p) ? { part: p[0], gap: p[1] } : { part: p, gap })).filter((p) => p.part.h > 0);
  const h = items.reduce((a, p, i) => a + p.part.h + (i ? p.gap : 0), 0);
  return {
    h,
    render(c, x, y) {
      const out: Element[] = [];
      let cy = y;
      items.forEach((p, i) => {
        if (i) cy += p.gap;
        out.push(...p.part.render(c, x, cy));
        cy += p.part.h;
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
  const kicker: Style = { font_family: F.body, font_size_pt: Math.max(6.5, t.meta - 0.2), weight: 700, line_height: 1.25, colour: dom, letter_spacing_em: 0.03 };
  return {
    dom,
    kicker,
    group: { font_family: F.display, font_size_pt: t.group, line_height: 1.18, colour: P.ink } as Style,
    secondary: { font_family: F.body, font_size_pt: t.meta, line_height: 1.3, colour: P.muted } as Style,
    name: { font_family: F.body, font_size_pt: t.name, weight: 700, line_height: 1.22, colour: P.ink } as Style,
    also: { font_family: F.body, font_size_pt: t.meta, line_height: 1.3, colour: P.muted, weight: 500 } as Style,
    body: { font_family: F.body, font_size_pt: t.body, line_height: 1.42, colour: P.ink } as Style,
    fieldLabel: kicker,
    field: { font_family: F.body, font_size_pt: Math.max(t.meta, t.body - 0.8), line_height: 1.4, colour: P.ink } as Style,
    quiet: { font_family: F.body, font_size_pt: Math.max(t.meta, t.body - 0.8), line_height: 1.4, colour: P.muted } as Style,
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

function itemBinding(e: ResolvedEntry, field: string, part?: number): Binding {
  const b: Binding = e.kind === "routine" ? { routine_id: e.id, field } : { strategy_id: e.id, field };
  if (part !== undefined) b.part = part;
  return b;
}

/**
 * First candidate picture not yet used in this document, so a picture doesn't repeat. Poster cards are built
 * around their picture, so there a used one may repeat rather than leave the card without one.
 */
function takeImage(ctx: Ctx, candidates: string[], reuse = false): string | undefined {
  const id = candidates.find((c) => !ctx.usedImages.has(c)) ?? (reuse ? candidates[0] : undefined);
  if (id) ctx.usedImages.add(id);
  return id;
}

function itemImages(e: ResolvedEntry): string[] {
  return e.kind === "routine" ? imagesForRoutine(e.id) : imagesForStrategy(e.id);
}

function groupImages(g: ResolvedGroup): string[] {
  const { kind, id } = g.group;
  const own = g.entries.filter((e) => !e.pointerTo).flatMap(itemImages);
  return [...own, ...(kind === "competency" ? imagesForCompetency(id) : kind === "bucket" ? imagesForBucket(id) : imagesForRoutine("DR1"))];
}

// ---------------------------------------------------------------- parts

/**
 * Group heading. "section": a short domain-colour bar, the domain as a kicker, then the competency name in
 * the display face. "card": kicker and name only (the card's accent strip does the bar's job). No codes.
 */
function headingPart(ctx: Ctx, g: ResolvedGroup, w: number, withBar: boolean): Part {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  const barH = Math.max(0.9, st.group.font_size_pt! * 0.07);
  const bar: Part = withBar ? { h: barH, render: (c, x, y) => [rectEl(c, x, y, 11, barH, { fill: st.dom, radius_mm: barH / 2 }, "heading bar")] } : EMPTY;
  const kicker = gt.kind === "routines" ? "" : domainName(gt.domain, lang);
  return vstack([
    bar,
    [textPart(kicker, st.kicker, w, groupBinding(g, "domain_name"), "domain"), withBar ? 2.4 : 0],
    [textPart(gt.name, st.group, w, groupBinding(g, "name"), "competency name"), 0.5],
    [textPart(gt.name_secondary ?? "", st.secondary, w, groupBinding(g, "name_english"), "competency name (English)"), 0.5],
  ]);
}

/** Strategy name, English name (bilingual) and the "also supports" note. */
function itemHead(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Part {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  return vstack([
    textPart(it.name, st.name, w, itemBinding(e, "name"), "strategy name"),
    [textPart(it.name_secondary ?? "", st.secondary, w, itemBinding(e, "name_english"), "strategy name (English)"), 0.4],
    [textPart(alsoText(ctx.doc.selection, e.also, lang), st.also, w, itemBinding(e, "also"), "also note"), 0.6],
  ]);
}

/**
 * The how-to as numbered steps: a domain-colour disc with the number, the step beside it. A one-step how-to
 * is plain text. Each step is its own text element (bound to its step), so it can be edited or moved alone.
 * The compact tier runs the steps on in one paragraph with bold coloured numbers, to save lines.
 */
function stepsPart(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, bodyStyle?: Style): Part {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const body = bodyStyle ?? st.body;
  const steps = howToSteps(it.how_to, lang);
  if (steps.length < 2) return textPart(it.how_to, body, w, itemBinding(e, "how_to"), "how-to");
  if (ctx.cfg.tier === "compact") {
    const runs: Runs = steps.flatMap((s, i) => [
      { text: `${i ? "   " : ""}${i + 1} `, style: { weight: 700 as const, colour: st.dom } },
      { text: s },
    ]);
    return textPart(runs.map((r) => r.text).join(""), body, w, itemBinding(e, "how_to"), "how-to", runs);
  }
  const pt = body.font_size_pt!;
  const lineH = pt * PT * (body.line_height ?? 1.42);
  const d = Math.min(lineH * 0.92, pt * PT * 1.32);
  const gutter = d + Math.max(1.6, pt * PT * 0.7);
  const tw = w - gutter;
  const hs = steps.map((s) => measureTextHeight(s, body, tw));
  const gap = pt * PT * 0.5;
  const h = hs.reduce((a, b) => a + b, 0) + gap * (steps.length - 1);
  const badge: Style = {
    font_family: ctx.F.body, font_size_pt: R(pt * 0.74), weight: 700, line_height: 1, colour: "#FFFFFF",
    fill: st.dom, radius_mm: R(d / 2), align: "center", vertical_align: "middle",
  };
  return {
    h,
    render(c, x, y) {
      const out: Element[] = [];
      let cy = y;
      steps.forEach((s, i) => {
        out.push(textEl(c, x, cy + (lineH - d) / 2, d, d, String(i + 1), badge, undefined, `step ${i + 1} number`));
        out.push(textEl(c, x + gutter, cy, tw, hs[i], s, body, itemBinding(e, "how_to", i), `step ${i + 1}`));
        cy += hs[i] + gap;
      });
      return out;
    },
  };
}

/** Name block + steps. */
function itemCore(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Part {
  const nameGap = ctx.cfg.spec.type.body * PT * 0.55;
  return vstack([itemHead(ctx, e, w, domain), [stepsPart(ctx, e, w, domain), nameGap]]);
}

/** Main block of one strategy/routine: core text with the picture beside it or above it. */
function itemMainBlock(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, withImage: boolean): Omit<Block, "frame"> {
  const { spec } = ctx.cfg;
  const img = withImage && spec.image.placement !== "none" ? takeImage(ctx, itemImages(e), ctx.t.tiers.spacious.image.placement === "top") : undefined;
  const gap = 4;
  if (img && spec.image.placement === "right") {
    const im = imageById.get(img)!;
    const imgW = w * spec.image.frac;
    const imgH = imgW / im.aspect;
    const core = itemCore(ctx, e, w - imgW - gap, domain);
    return {
      h: Math.max(core.h, imgH),
      render: (c, x, y) => [...core.render(c, x, y), imageEl(c, x + w - imgW, y + 0.4, imgW, imgH, img, itemBinding(e, "image"))],
    };
  }
  if (img && spec.image.placement === "top") {
    const im = imageById.get(img)!;
    // Hero picture: full card width, but never taller than half a column (wide landscape columns).
    const imgH = Math.min((w * spec.image.frac) / im.aspect, w * 0.68, ctx.colH * 0.45);
    const imgW = imgH * im.aspect;
    const core = itemCore(ctx, e, w, domain);
    return {
      h: imgH + gap + core.h,
      render: (c, x, y) => [imageEl(c, x + (w - imgW) / 2, y, imgW, imgH, img, itemBinding(e, "image")), ...core.render(c, x, y + imgH + gap)],
    };
  }
  return itemCore(ctx, e, w, domain);
}

const FIELD_ORDER: (OptionalField | "applies")[] = ["english", "example", "materials", "explanation", "variants", "applies", "weeks"];

/** Label and value on one line: "सामग्री  रंग · पेंसिल · रबर". */
function inlineField(ctx: Ctx, lab: string, value: string, w: number, domain: string, binding: Binding, name: string): Part {
  const st = styles(ctx, domain);
  const text = `${lab}   ${value}`;
  return textPart(text, st.field, w, binding, name, [
    { text: `${lab}   `, style: { weight: 700, colour: st.dom } },
    { text: value },
  ]);
}

/** One optional field, designed for what it is. */
function fieldPart(ctx: Ctx, e: ResolvedEntry, f: OptionalField | "applies", v: string | string[], w: number, domain: string): Part {
  const lang = ctx.doc.language;
  const st = styles(ctx, domain);
  const P = ctx.P;
  const binding = itemBinding(e, f);
  if (f === "english") return textPart(v as string, st.quiet, w, binding, "english");
  if (f === "materials") return inlineField(ctx, label("materials", lang), (v as string[]).join("  ·  "), w, domain, binding, "materials");
  if (f === "weeks") return inlineField(ctx, label("weeks", lang), v as string, w, domain, binding, "weeks");
  if (f === "example") {
    // Callout: tinted panel with a domain-colour edge.
    const pad = Math.max(1.8, st.field.font_size_pt! * PT * 0.7);
    const edge = 0.9;
    const inner = vstack([
      textPart(label("example", lang), st.kicker, w - 2 * pad - edge, undefined, "example label"),
      [textPart(v as string, st.field, w - 2 * pad - edge, binding, "example"), 0.6],
    ]);
    const h = inner.h + 2 * pad;
    return {
      h,
      render: (c, x, y) => [
        rectEl(c, x, y, w, h, { fill: tint(st.dom, 0.9), radius_mm: [0, 2, 2, 0] }, "example panel"),
        rectEl(c, x, y, edge, h, { fill: st.dom }, "example edge"),
        ...inner.render(c, x + edge + pad, y + pad),
      ],
    };
  }
  if (f === "explanation") {
    // Read-more: quieter text behind a hairline rule.
    const inset = 3;
    const inner = vstack([
      textPart(label("explanation", lang), st.kicker, w - inset, undefined, "explanation label"),
      [textPart(v as string, st.quiet, w - inset, binding, "explanation"), 0.5],
    ]);
    return {
      h: inner.h,
      render: (c, x, y) => [rectEl(c, x, y + 0.4, 0.5, inner.h - 0.4, { fill: tint(st.dom, 0.45) }, "explanation rule"), ...inner.render(c, x + inset, y)],
    };
  }
  // Variants, "when" (routines): label, then a bulleted list.
  const value = Array.isArray(v) ? v.map((s) => `•  ${s}`).join("\n") : v;
  return vstack([
    textPart(label(f, lang), st.kicker, w, undefined, `${f} label`),
    [textPart(value, { ...st.field, colour: P.ink }, w, binding, f), 0.5],
  ]);
}

function fieldBlocks(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Omit<Block, "frame">[] {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const out: Omit<Block, "frame">[] = [];
  for (const f of FIELD_ORDER) {
    const shown = f === "applies" ? ctx.cfg.fields.has("variants") : ctx.cfg.fields.has(f);
    const v = it.optional[f];
    if (!shown || !v || (Array.isArray(v) && !v.length)) continue;
    const p = fieldPart(ctx, e, f, v, w, domain);
    out.push({ h: p.h, render: p.render });
  }
  return out;
}

function pointerBlock(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Omit<Block, "frame"> {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const text = pointerText(ctx.doc.selection, it.name, e.pointerTo!, lang);
  const st = styles(ctx, domain);
  return textPart(text, st.pointer, w, itemBinding(e, "pointer"), "cross-reference");
}

/** "मौखिक शब्दावली विकास (जारी)" at the top of a column where a group carries on. */
function contBlock(ctx: Ctx, g: ResolvedGroup, w: number, frame?: string, frameStyle?: Style, frameAccent?: FrameAccent): Block {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  const p = textPart(continuedText(gt.name, lang), st.kicker, w, groupBinding(g, "continued"), "continued label");
  return { h: p.h, frame, frameStyle, frameAccent, group: g.group.id, render: p.render };
}

function cardBlocks(ctx: Ctx, groups: ResolvedGroup[]): Block[] {
  const { t, cfg, P } = ctx;
  const pad = cfg.spec.frame_pad_mm;
  const blocks: Block[] = [];
  // Poster-style cards (hero pictures): tinted, with the accent along the top.
  const heroCards = t.tiers.spacious.image.placement === "top";
  for (const g of groups) {
    const groupStart = blocks.length;
    const domain = domainOf(g);
    const dom = P[`d_${domain}`] ?? P.accent;
    const groupFrame = t.frame === "group" ? g.group.id : undefined;
    const groupStyle: Style = { fill: tint(dom, 0.93), radius_mm: 3 };
    const groupAccent: FrameAccent = { colour: dom, side: "top", size: 1.6 };
    const itemStyle: Style = heroCards
      ? { fill: tint(dom, 0.95), radius_mm: 3 }
      : { fill: "#FFFFFF", stroke: { colour: tint(dom, 0.7), width_mm: 0.3 }, radius_mm: 3 };
    const itemAccent: FrameAccent = heroCards ? { colour: dom, side: "top", size: 1.6 } : { colour: dom, side: "left", size: 1.4 };
    const inner = t.frame === "none" ? cfg.colW : cfg.colW - 2 * pad;
    const headW = t.frame === "group" ? inner : cfg.colW;
    const sepGap = cfg.spec.type.body * PT * 0.9;

    // Heading. Competency cards put the group picture beside the heading and the first item's core text.
    // Cross-references ("see …") go after the group's own strategies.
    const entries = [...g.entries.filter((e) => !e.pointerTo), ...g.entries.filter((e) => e.pointerTo)];
    const img = t.group_image && cfg.spec.image.placement !== "none" ? takeImage(ctx, groupImages(g)) : undefined;
    if (img) {
      const im = imageById.get(img)!;
      const imgW = headW * cfg.spec.image.frac;
      const imgH = imgW / im.aspect;
      const textW = headW - imgW - 4;
      const head = headingPart(ctx, g, textW, false);
      const firstIdx = entries.findIndex((e) => !e.pointerTo);
      const first = firstIdx >= 0 ? entries.splice(firstIdx, 1)[0] : undefined;
      const core = first ? itemCore(ctx, first, textW, domain) : EMPTY;
      const coreGap = cfg.spec.type.group * PT * 0.9;
      const h = Math.max(head.h + (core.h ? coreGap + core.h : 0), imgH);
      blocks.push({
        h, frame: groupFrame, frameStyle: groupStyle, frameAccent: groupAccent, keepWithNext: false,
        unit: first ? `${g.group.id}/${first.id}` : undefined,
        render: (c, x, y) => [
          ...head.render(c, x, y),
          ...core.render(c, x, y + head.h + coreGap),
          imageEl(c, x + headW - imgW, y + 0.4, imgW, imgH, img, first ? itemBinding(first, "image") : groupBinding(g, "image")),
        ],
      });
      if (first) for (const fb of fieldBlocks(ctx, first, headW, domain)) blocks.push({ ...fb, frame: groupFrame, frameStyle: groupStyle, frameAccent: groupAccent, unit: `${g.group.id}/${first.id}` });
    } else if (t.heading_style === "section" && t.frame !== "group") {
      // Full-width section heading; the group's strategies flow in columns beneath it.
      const head = headingPart(ctx, g, ctx.contentW, true);
      const after = cfg.spec.type.group * PT * 0.9;
      blocks.push({ h: head.h + after, span: true, render: (c, x, y) => head.render(c, x, y) });
    } else {
      const head = headingPart(ctx, g, headW, false);
      blocks.push({
        h: head.h, frame: groupFrame, frameStyle: groupStyle, frameAccent: groupAccent, keepWithNext: true,
        render: (c, x, y) => head.render(c, x, y),
      });
    }

    entries.forEach((e, i) => {
      if (e.pointerTo) {
        blocks.push({ ...pointerBlock(ctx, e, t.frame === "item" ? cfg.colW : inner, domain), frame: groupFrame, frameStyle: groupStyle, frameAccent: groupAccent });
        return;
      }
      const itemFrame = t.frame === "item" ? `${g.group.id}/${e.id}` : groupFrame;
      const style = t.frame === "item" ? itemStyle : groupStyle;
      const accent = t.frame === "item" ? itemAccent : groupAccent;
      const w = t.frame === "item" ? cfg.colW - 2 * pad : inner;
      const main = itemMainBlock(ctx, e, w, domain, t.item_image);
      // Items sharing a card (competency cards) or a column (deep-dive) are separated by a hairline.
      const shared = t.frame !== "item";
      const divider = shared && (i > 0 || img || t.frame === "group") ? sepGap : 0;
      const ruleColour = t.frame === "group" ? tint(dom, 0.6) : P.rule;
      const unit = `${g.group.id}/${e.id}`;
      blocks.push({
        h: main.h + divider, frame: itemFrame, frameStyle: style, frameAccent: accent, unit,
        render: (c, x, y) => [...(divider ? [lineEl(c, x, y + divider * 0.45, w, ruleColour, 0.25, "divider")] : []), ...main.render(c, x, y + divider)],
      });
      for (const fb of fieldBlocks(ctx, e, w, domain)) blocks.push({ ...fb, frame: itemFrame, frameStyle: style, frameAccent: accent, unit });
    });
    // The label sits inside the group card (competency cards) or above the item cards (other templates).
    const cont = contBlock(ctx, g, headW, groupFrame, groupStyle, groupFrame ? groupAccent : undefined);
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
  // The details column only when some row has details to show; otherwise the how-to takes its width.
  const hasDetails = groups.some((g) => g.entries.some((e) => {
    if (e.pointerTo) return false;
    const it = itemText(e.kind, e.id, lang);
    return FIELD_ORDER.some((f) => {
      if (f === "english" || !(f === "applies" ? cfg.fields.has("variants") : cfg.fields.has(f))) return false;
      const v = it.optional[f];
      return !!v && (!Array.isArray(v) || v.length > 0);
    });
  }));
  const details = cfg.table!.find((c) => c.key === "details");
  const cols = hasDetails || !details ? cfg.table! : cfg.table!.filter((c) => c !== details).map((c) => (c.key === "how_to" ? { ...c, frac: c.frac + details.frac } : c));
  const pad = cfg.spec.frame_pad_mm;
  const colX = (i: number) => cols.slice(0, i).reduce((a, c) => a + c.frac * width, 0);
  const cellW = (i: number) => cols[i].frac * width - 2 * pad;
  const hdrStyle: Style = { font_family: F.body, font_size_pt: cfg.spec.type.meta + 0.3, weight: 700, line_height: 1.3, colour: "#FFFFFF", letter_spacing_em: 0.03 };
  const hdrH = Math.max(...cols.map((c, i) => measureTextHeight((lang === "en" ? c.label_en : c.label_hi) || " ", hdrStyle, cellW(i)))) + 2 * pad;
  const header: Block = {
    h: hdrH,
    render: (c, x, y) => [
      rectEl(c, x, y, width, hdrH, { fill: P.ink, radius_mm: [2, 2, 0, 0] }, "table header"),
      ...cols.map((col, i) => textEl(c, x + colX(i) + pad, y + pad, cellW(i), hdrH - 2 * pad, (lang === "en" ? col.label_en : col.label_hi) || "", hdrStyle, undefined, `header ${col.key}`)),
    ],
  };

  const rows: Block[] = [];
  for (const g of groups) {
    const groupStart = rows.length;
    const domain = domainOf(g);
    const dom = P[`d_${domain}`] ?? P.accent;
    const st = styles(ctx, domain);
    const edge = 1.4;
    const head = headingPart(ctx, g, width - 2 * pad - edge, false);
    const gh = head.h + 2 * pad;
    rows.push({
      h: gh, keepWithNext: true,
      render: (c, x, y) => [
        rectEl(c, x, y, width, gh, { fill: tint(dom, 0.9) }, "group row"),
        rectEl(c, x, y, edge, gh, { fill: dom }, "group row edge"),
        ...head.render(c, x + edge + pad, y + pad),
      ],
    });
    for (const e of g.entries) {
      if (e.pointerTo) {
        const p = pointerBlock(ctx, e, width - 2 * pad, domain);
        rows.push({ h: p.h + 2 * pad, render: (c, x, y) => [...p.render(c, x + pad, y + pad), lineEl(c, x, y + p.h + 2 * pad, width, P.rule, 0.25, "row rule")] });
        continue;
      }
      const it = itemText(e.kind, e.id, lang);
      const cells: Part[] = cols.map((col, i) => {
        const w = cellW(i);
        if (col.key === "name") return itemHead(ctx, e, w, domain);
        if (col.key === "how_to") {
          return vstack([
            stepsPart(ctx, e, w, domain),
            [cfg.fields.has("english") ? textPart((it.optional.english as string) ?? "", st.quiet, w, itemBinding(e, "english"), "english") : EMPTY, 1.2],
          ]);
        }
        if (col.key === "details") {
          const parts: [Part, number][] = [];
          for (const f of FIELD_ORDER) {
            if (f === "english") continue;
            const shown = f === "applies" ? cfg.fields.has("variants") : cfg.fields.has(f);
            const v = it.optional[f];
            if (!shown || !v || (Array.isArray(v) && !v.length)) continue;
            parts.push([fieldPart(ctx, e, f, v, w, domain), 1.6]);
          }
          return vstack(parts);
        }
        const img = takeImage(ctx, itemImages(e));
        if (!img) return EMPTY;
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
    const c0 = contBlock(ctx, g, width - 2 * pad - edge);
    const cont: Block = {
      ...c0, h: c0.h + 2 * pad,
      render: (c, x, y) => [
        rectEl(c, x, y, width, c0.h + 2 * pad, { fill: tint(dom, 0.94) }, "group row (continued)"),
        rectEl(c, x, y, edge, c0.h + 2 * pad, { fill: dom }, "group row edge"),
        ...c0.render(c, x + edge + pad, y + pad),
      ],
    };
    rows.slice(groupStart).forEach((b, i) => {
      b.group = g.group.id;
      if (i > 0) b.cont = cont;
    });
  }
  return { header, rows };
}

// ---------------------------------------------------------------- page furniture

/**
 * Masthead on page 1: a strip across the top edge in the colours of the domains covered (widths by how many
 * strategies each group has), the subtitle as a kicker, the title in the display face, a summary line and a
 * rule. Later pages: the strip and a running title. Every page: source credit and page number.
 */
function headerFooter(ctx: Ctx, groups: ResolvedGroup[]) {
  const { doc, cfg, P, F } = ctx;
  const { width_mm: W, height_mm: H, margins_mm: m, bleed_mm: bleed } = doc.page;
  const lang = doc.language;
  const t = cfg.spec.type;
  const innerW = W - m.left - m.right;
  const title = doc.title || label("defaultTitle", lang);
  const titleStyle: Style = { font_family: F.display, font_size_pt: t.title, line_height: 1.15, colour: P.ink };
  const kickerStyle: Style = { font_family: F.body, font_size_pt: t.subtitle, weight: 600, line_height: 1.3, colour: P.accent, letter_spacing_em: 0.02 };
  const summaryStyle: Style = { font_family: F.body, font_size_pt: Math.max(t.meta, t.subtitle - 1), weight: 500, line_height: 1.3, colour: P.muted };
  const logoH = doc.meta.logo_ref ? t.title * PT * 1.6 : 0;
  const titleW = innerW - (logoH ? logoH * 2.2 + 4 : 0);
  const sub = doc.meta.subtitle;
  const kicker = textPart(sub, kickerStyle, titleW, { field: "subtitle" }, "subtitle");
  const titleP = textPart(title, titleStyle, titleW, { field: "title" }, "title");
  const summary = textPart(summaryText(selectionCounts(doc.selection), lang), summaryStyle, titleW, { field: "summary" }, "summary");
  const mast = vstack([kicker, [titleP, t.title * PT * 0.25], [summary, t.title * PT * 0.3]]);
  const stripH = Math.max(2, m.top * 0.2);
  const top = Math.max(m.top * 0.85, stripH + 5);
  const ruleY = top + mast.h + t.title * PT * 0.45;
  const ruleW = Math.max(0.5, t.title * 0.022);

  // Domain strip segments, in selection order; neighbours with the same colour merge.
  const segs: { colour: string; weight: number }[] = [];
  for (const g of groups) {
    const colour = P[`d_${domainOf(g)}`] ?? P.accent;
    const weight = Math.max(1, g.entries.filter((e) => !e.pointerTo).length);
    const last = segs[segs.length - 1];
    if (last && last.colour === colour) last.weight += weight;
    else segs.push({ colour, weight });
  }
  if (!segs.length) segs.push({ colour: P.accent, weight: 1 });
  const total = segs.reduce((a, s) => a + s.weight, 0);

  const baseMeta = t.meta / cfg.grow;
  const runStyle: Style = { font_family: F.body, font_size_pt: baseMeta + 0.5, weight: 600, line_height: 1.3, colour: P.ink };
  const runH = measureTextHeight(title, runStyle, innerW * 0.8);
  const runTop = Math.max(m.top, stripH + 4);
  const footStyle: Style = { font_family: F.body, font_size_pt: Math.max(6.5, baseMeta - 0.5), line_height: 1.35, colour: P.muted };
  const credit = label("credit", lang);
  const creditW = innerW * 0.62;
  const creditH = measureTextHeight(credit, footStyle, creditW);
  const footTop = H - m.bottom - creditH;
  const metaText = [doc.meta.organisation, doc.meta.author, doc.meta.date].filter(Boolean).join(" · ");
  const gap = cfg.spec.gap_mm;

  return {
    contentTop: (p: number) => (p === 0 ? ruleY + gap * 1.1 : runTop + runH + 2.5 + gap * 0.6),
    contentBottom: footTop - 2 - gap * 0.6,
    render(c: Ctx, p: number, pages: number): Element[] {
      const out: Element[] = [];
      let sx = -bleed;
      const fullW = W + 2 * bleed;
      for (const s of segs) {
        const sw = (fullW * s.weight) / total;
        out.push(rectEl(c, sx, -bleed, sw, stripH + bleed, { fill: s.colour }, "domain strip"));
        sx += sw;
      }
      if (p === 0) {
        out.push(...mast.render(c, m.left, top));
        out.push(rectEl(c, m.left, ruleY, innerW, ruleW, { fill: P.ink }, "masthead rule"));
        if (doc.meta.logo_ref) {
          const lw = logoH * 2.2;
          out.push({
            id: uid(), name: "logo", type: "image", x_mm: R(W - m.right - lw), y_mm: R(top), w_mm: R(lw), h_mm: R(logoH), rotation: 0, z: c.z++, locked: false,
            style: {}, content: { image_ref: doc.meta.logo_ref, natural_px: doc.meta.logo_px ?? [lw * 10, logoH * 10], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "contain" }, binding: { field: "logo" },
          });
        }
      } else {
        out.push(textEl(c, m.left, runTop, innerW * 0.8, runH, title, runStyle, { field: "running_title" }, "running title"));
        out.push(lineEl(c, m.left, runTop + runH + 1.5, innerW, P.rule, 0.3, "header rule"));
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

interface Placed { block: Block; page: number; col: number; y: number; span?: boolean; /** section index */ sec?: number }

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
  /** Sections under a full-width heading: "continued" labels only where a section runs onto a new page. */
  contOnNewPageOnly?: boolean;
}

/** Flows blocks into columns and pages. */
function place(blocks: Block[], o: PlaceOpts): { placed: Placed[]; lastPage: number; overflow: boolean } | null {
  const placed: Placed[] = [];
  let overflow = false;
  let page = o.firstPage, col = 0;
  let y = 0;
  let colStart = true;
  let pageStart = false;
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
    const cont = colStart && b.cont && b.group === prevGroup && (!o.contOnNewPageOnly || pageStart) ? b.cont : undefined;
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
      pageStart = false;
      if (col >= o.cols) {
        col = 0;
        page++;
        pageStart = true;
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

/**
 * Balance the columns of the last page: the lowest bottom edge that still holds that page's blocks,
 * without breaking a strategy across columns (the full pass only does so when it's taller than one).
 */
function balanceLastPage(blocks: Block[], placed: Placed[], page: number, o: PlaceOpts): Placed[] {
  if (o.cols < 2) return placed;
  const first = placed.find((p) => p.page === page && p.block !== o.header && blocks.includes(p.block));
  const startBlock = first ? blocks.indexOf(first.block) : -1;
  if (startBlock < 0) return placed;
  const tail = blocks.slice(startBlock);
  let lo = o.top(page), hi = o.bottom;
  let best: Placed[] | null = null;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    const r = place(tail, { ...o, firstPage: page, bottom: mid, maxPage: page, prevGroup: startBlock > 0 ? blocks[startBlock - 1].group : o.prevGroup });
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
  return best ? [...placed.filter((p) => p.page < page), ...best] : placed;
}

/** Lowest point used on a page by placed blocks (frames include their bottom padding). */
function pageBottom(placed: Placed[], page: number, pad: number): number {
  return Math.max(...placed.filter((p) => p.page === page).map((p) => p.y + p.block.h + (p.block.frame ? pad : 0)));
}

/**
 * Section flow: each group's heading spans the full width and its strategies flow in balanced columns
 * under it, like a magazine section. A heading never sits alone at the foot of a page.
 */
function placeSections(blocks: Block[], o: PlaceOpts, sectionGap: number): { placed: Placed[]; lastPage: number; overflow: boolean } {
  const sections: { head: Block; items: Block[] }[] = [];
  for (const b of blocks) {
    if (b.span) sections.push({ head: b, items: [] });
    else sections[sections.length - 1].items.push(b);
  }
  const all: Placed[] = [];
  let overflow = false;
  let page = o.firstPage;
  let y = o.top(page);
  let firstOnPage = true;
  sections.forEach((s, si) => {
    const lead = firstOnPage ? 0 : sectionGap;
    const first = s.items[0];
    // Room for the heading and at least the first strategy block (or it moves to the next page).
    const need = lead + s.head.h + (first ? first.h + (first.frame ? 2 * o.pad : 0) : 0);
    if (!firstOnPage && y + need > o.bottom) {
      page++;
      y = o.top(page);
    } else y += lead;
    all.push({ block: s.head, page, col: 0, y, span: true, sec: si });
    const itemsTop = y + s.head.h;
    const startPage = page;
    const so: PlaceOpts = { ...o, firstPage: page, top: (p) => (p === startPage ? itemsTop : o.top(p)), contOnNewPageOnly: true, prevGroup: undefined };
    const r = place(s.items, so)!;
    overflow ||= r.overflow;
    const placed = balanceLastPage(s.items, r.placed, r.lastPage, so);
    all.push(...placed.map((pl) => ({ ...pl, sec: si })));
    page = r.lastPage;
    y = s.items.length ? pageBottom(placed, page, o.pad) : itemsTop;
    firstOnPage = false;
  });
  return { placed: all, lastPage: page, overflow };
}

export function layoutDocument(doc: OnePagerDocument, t: TemplateDef, cfg: LayoutConfig, groups = resolve(doc.selection)): LayoutResult {
  const { margins_mm: m } = doc.page;
  const contentW = doc.page.width_mm - m.left - m.right;
  const ctx: Ctx = { doc, t, cfg, P: doc.theme.palette, F: doc.theme.fonts, z: 100, colH: 1e6, usedImages: new Set(), contentW };
  const hf = headerFooter(ctx, groups);
  ctx.colH = hf.contentBottom - hf.contentTop(1);
  const isTable = t.recipe === "table";
  const { header: tableHeader, rows } = isTable ? tableBlocks(ctx, groups, contentW) : { header: undefined, rows: [] };
  const blocks = isTable ? rows : cardBlocks(ctx, groups);
  const cols = isTable ? 1 : cfg.cols;
  const colW = isTable ? contentW : cfg.colW;
  const pad = cfg.spec.frame_pad_mm;
  const gap = cfg.spec.block_gap_mm;
  const opts: PlaceOpts = {
    cols, firstPage: 0, top: hf.contentTop, bottom: hf.contentBottom, gap, pad, header: tableHeader,
    frameGap: t.frame === "none" ? gap * 1.6 : Math.max(gap * 1.4, 3),
  };
  let placed: Placed[];
  let overflow: boolean;
  let page: number;
  if (blocks.some((b) => b.span)) {
    const r = placeSections(blocks, opts, Math.max(cfg.spec.gap_mm * 1.1, cfg.spec.type.group * PT * 1.3));
    ({ placed, overflow, lastPage: page } = r);
  } else {
    const full = place(blocks, opts)!;
    overflow = full.overflow;
    page = full.lastPage;
    placed = balanceLastPage(blocks, full.placed, page, opts);
  }

  const pageCount = Math.max(1, page + 1);
  const x0 = (c: number) => m.left + c * (colW + cfg.spec.gap_mm);
  const pages: Page[] = Array.from({ length: pageCount }, () => ({ id: uid("page"), elements: [] as Element[] }));

  // Frames: one background per contiguous run of same-frame blocks in a column.
  const frames: { p: Placed; top: number; h: number }[] = [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p.block.frame) continue;
    const prev = placed[i - 1];
    if (prev && prev.block.frame === p.block.frame && prev.page === p.page && prev.col === p.col) continue;
    let j = i;
    while (placed[j + 1] && placed[j + 1].block.frame === p.block.frame && placed[j + 1].page === p.page && placed[j + 1].col === p.col) j++;
    const last = placed[j];
    const top = p.y - pad;
    frames.push({ p, top, h: last.y + last.block.h + pad - top });
  }
  // A row of cards side by side (one card per column, same section and page, starting level) ends level too.
  const rowsOf = new Map<string, typeof frames>();
  for (const f of frames) {
    const k = `${f.p.page}|${f.p.sec ?? "-"}|${Math.round(f.top)}`;
    rowsOf.set(k, [...(rowsOf.get(k) ?? []), f]);
  }
  for (const [, row] of rowsOf) {
    const cols = new Set(row.map((f) => f.p.col));
    if (row.length < 2 || cols.size !== row.length) continue;
    const onlyInCol = row.every((f) => frames.filter((g) => g.p.page === f.p.page && g.p.col === f.p.col && (g.p.sec ?? -1) === (f.p.sec ?? -1)).length === 1);
    if (!onlyInCol) continue;
    const bottom = Math.max(...row.map((f) => f.top + f.h));
    for (const f of row) f.h = bottom - f.top;
  }
  let frameZ = 10;
  for (const { p, top, h } of frames) {
    pages[p.page].elements.push(rectEl(ctx, x0(p.col), top, colW, h, p.block.frameStyle ?? {}, "card", frameZ++));
    const a = p.block.frameAccent;
    if (a) {
      const r = typeof p.block.frameStyle?.radius_mm === "number" ? p.block.frameStyle.radius_mm : 0;
      const accent: Style = { fill: a.colour, radius_mm: a.side === "top" ? [r, r, 0, 0] : [r, 0, 0, r] };
      pages[p.page].elements.push(a.side === "top"
        ? rectEl(ctx, x0(p.col), top, colW, a.size, accent, "card accent", frameZ++)
        : rectEl(ctx, x0(p.col), top, a.size, h, accent, "card accent", frameZ++));
    }
  }
  for (const p of placed) {
    const inset = p.block.frame ? pad : 0;
    pages[p.page].elements.push(...p.block.render(ctx, (p.span ? m.left : x0(p.col)) + inset, p.y));
  }
  pages.forEach((pg, i) => pg.elements.push(...hf.render(ctx, i, pageCount)));
  return { pages, overflow };
}
