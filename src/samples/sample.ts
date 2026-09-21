/**
 * Phase 2 hand-written sample: a fixed, hand-positioned layout (not the template engine) used to check
 * page sizes, mm geometry and Devanagari rendering. Content comes from compendium.json.
 */
import {
  competencyById, formatWeeks, imageById, imagesForStrategy, nipunGoals, strategyById,
} from "../data/compendium";
import { measureTextHeight, measureTextWidth } from "../layout/measure";
import { makePage, pageLabel } from "../model/pageSizes";
import type { Element, OnePagerDocument, Orientation, PageSizeId, Style } from "../model/types";
import { SCHEMA_VERSION } from "../model/types";
import { uid } from "../model/units";
import { KOSH_LIGHT, tint } from "../theme/tokens";

const P = KOSH_LIGHT.palette;
const F = KOSH_LIGHT.fonts;
export const DEVANAGARI_TEST = "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग";

let z = 0;
const base = (x: number, y: number, w: number, h: number) => ({ id: uid(), x_mm: x, y_mm: y, w_mm: w, h_mm: h, rotation: 0, z: z++, locked: false });

function text(x: number, y: number, w: number, t: string, style: Style, extra: Partial<Element> = {}, h?: number): Element {
  const height = h ?? measureTextHeight(t, style, w);
  return { ...base(x, y, w, height), type: "text", style, content: { text: t }, ...extra } as Element;
}

function chip(x: number, y: number, t: string, style: Style, binding?: Element["binding"]): Element {
  const w = measureTextWidth(t, style) + 0.2;
  return text(x, y, w, t, style, { binding, name: `chip ${t}` });
}

function image(x: number, y: number, w: number, imageId: string, strategyId: string): Element {
  const im = imageById.get(imageId)!;
  const h = w / im.aspect;
  return {
    ...base(x, y, w, h), type: "image", name: im.caption_en,
    style: { stroke: { colour: P.rule, width_mm: 0.25 }, radius_mm: 1.5 },
    content: { image_ref: `tg:${imageId}`, natural_px: [im.width_px, im.height_px], crop: { x: 0, y: 0, w: 1, h: 1 }, fit: "cover", alt: im.caption_hi },
    binding: { strategy_id: strategyId, field: "image" },
  };
}

