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
import { fontsFor, lookOf, type CardLook, type HardShadow, type Look } from "../looks";
import type { TableColumn, TemplateDef, TierSpec } from "../templates/types";
import { tint } from "../theme/tokens";
import { measureTextHeight, measureTextWidth } from "./measure";

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
  /** The document's look (colours, type, cards, masthead). */
  L: Look;
  /** The look's font stacks for the document's language. */
  F: { display: string; body: string; label: string };
  z: number;
  /** Usable column height (mm) on continuation pages; hero images are capped against it. */
  colH: number;
  /** TG images already placed: each picture appears once per document. */
  usedImages: Set<string>;
  /** Width inside the margins (full-width section headings, notes). */
  contentW: number;
}

interface Block {
  h: number;
  /** Card frame key: consecutive blocks with the same key in a column share one background. */
  frame?: string;
  card?: CardLook;
  keepWithNext?: boolean;
  /** Full-width section heading: its group's blocks flow in columns (or a grid) beneath it. */
  span?: boolean;
  /** Full-width note under a grid section (cross-references). */
  note?: boolean;
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

function textEl(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, style: Style, binding?: Binding, name?: string, runs?: Runs, rotation = 0): Element {
  return { id: uid(), name, type: "text", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation, z: ctx.z++, locked: false, style, content: runs ? { text, runs } : { text }, binding };
}

function rectEl(ctx: Ctx, x: number, y: number, w: number, h: number, style: Style, name: string, z?: number, rotation = 0): Element {
  return { id: uid(), name, type: "shape", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation, z: z ?? ctx.z++, locked: false, style, content: { shape_kind: "rect" } };
}

function lineEl(ctx: Ctx, x: number, y: number, w: number, colour: string, width: number, name: string): Element {
  return { id: uid(), name, type: "line", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: 0, rotation: 0, z: ctx.z++, locked: false, style: { stroke: { colour, width_mm: width } }, content: { line: true } };
}

/** A box with its look: optional hard (offset) shadow behind it. `z` (whole numbers): shadow at z, box at z + 1. */
function boxEls(ctx: Ctx, x: number, y: number, w: number, h: number, style: Style, name: string, hard?: HardShadow, z?: number, rotation = 0): Element[] {
  const out: Element[] = [];
  if (hard) out.push(rectEl(ctx, x + hard.dx, y + hard.dy, w, h, { fill: hard.colour, radius_mm: style.radius_mm }, `${name} shadow`, z, rotation));
  out.push(rectEl(ctx, x, y, w, h, style, name, z === undefined ? undefined : z + 1, rotation));
  return out;
}

function imageEl(ctx: Ctx, x: number, y: number, w: number, h: number, imageId: string, binding: Binding): Element {
  const im = imageById.get(imageId)!;
  return {
    id: uid(), name: im.caption_en, type: "image", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: ctx.z++, locked: false,
    style: { ...ctx.L.image },
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

/** A label in a filled box sized to its text (chips, stickers). */
function chipPart(text: string, style: Style, maxW: number, hard?: HardShadow, binding?: Binding, name?: string): Part {
  if (!text) return EMPTY;
  const w = Math.min(maxW - (hard?.dx ?? 0), measureTextWidth(text, style) + 0.6);
  const h = measureTextHeight(text, style, w);
  return {
    h: h + (hard?.dy ?? 0),
    render: (c, x, y) => [
      ...(hard ? [rectEl(c, x + hard.dx, y + hard.dy, w, h, { fill: hard.colour, radius_mm: style.radius_mm }, `${name} shadow`)] : []),
      textEl(c, x, y, w, h, text, style, binding, name),
    ],
  };
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
  const { L, cfg } = ctx;
  const t = cfg.spec.type;
  const { ink, muted } = L.palette;
  const dom = L.palette.d[domain] ?? L.palette.accent;
  const k = L.kicker(dom);
  const kicker: Style = { font_family: ctx.F.label, font_size_pt: Math.max(6.5, t.meta - 0.1), weight: L.weight.label, line_height: 1.25, colour: k.colour, letter_spacing_em: 0.03, ...(k.chip ?? {}) };
  return {
    dom,
    kicker,
    kickerHard: k.hard,
    label: { ...kicker, fill: undefined, stroke: undefined, padding_mm: undefined, radius_mm: undefined, colour: L.onLight(dom) } as Style,
    group: { font_family: ctx.F.display, font_size_pt: R(t.group * L.displayScale), weight: L.weight.display, line_height: L.displayLineHeight, colour: ink } as Style,
    secondary: { font_family: ctx.F.body, font_size_pt: t.meta, line_height: 1.3, colour: muted } as Style,
    name: { font_family: ctx.F.display, font_size_pt: R(t.name * L.displayScale), weight: L.weight.name, line_height: 1.18, colour: ink } as Style,
    also: { font_family: ctx.F.body, font_size_pt: t.meta, line_height: 1.3, colour: muted, weight: 500 } as Style,
    body: { font_family: ctx.F.body, font_size_pt: t.body, line_height: 1.45, colour: ink } as Style,
    field: { font_family: ctx.F.body, font_size_pt: Math.max(t.meta, t.body - 0.8), line_height: 1.42, colour: ink } as Style,
    quiet: { font_family: ctx.F.body, font_size_pt: Math.max(t.meta, t.body - 0.8), line_height: 1.42, colour: muted } as Style,
    pointer: { font_family: ctx.F.body, font_size_pt: t.meta, line_height: 1.35, colour: muted } as Style,
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

/** Hairline between strategies sharing a card or a column. */
function dividerColour(ctx: Ctx, dom: string, inCard: boolean): string {
  if (ctx.L.id === "brutal") return ctx.L.palette.ink;
  if (ctx.L.id === "bold") return inCard ? tint(dom, 0.6) : ctx.L.palette.rule;
  return "rgba(0,0,0,0.12)";
}

// ---------------------------------------------------------------- parts

function ellipseEl(ctx: Ctx, x: number, y: number, w: number, h: number, style: Style, name: string, z?: number): Element {
  return { id: uid(), name, type: "shape", x_mm: R(x), y_mm: R(y), w_mm: R(w), h_mm: R(h), rotation: 0, z: z ?? ctx.z++, locked: false, style, content: { shape_kind: "ellipse" } };
}

/** Display type with the look's effects: a notebook look runs a highlighter pen behind it. */
function displayPart(ctx: Ctx, text: string, style: Style, w: number, binding?: Binding, name?: string, highlight = false): Part {
  const p = textPart(text, style, w, binding, name);
  if (!p.h) return p;
  const hl = highlight ? ctx.L.highlighter : undefined;
  if (!hl) return p;
  const lineH = style.font_size_pt! * PT * (style.line_height ?? 1.2);
  // Where the lines break (greedy, word by word, as the browser wraps at spaces), for the highlighter.
  const lineWs: number[] = [];
  if (hl) {
    let cur = "";
    for (const word of text.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measureTextWidth(next, style) > w) {
        lineWs.push(measureTextWidth(cur, style));
        cur = word;
      } else cur = next;
    }
    if (cur) lineWs.push(measureTextWidth(cur, style));
  }
  return {
    h: p.h,
    render(c, x, y) {
      const out: Element[] = [];
      lineWs.forEach((lw, i) => {
        out.push(rectEl(c, x - 0.8, y + lineH * (i + 0.42), Math.min(w, lw) + 1.6, lineH * 0.46, { fill: hl, radius_mm: 0.8 }, "highlighter"));
      });
      out.push(...p.render(c, x, y));
      return out;
    },
  };
}

/** Kicker (domain), name and English name, in given colours. */
function plainHeading(ctx: Ctx, g: ResolvedGroup, w: number, colours?: { kicker: string; name: string; secondary: string }): Part {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  const kickerText = gt.kind === "routines" ? "" : domainName(gt.domain, lang);
  const kickerStyle = colours ? { ...st.label, colour: colours.kicker } : st.kicker;
  const kicker = kickerStyle.fill
    ? chipPart(kickerText, kickerStyle, w, st.kickerHard, groupBinding(g, "domain_name"), "domain")
    : textPart(kickerText, kickerStyle, w, groupBinding(g, "domain_name"), "domain");
  return vstack([
    kicker,
    [displayPart(ctx, gt.name, colours ? { ...st.group, colour: colours.name } : st.group, w, groupBinding(g, "name"), "competency name", true), kickerStyle.fill ? 1.6 : 0.6],
    [textPart(gt.name_secondary ?? "", colours ? { ...st.secondary, colour: colours.secondary } : st.secondary, w, groupBinding(g, "name_english"), "competency name (English)"), 0.6],
  ]);
}

/**
 * Group heading. Inside cards, or with no number: kicker (domain; text or chip, by look) and the name in
 * the display face, with an optional short colour bar above. Full-width section headings take the look's
 * section style: a big number beside them, a colour-blocked bar, or the number in a colour disc. No codes.
 */
function headingPart(ctx: Ctx, g: ResolvedGroup, w: number, withBar: boolean, index?: number): Part {
  const L = ctx.L;
  const gt = groupText(g.group, ctx.doc.language);
  const st = styles(ctx, gt.domain);
  const section = index !== undefined ? L.section ?? "plain" : "plain";
  const num = index !== undefined ? String(index).padStart(2, "0") : "";
  const gpt = st.group.font_size_pt!;

  if (section === "numbered") {
    // Swiss: a rule across, then a big number and the heading flush left beside it.
    const numStyle: Style = { font_family: ctx.F.display, font_size_pt: R(gpt * 2.3), weight: 800, line_height: 0.9, colour: L.numeral?.(st.dom) ?? L.onLight(st.dom), letter_spacing_em: -0.02 };
    const numW = measureTextWidth("00", numStyle) + 1;
    const numH = gpt * 2.3 * PT * 0.95;
    const inner = plainHeading(ctx, g, w - numW - 5);
    const ruleW = Math.max(0.6, gpt * 0.045);
    const h = ruleW + 2.8 + Math.max(numH, inner.h);
    return {
      h,
      render: (c, x, y) => [
        rectEl(c, x, y, w, ruleW, { fill: L.palette.ink }, "section rule"),
        textEl(c, x, y + ruleW + 2.2, numW, numH, num, numStyle, undefined, "section number"),
        ...inner.render(c, x + numW + 5, y + ruleW + 2.8),
      ],
    };
  }
  if (section === "block") {
    // Colour blocking: a full-width bar in the domain colour, white type, the number oversized at the right.
    const pad = Math.max(3, gpt * PT * 0.7);
    const numStyle: Style = { font_family: ctx.F.display, font_size_pt: R(gpt * 2.4), weight: 900, line_height: 0.85, colour: L.hot ?? "#FFFFFF", align: "right" };
    const numW = measureTextWidth("00", numStyle) + 2;
    const inner = plainHeading(ctx, g, w - 2 * pad - numW - 4, { kicker: tint(st.dom, 0.7), name: "#FFFFFF", secondary: tint(st.dom, 0.8) });
    const bh = inner.h + 2 * pad;
    const numH = Math.min(bh - 1, gpt * 2.4 * PT);
    return {
      h: bh,
      render: (c, x, y) => [
        rectEl(c, x, y, w, bh, { fill: st.dom, radius_mm: 3 }, "section bar"),
        ...inner.render(c, x + pad, y + pad),
        textEl(c, x + w - pad - numW, y + (bh - numH) / 2, numW, numH, num, numStyle, undefined, "section number"),
      ],
    };
  }
  if (section === "circle") {
    // Bauhaus: the number in a colour disc, the heading beside it.
    const inner = plainHeading(ctx, g, w - gpt * PT * 2.6 - 5);
    const d = Math.max(gpt * PT * 2.6, Math.min(inner.h, gpt * PT * 3.2));
    const numStyle: Style = { font_family: ctx.F.display, font_size_pt: R(gpt * 1.35), weight: 800, line_height: 1, align: "center", vertical_align: "middle", colour: L.badge(st.dom).style.colour };
    const h = Math.max(d, inner.h);
    return {
      h,
      render: (c, x, y) => [
        ellipseEl(c, x, y + (h - d) / 2, d, d, { fill: st.dom }, "section disc"),
        textEl(c, x, y + (h - d) / 2, d, d, num, numStyle, undefined, "section number"),
        ...inner.render(c, x + d + 5, y + (h - inner.h) / 2),
      ],
    };
  }
  const barH = Math.max(1, gpt * 0.075);
  const bar: Part = withBar && L.headingBar ? { h: barH, render: (c, x, y) => [rectEl(c, x, y, 12, barH, { fill: st.dom, radius_mm: barH / 2 }, "heading bar")] } : EMPTY;
  return vstack([bar, [plainHeading(ctx, g, w), bar.h ? 2.4 : 0]]);
}

/** Strategy name, English name (bilingual) and the "also supports" note. */
function itemHead(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, scale = 1): Part {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const name = scale === 1 ? st.name : { ...st.name, font_size_pt: R(st.name.font_size_pt! * scale) };
  const big = name.font_size_pt! >= 13;
  return vstack([
    big ? displayPart(ctx, it.name, name, w, itemBinding(e, "name"), "strategy name") : textPart(it.name, name, w, itemBinding(e, "name"), "strategy name"),
    [textPart(it.name_secondary ?? "", st.secondary, w, itemBinding(e, "name_english"), "strategy name (English)"), 0.5],
    [textPart(alsoText(ctx.doc.selection, e.also, lang), st.also, w, itemBinding(e, "also"), "also note"), 0.7],
  ]);
}

/**
 * The how-to as numbered steps. "badges": a small disc or square with the number beside each step.
 * "numerals" (posters): big display numerals. The compact tier runs the steps on in one paragraph with
 * bold coloured numbers, to save lines. A one-step how-to is plain text. Each stacked step is its own
 * text element (bound to its step), so it can be edited or moved alone.
 */
function stepsPart(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Part {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const st = styles(ctx, domain);
  const body = st.body;
  const steps = howToSteps(it.how_to, lang);
  if (steps.length < 2) return textPart(it.how_to, body, w, itemBinding(e, "how_to"), "how-to");
  if (ctx.cfg.tier === "compact") {
    const runs: Runs = steps.flatMap((s, i) => [
      { text: `${i ? "   " : ""}${i + 1} `, style: { weight: 800 as const, colour: ctx.L.onLight(st.dom) } },
      { text: s },
    ]);
    return textPart(runs.map((r) => r.text).join(""), body, w, itemBinding(e, "how_to"), "how-to", runs);
  }
  const pt = body.font_size_pt!;
  const lineH = pt * PT * (body.line_height ?? 1.45);
  const numerals = ctx.t.steps_style === "numerals" || ctx.L.steps === "numerals";
  const numScale = ctx.t.steps_style === "numerals" ? 2.1 : 1.45;
  const numStyle: Style = numerals
    ? { font_family: ctx.F.display, font_size_pt: R(pt * numScale), weight: ctx.L.weight.display, line_height: 1, colour: ctx.L.onLight(st.dom) }
    : { font_family: ctx.F.label, font_size_pt: R(pt * 0.74), weight: 800, line_height: 1, align: "center", vertical_align: "middle", ...ctx.L.badge(st.dom).style };
  const d = numerals ? pt * numScale * PT : Math.min(lineH * 0.92, pt * PT * 1.32);
  if (!numerals) numStyle.radius_mm = ctx.L.badge(st.dom).square ? 0.5 : R(d / 2);
  const gutter = numerals ? d * 0.95 + 1.5 : d + Math.max(1.6, pt * PT * 0.7);
  const tw = w - gutter;
  const hs = steps.map((s) => Math.max(measureTextHeight(s, body, tw), numerals ? d * 0.9 : 0));
  const gap = pt * PT * (numerals ? 0.9 : 0.5);
  const h = hs.reduce((a, b) => a + b, 0) + gap * (steps.length - 1);
  return {
    h,
    render(c, x, y) {
      const out: Element[] = [];
      let cy = y;
      steps.forEach((s, i) => {
        if (numerals) out.push(textEl(c, x, cy - d * 0.08, gutter - 1, d, String(i + 1), numStyle, undefined, `step ${i + 1} number`));
        else out.push(textEl(c, x, cy + (lineH - d) / 2, d, d, String(i + 1), numStyle, undefined, `step ${i + 1} number`));
        out.push(textEl(c, x + gutter, cy, tw, hs[i], s, body, itemBinding(e, "how_to", i), `step ${i + 1}`));
        cy += hs[i] + gap;
      });
      return out;
    },
  };
}

/** Name block + steps. */
function itemCore(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, nameScale = 1): Part {
  const nameGap = ctx.cfg.spec.type.body * PT * 0.6;
  return vstack([itemHead(ctx, e, w, domain, nameScale), [stepsPart(ctx, e, w, domain), nameGap]]);
}

/** Main block of one strategy/routine: core text with the picture beside it or above it. */
function itemMainBlock(ctx: Ctx, e: ResolvedEntry, w: number, domain: string, withImage: boolean): Part {
  const { spec } = ctx.cfg;
  const nameScale = ctx.t.name_scale ?? 1;
  const img = withImage && spec.image.placement !== "none" ? takeImage(ctx, itemImages(e), ctx.t.steps_style === "numerals") : undefined;
  const gap = 4;
  if (img && spec.image.placement === "right") {
    const im = imageById.get(img)!;
    const imgW = w * spec.image.frac;
    const imgH = imgW / im.aspect;
    const core = itemCore(ctx, e, w - imgW - gap, domain, nameScale);
    return {
      h: Math.max(core.h, imgH),
      render: (c, x, y) => [...core.render(c, x, y), imageEl(c, x + w - imgW, y + 0.4, imgW, imgH, img, itemBinding(e, "image"))],
    };
  }
  if (img && spec.image.placement === "top") {
    const im = imageById.get(img)!;
    // Full card width; a banner crop when the template sets an aspect, else the picture's own shape, but
    // never taller than half a column.
    const aspect = spec.image.aspect ?? im.aspect;
    const imgH = Math.min((w * spec.image.frac) / aspect, w * 0.7, ctx.colH * 0.45);
    const imgW = spec.image.aspect ? w : Math.min(w, imgH * im.aspect);
    const core = itemCore(ctx, e, w, domain, nameScale);
    return {
      h: imgH + gap + core.h,
      render: (c, x, y) => [imageEl(c, x + (w - imgW) / 2, y, imgW, imgH, img, itemBinding(e, "image")), ...core.render(c, x, y + imgH + gap)],
    };
  }
  return itemCore(ctx, e, w, domain, nameScale);
}

const FIELD_ORDER: (OptionalField | "applies")[] = ["english", "example", "materials", "explanation", "variants", "applies", "weeks"];

/** Label and value on one line: "सामग्री  रंग · पेंसिल · रबर". */
function inlineField(ctx: Ctx, lab: string, value: string, w: number, domain: string, binding: Binding, name: string): Part {
  const st = styles(ctx, domain);
  const text = `${lab}   ${value}`;
  return textPart(text, st.field, w, binding, name, [
    { text: `${lab}   `, style: { weight: 700, colour: ctx.L.onLight(st.dom) } },
    { text: value },
  ]);
}

/** One optional field, designed for what it is. */
function fieldPart(ctx: Ctx, e: ResolvedEntry, f: OptionalField | "applies", v: string | string[], w: number, domain: string): Part {
  const lang = ctx.doc.language;
  const st = styles(ctx, domain);
  const binding = itemBinding(e, f);
  if (f === "english") return textPart(v as string, st.quiet, w, binding, "english");
  if (f === "materials") return inlineField(ctx, label("materials", lang), (v as string[]).join("  ·  "), w, domain, binding, "materials");
  if (f === "weeks") return inlineField(ctx, label("weeks", lang), v as string, w, domain, binding, "weeks");
  if (f === "example" && ctx.t.pull_quote) {
    // Pull quote: an oversized quotation mark and the example in the display face.
    const q: Style = { font_family: ctx.F.display, font_size_pt: R(st.body.font_size_pt! * 3.4), weight: 800, line_height: 1, colour: ctx.L.onLight(st.dom) };
    const qW = st.body.font_size_pt! * PT * 2.4;
    const text: Style = { font_family: ctx.F.display, font_size_pt: R(st.body.font_size_pt! * 1.12), weight: 600, line_height: 1.4, colour: ctx.L.palette.ink };
    const inner = vstack([
      textPart(label("example", lang), st.label, w - qW, undefined, "example label"),
      [textPart(v as string, text, w - qW, binding, "example"), 0.8],
    ]);
    const h = Math.max(inner.h, qW);
    return {
      h,
      render: (c, x, y) => [textEl(c, x, y - qW * 0.12, qW, qW, "“", q, undefined, "quotation mark"), ...inner.render(c, x + qW, y)],
    };
  }
  if (f === "example") {
    // Callout panel in the look's style.
    const co = ctx.L.callout(st.dom);
    const pad = Math.max(1.8, st.field.font_size_pt! * PT * 0.7);
    const edge = co.edge ? 0.9 : 0;
    const hard = co.hard;
    const iw = w - 2 * pad - edge - (hard?.dx ?? 0);
    const inner = vstack([
      textPart(label("example", lang), st.label, iw, undefined, "example label"),
      [textPart(v as string, st.field, iw, binding, "example"), 0.6],
    ]);
    const bw = w - (hard?.dx ?? 0);
    const h = inner.h + 2 * pad;
    return {
      h: h + (hard?.dy ?? 0),
      render: (c, x, y) => [
        ...boxEls(c, x, y, bw, h, co.panel, "example panel", hard),
        ...(co.edge ? [rectEl(c, x, y, edge, h, { fill: co.edge }, "example edge")] : []),
        ...inner.render(c, x + edge + pad, y + pad),
      ],
    };
  }
  if (f === "explanation") {
    // Read-more: quieter text behind a hairline rule.
    const inset = 3;
    const inner = vstack([
      textPart(label("explanation", lang), st.label, w - inset, undefined, "explanation label"),
      [textPart(v as string, ctx.t.pull_quote ? st.field : st.quiet, w - inset, binding, "explanation"), 0.5],
    ]);
    return {
      h: inner.h,
      render: (c, x, y) => [rectEl(c, x, y + 0.4, 0.6, inner.h - 0.4, { fill: ctx.L.id === "brutal" ? ctx.L.palette.ink : tint(st.dom, 0.45) }, "explanation rule"), ...inner.render(c, x + inset, y)],
    };
  }
  // Variants, "when" (routines): label, then a bulleted list.
  const value = Array.isArray(v) ? v.map((s) => `•  ${s}`).join("\n") : v;
  return vstack([
    textPart(label(f, lang), st.label, w, undefined, `${f} label`),
    [textPart(value, st.field, w, binding, f), 0.5],
  ]);
}

function fieldParts(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Part[] {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const out: Part[] = [];
  for (const f of FIELD_ORDER) {
    const shown = f === "applies" ? ctx.cfg.fields.has("variants") : ctx.cfg.fields.has(f);
    const v = it.optional[f];
    if (!shown || !v || (Array.isArray(v) && !v.length)) continue;
    out.push(fieldPart(ctx, e, f, v, w, domain));
  }
  return out;
}

function pointerPart(ctx: Ctx, e: ResolvedEntry, w: number, domain: string): Part {
  const lang = ctx.doc.language;
  const it = itemText(e.kind, e.id, lang);
  const text = pointerText(ctx.doc.selection, it.name, e.pointerTo!, lang);
  return textPart(text, styles(ctx, domain).pointer, w, itemBinding(e, "pointer"), "cross-reference");
}

/** "मौखिक शब्दावली विकास (जारी)" at the top of a column where a group carries on. */
function contBlock(ctx: Ctx, g: ResolvedGroup, w: number, frame?: string, card?: CardLook): Block {
  const lang = ctx.doc.language;
  const gt = groupText(g.group, lang);
  const st = styles(ctx, gt.domain);
  const p = textPart(continuedText(gt.name, lang), st.label, w, groupBinding(g, "continued"), "continued label");
  return { h: p.h, frame, card, group: g.group.id, render: p.render };
}

function cardBlocks(ctx: Ctx, groups: ResolvedGroup[]): Block[] {
  const { t, cfg, L } = ctx;
  const pad = cfg.spec.frame_pad_mm;
  const blocks: Block[] = [];
  const grid = t.flow === "grid";
  for (const g of groups) {
    const groupStart = blocks.length;
    const domain = domainOf(g);
    const dom = L.palette.d[domain] ?? L.palette.accent;
    const groupFrame = t.frame === "group" ? g.group.id : undefined;
    const groupCard = L.card(dom, "group");
    const itemCard = L.card(dom, t.card_kind ?? "item");
    // Room for a card's hard shadow on its right.
    const shadowRoom = (c: CardLook) => c.hard?.dx ?? 0;
    const inner = t.frame === "none" ? cfg.colW : cfg.colW - 2 * pad - (t.frame === "group" ? shadowRoom(groupCard) : shadowRoom(itemCard));
    const headW = t.frame === "group" ? inner : cfg.colW;
    const sepGap = cfg.spec.type.body * PT * 0.9;
    const blockGap = cfg.spec.block_gap_mm;

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
        h, frame: groupFrame, card: groupCard, keepWithNext: false,
        unit: first ? `${g.group.id}/${first.id}` : undefined,
        render: (c, x, y) => [
          ...head.render(c, x, y),
          ...core.render(c, x, y + head.h + coreGap),
          imageEl(c, x + headW - imgW, y + 0.4, imgW, imgH, img, first ? itemBinding(first, "image") : groupBinding(g, "image")),
        ],
      });
      if (first) for (const fp of fieldParts(ctx, first, headW, domain)) blocks.push({ ...fp, frame: groupFrame, card: groupCard, unit: `${g.group.id}/${first.id}` });
    } else if (t.heading_style === "section" && t.frame !== "group") {
      // Full-width section heading; the group's strategies flow in columns (or a grid) beneath it.
      const head = headingPart(ctx, g, ctx.contentW, true, groups.indexOf(g) + 1);
      const after = cfg.spec.type.group * PT * 0.9;
      blocks.push({ h: head.h + after, span: true, render: (c, x, y) => head.render(c, x, y) });
    } else {
      const head = headingPart(ctx, g, headW, false);
      blocks.push({ h: head.h, frame: groupFrame, card: groupCard, keepWithNext: true, render: (c, x, y) => head.render(c, x, y) });
    }

    entries.forEach((e, i) => {
      if (e.pointerTo) {
        const pw = grid ? ctx.contentW : t.frame === "item" ? cfg.colW : inner;
        blocks.push({ ...pointerPart(ctx, e, pw, domain), frame: grid ? undefined : groupFrame, card: groupFrame ? groupCard : undefined, note: grid });
        return;
      }
      const itemFrame = t.frame === "item" ? `${g.group.id}/${e.id}` : groupFrame;
      const card = t.frame === "item" ? itemCard : groupCard;
      const w = t.frame === "item" ? cfg.colW - 2 * pad - shadowRoom(itemCard) : inner;
      // An outlined card with a colour band along its top: content starts below the band.
      const band = t.frame === "item" && itemCard.accent?.side === "top" && itemCard.style.stroke ? itemCard.accent.size * 0.75 : 0;
      const main0 = itemMainBlock(ctx, e, w, domain, t.item_image);
      const main: Part = band ? { h: main0.h + band, render: (c, x, y) => main0.render(c, x, y + band) } : main0;
      const unit = `${g.group.id}/${e.id}`;
      if (grid) {
        // A grid card is one block: it never splits, and every card in a row gets the row's height.
        const whole = vstack([main, ...fieldParts(ctx, e, w, domain).map((p): [Part, number] => [p, blockGap])]);
        blocks.push({ ...whole, frame: itemFrame, card, unit });
        return;
      }
      // Items sharing a card (competency cards) or a column (deep-dive) are separated by a hairline.
      const shared = t.frame !== "item";
      const divider = shared && (i > 0 || img || t.frame === "group") ? sepGap : 0;
      const ruleColour = dividerColour(ctx, dom, t.frame === "group");
      blocks.push({
        h: main.h + divider, frame: itemFrame, card, unit,
        render: (c, x, y) => [...(divider ? [lineEl(c, x, y + divider * 0.45, w, ruleColour, L.id === "brutal" ? 0.4 : 0.25, "divider")] : []), ...main.render(c, x, y + divider)],
      });
      for (const fp of fieldParts(ctx, e, w, domain)) blocks.push({ ...fp, frame: itemFrame, card, unit });
    });
    // The label sits inside the group card (competency cards) or above the item cards (other templates).
    const cont = contBlock(ctx, g, headW, groupFrame, groupFrame ? groupCard : undefined);
    blocks.slice(groupStart).forEach((b, i) => {
      b.group = g.group.id;
      if (i > 0) b.cont = cont;
    });
  }
  return blocks;
}

// ---------------------------------------------------------------- blocks: table recipe

function tableBlocks(ctx: Ctx, groups: ResolvedGroup[], width: number): { header: Block; rows: Block[] } {
  const { cfg, L, doc } = ctx;
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
  const radius = L.id === "brutal" ? 0 : L.id === "material" ? 4 : 2.5;
  const hdrStyle: Style = { font_family: ctx.F.label, font_size_pt: cfg.spec.type.meta + 0.3, weight: 700, line_height: 1.3, colour: L.table.headerInk, letter_spacing_em: 0.03 };
  const hdrH = Math.max(...cols.map((c, i) => measureTextHeight((lang === "en" ? c.label_en : c.label_hi) || " ", hdrStyle, cellW(i)))) + 2 * pad;
  const header: Block = {
    h: hdrH,
    render: (c, x, y) => [
      rectEl(c, x, y, width, hdrH, { fill: L.table.header, radius_mm: [radius, radius, 0, 0] }, "table header"),
      ...cols.map((col, i) => textEl(c, x + colX(i) + pad, y + pad, cellW(i), hdrH - 2 * pad, (lang === "en" ? col.label_en : col.label_hi) || "", hdrStyle, undefined, `header ${col.key}`)),
    ],
  };

  const rows: Block[] = [];
  let stripe = 0;
  for (const g of groups) {
    const groupStart = rows.length;
    const domain = domainOf(g);
    const dom = L.palette.d[domain] ?? L.palette.accent;
    const st = styles(ctx, domain);
    const edge = L.id === "brutal" ? 2 : 1.4;
    const rowFill = L.id === "brutal" ? tint(dom, 0.55) : L.id === "glass" ? "rgba(255,255,255,0.7)" : tint(dom, 0.88);
    const head = headingPart(ctx, g, width - 2 * pad - edge, false);
    const gh = head.h + 2 * pad;
    rows.push({
      h: gh, keepWithNext: true,
      render: (c, x, y) => [
        rectEl(c, x, y, width, gh, { fill: rowFill }, "group row"),
        rectEl(c, x, y, edge, gh, { fill: L.id === "brutal" ? L.palette.ink : dom }, "group row edge"),
        ...head.render(c, x + edge + pad, y + pad),
      ],
    });
    stripe = 0;
    for (const e of g.entries) {
      if (e.pointerTo) {
        const p = pointerPart(ctx, e, width - 2 * pad, domain);
        rows.push({ h: p.h + 2 * pad, render: (c, x, y) => [...p.render(c, x + pad, y + pad), lineEl(c, x, y + p.h + 2 * pad, width, L.rule.colour, L.rule.width, "row rule")] });
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
      const zebra = L.table.zebra && stripe++ % 2 === 1;
      rows.push({
        h: rh,
        render: (c, x, y) => [
          ...(zebra ? [rectEl(c, x, y, width, rh, { fill: L.table.zebra }, "row stripe")] : []),
          ...cells.flatMap((cell, i) => cell.render(c, x + colX(i) + pad, y + pad)),
          lineEl(c, x, y + rh, width, L.rule.colour, L.rule.width, "row rule"),
        ],
      });
    }
    const c0 = contBlock(ctx, g, width - 2 * pad - edge);
    const cont: Block = {
      ...c0, h: c0.h + 2 * pad,
      render: (c, x, y) => [
        rectEl(c, x, y, width, c0.h + 2 * pad, { fill: rowFill }, "group row (continued)"),
        rectEl(c, x, y, edge, c0.h + 2 * pad, { fill: L.id === "brutal" ? L.palette.ink : dom }, "group row edge"),
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
 * Masthead on page 1, in the look's style:
 *   band     — a colour band to the page edges, huge white title, an oversized count in the hot colour,
 *              and a strip of the domains covered under it (Bold);
 *   brutal   — a yellow slab with a thick outline and hard shadow, and a tilted sticker with the counts;
 *   tonal    — a big rounded container in the document's key colour, counts as pills (Material);
 *   glass    — a frosted panel on the colour field, counts as glass pills;
 *   swiss    — flush-left title under a red square, a heavy rule;
 *   bauhaus  — a red disc, blue bar and yellow square beside the title, a heavy rule;
 *   notebook — a handwritten title with highlighter, and a sticky note with the counts.
 * Later pages: a running title. Every page: source credit and page number.
 */
function headerFooter(ctx: Ctx, groups: ResolvedGroup[]) {
  const { doc, cfg, L } = ctx;
  const P = L.palette;
  const { width_mm: W, height_mm: H, margins_mm: m, bleed_mm: bleed } = doc.page;
  const lang = doc.language;
  const t = cfg.spec.type;
  const innerW = W - m.left - m.right;
  const domains = groups.map(domainOf);
  const primary = L.primary(domains);
  const kind = L.masthead;
  const boxed = kind === "brutal" || kind === "tonal" || kind === "glass";
  const boxPad = boxed ? Math.max(5, m.left * 0.45) : 0;
  const title = doc.title || label("defaultTitle", lang);
  const onColour = kind === "band" || kind === "tonal";
  const counts = selectionCounts(doc.selection);
  const summary = summaryText(counts, lang);
  const pills = summary.split("  ·  ").filter(Boolean);

  // Space kept on the right of the title for decoration: Bold's big count, Swiss's square, Bauhaus's shapes.
  const bigNumStyle: Style = { font_family: ctx.F.display, font_size_pt: R(t.title * 3.1), weight: 900, line_height: 0.82, colour: L.hot ?? "#FFFFFF", align: "right", letter_spacing_em: -0.03 };
  const bigNum = String(counts.strategies + counts.routines);
  const bigNumW = kind === "band" ? measureTextWidth(bigNum, bigNumStyle) + 2 : 0;
  const swissSq = kind === "swiss" ? Math.max(12, t.title * PT * 2.2) : 0;
  const bhD = kind === "bauhaus" ? Math.max(24, t.title * PT * 3.4) : 0;
  const logoH = doc.meta.logo_ref ? t.title * PT * 1.6 : 0;
  const reserve = kind === "band" ? bigNumW + 8 : kind === "swiss" ? swissSq + 8 : kind === "bauhaus" ? bhD + 22 : 0;
  const textW = innerW - 2 * boxPad - reserve - (logoH ? logoH * 2.2 + 4 : 0) - (kind === "brutal" ? 2.2 : 0);

  const titleScale = kind === "band" ? 1.28 : kind === "swiss" ? 1.3 : kind === "notebook" ? 1.25 : 1.12;
  const titleStyle: Style = { font_family: ctx.F.display, font_size_pt: R(t.title * titleScale * L.displayScale), weight: L.weight.display, line_height: L.displayLineHeight, colour: onColour ? "#FFFFFF" : P.ink, letter_spacing_em: kind === "swiss" || kind === "band" ? -0.01 : undefined };
  const kickerColour = kind === "band" ? (L.hot ?? tint(P.accent, 0.72)) : kind === "tonal" ? tint(primary, 0.78)
    : kind === "glass" ? L.onLight(primary) : kind === "swiss" || kind === "notebook" ? P.accent : P.ink;
  const kickerStyle: Style = { font_family: ctx.F.label, font_size_pt: t.subtitle, weight: 700, line_height: 1.3, letter_spacing_em: 0.03, colour: kickerColour };
  const kicker = textPart(doc.meta.subtitle, kickerStyle, textW, { field: "subtitle" }, "subtitle");
  const titleP = displayPart(ctx, title, titleStyle, textW, { field: "title" }, "title", kind === "notebook");
  const pillStyle: Style = {
    font_family: ctx.F.label, font_size_pt: Math.max(t.meta, t.subtitle - 1), weight: 700, line_height: 1.25, padding_mm: [0.9, 2.8, 0.7, 2.8],
    ...(kind === "tonal" ? { colour: "#FFFFFF", fill: "rgba(255,255,255,0.2)", radius_mm: 4 }
      : kind === "glass" ? { colour: P.ink, fill: "rgba(255,255,255,0.75)", stroke: { colour: "#FFFFFF", width_mm: 0.3 }, radius_mm: 4 }
        : { colour: kind === "band" ? tint(P.accent, 0.75) : P.muted }),
  };
  const pillWs = pills.map((p) => measureTextWidth(p, pillStyle) + 0.6);
  const pillH = pills.length ? measureTextHeight(pills[0], pillStyle, pillWs[0]) : 0;
  // Summary: pills in a row (tonal, glass), a sticker (brutal, notebook: drawn separately), plain text otherwise.
  const summaryPart: Part = kind === "brutal" || kind === "notebook" || !pills.length ? EMPTY
    : kind === "tonal" || kind === "glass"
      ? {
        h: pillH,
        render: (c, x, y) => {
          let px = x;
          return pills.map((p, i) => {
            const el = textEl(c, px, y, pillWs[i], pillH, p, pillStyle, i === 0 ? { field: "summary" } : undefined, "summary pill");
            px += pillWs[i] + 2;
            return el;
          });
        },
      }
      : textPart(summary, { ...pillStyle, padding_mm: undefined, weight: kind === "band" ? 700 : 600 }, textW, { field: "summary" }, "summary");
  const mast = vstack([kicker, [titleP, t.title * PT * 0.3], [summaryPart, t.title * PT * 0.45]]);

  const top = kind === "band" ? Math.max(m.top * 0.9, 8) : Math.max(m.top * 0.8, 6);
  const boxH = mast.h + 2 * boxPad;
  const stripH = kind === "band" ? 3 : 0;
  const hard: HardShadow | undefined = kind === "brutal" ? { dx: 2.2, dy: 2.2, colour: P.ink } : undefined;
  const decoH = kind === "bauhaus" ? bhD + 4 : kind === "swiss" ? swissSq : 0;
  const heavyRule = kind === "swiss" || kind === "bauhaus" ? Math.max(1, t.title * 0.05) : 0;
  const mastBottom = kind === "band" ? top + Math.max(mast.h, bigNumW ? t.title * 3.1 * PT * 0.9 : 0) + Math.max(m.top * 0.75, 7)
    : boxed ? top + boxH + (hard?.dy ?? 0)
      : top + Math.max(mast.h, decoH) + (heavyRule ? 3 + heavyRule : 1);

  // Domain strip segments (band look), in selection order; neighbours with the same colour merge.
  const segs: { colour: string; weight: number }[] = [];
  for (const g of groups) {
    const colour = P.d[domainOf(g)] ?? P.accent;
    const weight = Math.max(1, g.entries.filter((e) => !e.pointerTo).length);
    const last = segs[segs.length - 1];
    if (last && last.colour === colour) last.weight += weight;
    else segs.push({ colour, weight });
  }
  if (!segs.length) segs.push({ colour: P.accent, weight: 1 });
  const total = segs.reduce((a, s) => a + s.weight, 0);
  const strip = (c: Ctx, y: number, h: number): Element[] => {
    const out: Element[] = [];
    let sx = -bleed;
    for (const s of segs) {
      const sw = ((W + 2 * bleed) * s.weight) / total;
      out.push(rectEl(c, sx, y, sw, h, { fill: s.colour }, "domain strip"));
      sx += sw;
    }
    return out;
  };

  /** Tilted label with the counts, over the masthead's top-right corner. */
  const sticker = (c: Ctx, style: Style, rotation: number, shadow?: string): Element[] => {
    if (!pills.length) return [];
    const text = pills.join("\n");
    const sw = Math.max(...pills.map((s) => measureTextWidth(s, style))) + 0.8;
    const sh = measureTextHeight(text, style, sw);
    const sx = m.left + innerW - (hard?.dx ?? 0) - sw - 4;
    const sy = top - sh * 0.35;
    return [
      ...(shadow ? [rectEl(c, sx + 1, sy + 1, sw, sh, { fill: shadow }, "sticker shadow", undefined, rotation)] : []),
      textEl(c, sx, sy, sw, sh, text, style, { field: "summary" }, "summary sticker", undefined, rotation),
    ];
  };

  const baseMeta = t.meta / cfg.grow;
  const runStyle: Style = { font_family: ctx.F.label, font_size_pt: baseMeta + 0.5, weight: 700, line_height: 1.3, colour: P.ink };
  const runH = measureTextHeight(title, runStyle, innerW * 0.8);
  const runTop = kind === "band" ? Math.max(m.top, 6) : Math.max(m.top * 0.8, 6);
  const footStyle: Style = { font_family: ctx.F.body, font_size_pt: Math.max(6.5, baseMeta - 0.5), line_height: 1.35, colour: P.muted };
  const credit = label("credit", lang);
  const creditW = innerW * 0.62;
  const creditH = measureTextHeight(credit, footStyle, creditW);
  const footTop = H - m.bottom - creditH;
  const metaText = [doc.meta.organisation, doc.meta.author, doc.meta.date].filter(Boolean).join(" · ");
  const gap = cfg.spec.gap_mm;
  const strongRule = L.id === "brutal" || L.id === "swiss" || L.id === "bauhaus";

  return {
    contentTop: (p: number) => (p === 0 ? mastBottom + stripH + gap * 1.2 : runTop + runH + 3 + gap * 0.6),
    contentBottom: footTop - 2 - gap * 0.6,
    render(c: Ctx, p: number, pages: number): Element[] {
      const out: Element[] = [];
      const R0 = m.left + innerW; // right edge of the content area
      if (p === 0) {
        if (kind === "band") {
          out.push(rectEl(c, -bleed, -bleed, W + 2 * bleed, mastBottom + bleed, { fill: P.accent }, "masthead band"));
          out.push(...strip(c, mastBottom, stripH));
          out.push(...mast.render(c, m.left, top));
          // The oversized count, and what it counts, bottom-aligned at the right of the band.
          const numH = t.title * 3.1 * PT;
          const labStyle: Style = { font_family: ctx.F.label, font_size_pt: Math.max(t.meta, t.subtitle - 1), weight: 800, line_height: 1.2, colour: "#FFFFFF", align: "right" };
          const lab = lang === "en" ? (counts.strategies + counts.routines === 1 ? "strategy" : "strategies") : "रणनीतियाँ";
          const labH = measureTextHeight(lab, labStyle, bigNumW + 10);
          const ny = mastBottom - Math.max(m.top * 0.55, 5) - labH - numH * 0.92;
          out.push(textEl(c, R0 - bigNumW, ny, bigNumW, numH, bigNum, bigNumStyle, { field: "summary_count" }, "big count"));
          out.push(textEl(c, R0 - bigNumW - 10, ny + numH * 0.92, bigNumW + 10, labH, lab, labStyle, undefined, "big count label"));
        } else if (boxed) {
          const boxStyle: Style = kind === "brutal"
            ? { fill: P.accent, stroke: { colour: P.ink, width_mm: 0.8 }, radius_mm: 0 }
            : kind === "tonal" ? { fill: primary, radius_mm: 8 }
              : { fill: "rgba(255,255,255,0.55)", stroke: { colour: "rgba(255,255,255,0.95)", width_mm: 0.4 }, radius_mm: 7, shadow: "0 1mm 4mm rgba(16,24,40,0.10)" };
          out.push(...boxEls(c, m.left, top, innerW - (hard?.dx ?? 0), boxH, boxStyle, "masthead", hard));
          out.push(...mast.render(c, m.left + boxPad, top + boxPad));
          if (kind === "brutal") {
            out.push(...sticker(c, { font_family: ctx.F.label, font_size_pt: Math.max(t.meta, t.subtitle - 0.5), weight: 700, line_height: 1.2, colour: P.ink, fill: primary, stroke: { colour: P.ink, width_mm: 0.5 }, padding_mm: [1.2, 3, 1, 3], align: "center" }, 4, P.ink));
          }
        } else if (kind === "swiss") {
          out.push(rectEl(c, R0 - swissSq, top, swissSq, swissSq, { fill: P.accent }, "red square"));
          out.push(...mast.render(c, m.left, top));
          out.push(rectEl(c, m.left, mastBottom - heavyRule, innerW, heavyRule, { fill: P.ink }, "masthead rule"));
        } else if (kind === "bauhaus") {
          const d = bhD;
          const bx = R0 - d - 14;
          out.push(rectEl(c, R0 - 11, top - 2, 11, d * 1.12, { fill: "#1F4E9C" }, "blue bar"));
          out.push(ellipseEl(c, bx, top, d, d, { fill: "#D6312B" }, "red disc"));
          out.push(rectEl(c, bx - d * 0.18, top + d * 0.58, d * 0.46, d * 0.46, { fill: "#F2B705" }, "yellow square"));
          out.push(...mast.render(c, m.left, top + Math.max(0, (d - mast.h) / 2)));
          out.push(rectEl(c, m.left, mastBottom - heavyRule, innerW, heavyRule, { fill: P.ink }, "masthead rule"));
        } else if (kind === "notebook") {
          out.push(...mast.render(c, m.left, top));
          out.push(...sticker(c, { font_family: ctx.F.label, font_size_pt: Math.max(t.meta + 1, t.subtitle), weight: 700, line_height: 1.25, colour: P.ink, fill: "#FFE066", padding_mm: [2, 3.5, 1.8, 3.5], align: "center", shadow: "0 0.8mm 2mm rgba(30,42,85,0.2)" }, -4));
        }
        if (doc.meta.logo_ref) {
          const lw = logoH * 2.2;
          out.push({
            id: uid(), name: "logo", type: "image", x_mm: R(R0 - boxPad - reserve - lw), y_mm: R(top + boxPad), w_mm: R(lw), h_mm: R(logoH), rotation: 0, z: c.z++, locked: false,
            style: {}, content: { image_ref: doc.meta.logo_ref, natural_px: doc.meta.logo_px ?? [lw * 10, logoH * 10], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "contain" }, binding: { field: "logo" },
          });
        }
      } else {
        if (kind === "band") out.push(...strip(c, -bleed, 2.2 + bleed));
        out.push(textEl(c, m.left, runTop, innerW * 0.8, runH, title, runStyle, { field: "running_title" }, "running title"));
        out.push(lineEl(c, m.left, runTop + runH + 1.5, innerW, strongRule ? P.ink : L.rule.colour, strongRule ? 0.8 : 0.3, "header rule"));
      }
      out.push(lineEl(c, m.left, footTop - 2, innerW, strongRule ? P.ink : L.rule.colour, strongRule ? 0.5 : 0.3, "footer rule"));
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

interface Placed {
  block: Block;
  page: number;
  col: number;
  y: number;
  /** Full width (section headings, grid notes). */
  span?: boolean;
  /** Section index. */
  sec?: number;
  /** Grid cards: the row's height, so every card in a row ends level. */
  rowH?: number;
}

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

type PlaceResult = { placed: Placed[]; lastPage: number; overflow: boolean };

/** Flows blocks into columns and pages. */
function place(blocks: Block[], o: PlaceOpts): PlaceResult | null {
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
    const hardY = b.card?.hard?.dy ?? 0;
    let need = lead + padTop + (cont ? cont.h + o.gap : 0) + b.h + (b.frame ? o.pad + hardY : 0);
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
    if (b.frame !== undefined && (!next || next.frame !== b.frame)) y += o.pad + hardY;
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

/** Lowest point used on a page by placed blocks (frames include their bottom padding and hard shadow). */
function pageBottom(placed: Placed[], page: number, pad: number): number {
  return Math.max(...placed.filter((p) => p.page === page).map((p) => (p.rowH !== undefined ? p.y - pad + p.rowH : p.y + p.block.h + (p.block.frame ? pad : 0)) + (p.block.card?.hard?.dy ?? 0)));
}

/** Grid flow for one section: cards in rows of `cols`, every card in a row as tall as the tallest. */
function placeGrid(items: Block[], o: PlaceOpts, startPage: number, startY: number): PlaceResult {
  const placed: Placed[] = [];
  let overflow = false;
  let page = startPage;
  let y = startY;
  let atTop = false;
  const cards = items.filter((b) => !b.note);
  const notes = items.filter((b) => b.note);
  for (let i = 0; i < cards.length; i += o.cols) {
    const row = cards.slice(i, i + o.cols);
    const hard = Math.max(...row.map((b) => b.card?.hard?.dy ?? 0));
    const rowH = Math.max(...row.map((b) => b.h)) + 2 * o.pad;
    const lead = i === 0 || atTop ? 0 : o.frameGap;
    if (y + lead + rowH + hard > o.bottom && !(i === 0 && atTop)) {
      page++;
      y = o.top(page);
      atTop = true;
    } else {
      y += lead;
      atTop = false;
    }
    if (y + rowH > o.bottom + 0.01) overflow = true;
    row.forEach((b, c) => placed.push({ block: b, page, col: c, y: y + o.pad, rowH }));
    y += rowH + hard;
  }
  for (const n of notes) {
    y += o.gap;
    if (y + n.h > o.bottom) { page++; y = o.top(page); }
    placed.push({ block: n, page, col: 0, y, span: true });
    y += n.h;
  }
  return { placed, lastPage: page, overflow };
}

/**
 * Section flow: each group's heading spans the full width and its strategies flow in balanced columns
 * (or a grid) under it, like a magazine section. A heading never sits alone at the foot of a page.
 */
function placeSections(blocks: Block[], o: PlaceOpts, sectionGap: number, grid: boolean): PlaceResult {
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
    // Room for the heading and at least the first strategy (or it moves to the next page).
    const need = lead + s.head.h + (first ? first.h + (first.frame ? 2 * o.pad : 0) : 0);
    if (!firstOnPage && y + need > o.bottom) {
      page++;
      y = o.top(page);
    } else y += lead;
    all.push({ block: s.head, page, col: 0, y, span: true, sec: si });
    const itemsTop = y + s.head.h;
    const startPage = page;
    let placed: Placed[];
    let lastPage: number;
    if (grid) {
      const r = placeGrid(s.items, o, page, itemsTop);
      overflow ||= r.overflow;
      placed = r.placed;
      lastPage = r.lastPage;
    } else {
      const so: PlaceOpts = { ...o, firstPage: page, top: (p) => (p === startPage ? itemsTop : o.top(p)), contOnNewPageOnly: true, prevGroup: undefined };
      const r = place(s.items, so)!;
      overflow ||= r.overflow;
      placed = balanceLastPage(s.items, r.placed, r.lastPage, so);
      lastPage = r.lastPage;
    }
    all.push(...placed.map((pl) => ({ ...pl, sec: si })));
    page = lastPage;
    y = s.items.length ? pageBottom(placed, page, o.pad) : itemsTop;
    firstOnPage = false;
  });
  return { placed: all, lastPage: page, overflow };
}

export function layoutDocument(doc: OnePagerDocument, t: TemplateDef, cfg: LayoutConfig, groups = resolve(doc.selection)): LayoutResult {
  const { margins_mm: m } = doc.page;
  const contentW = doc.page.width_mm - m.left - m.right;
  const L = lookOf(doc.theme.look);
  const ctx: Ctx = { doc, t, cfg, L, F: fontsFor(L, doc.language), z: 100, colH: 1e6, usedImages: new Set(), contentW };
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
    frameGap: t.frame === "none" ? gap * 1.6 : Math.max(gap * 1.4, 3.5),
  };
  let placed: Placed[];
  let overflow: boolean;
  let page: number;
  if (blocks.some((b) => b.span)) {
    ({ placed, overflow, lastPage: page } = placeSections(blocks, opts, Math.max(cfg.spec.gap_mm * 1.1, cfg.spec.type.group * PT * 1.3), t.flow === "grid"));
  } else {
    const full = place(blocks, opts)!;
    overflow = full.overflow;
    page = full.lastPage;
    placed = balanceLastPage(blocks, full.placed, page, opts);
  }

  const pageCount = Math.max(1, page + 1);
  const x0 = (c: number) => m.left + c * (colW + cfg.spec.gap_mm);
  const background = L.page(groups.map(domainOf));
  const pages: Page[] = Array.from({ length: pageCount }, () => ({ id: uid("page"), background, elements: [] as Element[] }));

  // Frames: one background per contiguous run of same-frame blocks in a column (grid cards: the row height).
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
    frames.push({ p, top, h: p.rowH ?? last.y + last.block.h + pad - top });
  }
  // Columns flow: a row of cards side by side (one card per column, same section and page, starting level)
  // ends level too.
  const rowsOf = new Map<string, typeof frames>();
  for (const f of frames) {
    if (f.p.rowH !== undefined) continue;
    const k = `${f.p.page}|${f.p.sec ?? "-"}|${Math.round(f.top)}`;
    rowsOf.set(k, [...(rowsOf.get(k) ?? []), f]);
  }
  for (const [, row] of rowsOf) {
    const colsUsed = new Set(row.map((f) => f.p.col));
    if (row.length < 2 || colsUsed.size !== row.length) continue;
    const onlyInCol = row.every((f) => frames.filter((g) => g.p.page === f.p.page && g.p.col === f.p.col && (g.p.sec ?? -1) === (f.p.sec ?? -1)).length === 1);
    if (!onlyInCol) continue;
    const bottom = Math.max(...row.map((f) => f.top + f.h));
    for (const f of row) f.h = bottom - f.top;
  }
  let frameZ = 10;
  for (const { p, top, h } of frames) {
    const card = p.block.card ?? { style: {} };
    const w = colW - (card.hard?.dx ?? 0);
    const x = x0(p.col);
    pages[p.page].elements.push(...boxEls(ctx, x, top, w, h, card.style, "card", card.hard, frameZ));
    frameZ += 3;
    const a = card.accent;
    if (a) {
      const r = typeof card.style.radius_mm === "number" ? card.style.radius_mm : 0;
      const sw = card.style.stroke?.width_mm ?? 0;
      const accent: Style = { fill: a.colour, radius_mm: a.side === "top" ? [r, r, 0, 0] : [r, 0, 0, r] };
      pages[p.page].elements.push(a.side === "top"
        ? rectEl(ctx, x + sw, top + sw, w - 2 * sw, a.size, accent, "card accent", frameZ++)
        : rectEl(ctx, x, top, a.size, h, accent, "card accent", frameZ++));
      if (a.side === "top" && card.style.stroke) pages[p.page].elements.push(lineEl(ctx, x, top + sw + a.size, w, card.style.stroke.colour, card.style.stroke.width_mm * 0.8, "card accent rule"));
    }
    if (card.tape) {
      // A strip of tape across the top edge, slightly askew.
      const tw = Math.min(26, w * 0.34);
      pages[p.page].elements.push(rectEl(ctx, x + (w - tw) / 2 + (p.col % 2 ? 3 : -3), top - 2.2, tw, 5, { fill: card.tape }, "tape", 500 + frameZ, p.col % 2 ? 3 : -2.5));
    }
  }
  for (const p of placed) {
    const card = p.block.card;
    const inset = p.block.frame ? pad : 0;
    pages[p.page].elements.push(...p.block.render(ctx, (p.span ? m.left : x0(p.col)) + inset + (card?.accent?.side === "left" ? card.accent.size * 0.4 : 0), p.y));
  }
  pages.forEach((pg, i) => pg.elements.push(...hf.render(ctx, i, pageCount)));
  return { pages, overflow };
}