export function buildSample(size: PageSizeId, orientation: Orientation): OnePagerDocument {
  z = 0;
  const page = makePage(size, orientation);
  const { width_mm: W, height_mm: H, margins_mm: m } = page;
  const small = W * H < 200 * 200; // A5 and below
  const body: Style = { font_family: F.body, font_size_pt: small ? 9 : 10.5, line_height: 1.45, colour: P.ink };
  const els: Element[] = [];

  // Header band runs to the page edge (bleed-ready); title sits inside the margins.
  const title = "ब्लेंडिंग और शब्द निर्माण";
  const titleStyle: Style = { font_family: F.display, font_size_pt: small ? 17 : 22, line_height: 1.25, colour: P.accent_ink };
  const subStyle: Style = { font_family: F.body, font_size_pt: small ? 9 : 10.5, line_height: 1.35, colour: "#DCE6F5" };
  const sub = `शिक्षक एवं मेंटर हेतु मार्गदर्शिका · कक्षा 2 हिंदी · ${pageLabel(page)} (${W} × ${H} मिमी)`;
  const titleH = measureTextHeight(title, titleStyle, W - m.left - m.right);
  const subH = measureTextHeight(sub, subStyle, W - m.left - m.right);
  const bandH = m.top + titleH + 1 + subH + 4;
  els.push({ ...base(0, 0, W, bandH), type: "shape", name: "header band", style: { fill: P.accent }, content: { shape_kind: "rect" } });
  els.push(text(m.left, m.top - 2, W - m.left - m.right, title, titleStyle, { name: "title", binding: { field: "title" } }));
  els.push(text(m.left, m.top - 2 + titleH + 1, W - m.left - m.right, sub, subStyle, { name: "subtitle", binding: { field: "subtitle" } }));

  // Footer: rule + source credit + editable org/author/date.
  const footStyle: Style = { font_family: F.body, font_size_pt: small ? 7 : 8, line_height: 1.35, colour: P.muted };
  const credit = "स्रोत: आधारशिला क्रियान्वयन शिक्षक संदर्शिका, कक्षा 2 हिंदी (उत्तर प्रदेश), 2026-27";
  const footW = (W - m.left - m.right) * 0.62;
  const creditH = measureTextHeight(credit, footStyle, footW);
  const footY = H - m.bottom - creditH;
  els.push({ ...base(m.left, footY - 2, W - m.left - m.right, 0), type: "line", name: "footer rule", style: { stroke: { colour: P.rule, width_mm: 0.3 } }, content: { line: true } });
  els.push(text(m.left, footY, footW, credit, footStyle, { name: "source credit", binding: { field: "footer_credit" } }));
  els.push(text(m.left + footW, footY, W - m.left - m.right - footW, "संस्था · लेखक · दिनांक", { ...footStyle, align: "right" }, { name: "org · author · date", binding: { field: "footer_meta" } }));

  // Body: two competency blocks; side by side in landscape, stacked in portrait.
  const top = bandH + (small ? 4 : 6);
  const cols = orientation === "landscape" ? 2 : 1;
  const gap = small ? 5 : 7;
  const colW = (W - m.left - m.right - gap * (cols - 1)) / cols;
  const blocks: [string, string[]][] = [["DC5", ["dc-break-and-blend"]], ["DC7", ["dc-grid-word-search"]]];
  let y = top;
  blocks.forEach(([cid, sids], i) => {
    const x = m.left + (cols === 2 ? i * (colW + gap) : 0);
    if (cols === 2) y = top;
    y = competencyBlock(els, x, y, colW, cid, sids, body, small) + (small ? 4 : 6);
  });
  const bodyBottom = cols === 2 ? Math.max(y, top) : y;

  // Devanagari check panel + 100 mm scale bar.
  devanagariPanel(els, m.left, bodyBottom, W - m.left - m.right, small);

  return {
    schema_version: SCHEMA_VERSION,
    id: `sample-${size}-${orientation}`.toLowerCase(),
    title,
    language: "hi",
    page,
    selection: [
      { kind: "competency", id: "DC5", origin: "competency", items: ["dc-break-and-blend"] },
      { kind: "competency", id: "DC7", origin: "competency", items: ["dc-grid-word-search"] },
    ],
    layout: { template: "hand-written-sample", tier: "auto", fit_pages: "auto", manually_edited: true },
    theme: KOSH_LIGHT,
    meta: { organisation: "", author: "", date: "", subtitle: sub, created: new Date().toISOString(), updated: new Date().toISOString() },
    pages: [{ id: uid("page"), elements: els }],
  };
}

function competencyBlock(els: Element[], x: number, y: number, w: number, cid: string, sids: string[], body: Style, small: boolean): number {
  const c = competencyById.get(cid)!;
  const dom = P[`d_${c.domain_id}`];
  const chipStyle: Style = { font_family: F.mono, font_size_pt: small ? 8 : 9, weight: 500, colour: dom, fill: tint(dom, 0.86), radius_mm: [3, 3, 3, 1], padding_mm: [0.6, 2.2, 0.4, 2.2], line_height: 1.4 };
  const code = chip(x, y + 0.6, cid, chipStyle, { competency_id: cid, field: "code" });
  els.push(code);
  const nameStyle: Style = { font_family: F.display, font_size_pt: small ? 13 : 16, line_height: 1.3, colour: P.ink };
  const nameX = x + code.w_mm + 2.5;
  const name = text(nameX, y, x + w - nameX, c.competency_name_hindi, nameStyle, { name: `${cid} name`, binding: { competency_id: cid, field: "name" } });
  els.push(name);
  y += Math.max(name.h_mm, code.h_mm) + 1.2;

  // NIPUN chip with goal text, or the DC1–DC6 preparation chip.
  const goalStyle: Style = { font_family: F.body, font_size_pt: small ? 8 : 9, line_height: 1.4, colour: P.mark, fill: P.mark_bg, radius_mm: [3, 3, 3, 1], padding_mm: [0.8, 2.4, 0.6, 2.4] };
  const goal = /^DC[1-6]$/.test(cid)
    ? "R2/R3 की पूर्व-तैयारी"
    : c.nipun_codes.map((n) => `निपुण ${n}: ${nipunGoals[n]}`).join("  ");
  const g = text(x, y, w, goal, goalStyle, { name: "NIPUN chip", binding: { competency_id: cid, field: "nipun_chip" } });
  els.push(g);
  y += g.h_mm + (small ? 2.5 : 3.5);

  for (const sid of sids) {
    const s = strategyById.get(sid)!;
    const imgW = w * (small ? 0.36 : 0.34);
    const textW = w - imgW - (small ? 3 : 4);
    const sName = text(x, y, textW, s.strategy_name_hindi, { ...body, weight: 700, font_size_pt: (body.font_size_pt ?? 10) + 1, colour: P.accent }, { name: "strategy name", binding: { strategy_id: sid, field: "name" } });
    const how = text(x, y + sName.h_mm + 0.8, textW, s.how_to_hindi, body, { name: "how-to", binding: { strategy_id: sid, field: "how_to" } });
    const weeks = text(x, how.y_mm + how.h_mm + 1, textW, `कहाँ: ${formatWeeks(s.source_refs, "hi").split("; ").slice(0, 4).join("; ")} …`, { ...body, font_size_pt: (body.font_size_pt ?? 10) - 1.5, colour: P.muted }, { name: "weeks", binding: { strategy_id: sid, field: "weeks" } });
    const img = image(x + textW + (small ? 3 : 4), y + 0.8, imgW, imagesForStrategy(sid)[0], sid);
    els.push(sName, how, weeks, img);
    y = Math.max(weeks.y_mm + weeks.h_mm, img.y_mm + img.h_mm);
  }
  return y;
}

function devanagariPanel(els: Element[], x: number, y: number, w: number, small: boolean) {
  const pad = small ? 2.5 : 3.5;
  const label: Style = { font_family: F.mono, font_size_pt: small ? 6.5 : 7.5, weight: 500, colour: P.muted, line_height: 1.3 };
  const fonts = [F.display, F.body, "Noto Sans Devanagari", F.mono];
  const rows = fonts.map((f) => ({ f, style: { font_family: f, font_size_pt: small ? 12 : 14, line_height: 1.5, colour: P.ink } as Style }));
  const labelW = small ? 30 : 42;
  const heights = rows.map((r) => measureTextHeight(DEVANAGARI_TEST, r.style, w - 2 * pad - labelW));
  const head = "देवनागरी जाँच (संयुक्ताक्षर एवं मात्राएँ) · Devanagari shaping check";
  const headStyle: Style = { font_family: F.body, font_size_pt: small ? 8 : 9, weight: 600, colour: P.accent, line_height: 1.3 };
  const headH = measureTextHeight(head, headStyle, w - 2 * pad);
  const panelH = pad + headH + 1.5 + heights.reduce((a, b) => a + b, 0) + pad + 7;
  els.push({ ...base(x, y, w, panelH), type: "shape", name: "check panel", style: { fill: P.tint, radius_mm: [4, 4, 4, 1.5] }, content: { shape_kind: "rect" } });
  els.push(text(x + pad, y + pad, w - 2 * pad, head, headStyle, { name: "check heading" }));
  let ry = y + pad + headH + 1.5;
  rows.forEach((r, i) => {
    els.push(text(x + pad, ry + (heights[i] - 3.2) / 2, labelW, r.f, label, { name: `label ${r.f}` }));
    els.push(text(x + pad + labelW, ry, w - 2 * pad - labelW, DEVANAGARI_TEST, r.style, { name: `test ${r.f}` }));
    ry += heights[i];
  });
  // 100 mm scale bar with 10 mm ticks: measure it on a print to verify true size.
  const barY = ry + 3;
  els.push({ ...base(x + pad, barY, 100, 0), type: "line", name: "100 mm bar", style: { stroke: { colour: P.ink, width_mm: 0.35 } }, content: { line: true } });
  for (let t = 0; t <= 100; t += 10) {
    els.push({ ...base(x + pad + t, barY - (t % 50 ? 1 : 1.8), 0, t % 50 ? 1 : 1.8), type: "line", name: `tick ${t}`, style: { stroke: { colour: P.ink, width_mm: 0.3 } }, content: { line: true } });
  }
  els.push(text(x + pad + 102, barY - 1.8, 30, "100 mm", label, { name: "scale label" }));
}
