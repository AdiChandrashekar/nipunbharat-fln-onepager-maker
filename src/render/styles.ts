import type { CSSProperties } from "react";
import type { Element, ImageContent, Style } from "../model/types";
import { box4 } from "../model/units";
import { fontStack } from "../theme/tokens";

const mm = (v: number) => `${round(v)}mm`;
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Text CSS shared by the renderer and the text measurer, so fitting and output agree exactly. */
export function textCss(style: Style): CSSProperties {
  const [pt, pr, pb, pl] = box4(style.padding_mm);
  return {
    fontFamily: fontStack(style.font_family),
    fontSize: `${style.font_size_pt ?? 10}pt`,
    fontWeight: style.weight ?? 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.colour ?? "#15202C",
    textAlign: style.align ?? "left",
    lineHeight: style.line_height ?? 1.4,
    letterSpacing: style.letter_spacing_em ? `${style.letter_spacing_em}em` : undefined,
    padding: `${mm(pt)} ${mm(pr)} ${mm(pb)} ${mm(pl)}`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    fontKerning: "normal",
    textRendering: "optimizeLegibility",
    boxSizing: "border-box",
  };
}

/** Fill, stroke (drawn inside the box, as in Figma's default), radius, opacity. */
export function boxCss(style: Style, ellipse = false): CSSProperties {
  const r = box4(style.radius_mm);
  return {
    background: style.fill,
    border: style.stroke ? `${mm(style.stroke.width_mm)} ${style.stroke.dash ?? "solid"} ${style.stroke.colour}` : undefined,
    borderRadius: ellipse ? "50%" : r.some(Boolean) ? r.map(mm).join(" ") : undefined,
    opacity: style.opacity,
    boxShadow: style.shadow,
    boxSizing: "border-box",
  };
}

export function frameCss(el: Element): CSSProperties {
  return {
    position: "absolute",
    left: mm(el.x_mm),
    top: mm(el.y_mm),
    width: mm(el.w_mm),
    height: mm(el.h_mm),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "50% 50%",
    zIndex: el.z,
    visibility: el.hidden ? "hidden" : undefined,
  };
}

/**
 * Placement of the source image inside its frame: the crop region is scaled to cover (or fit inside)
 * the frame and centred. Exporters must use the same rule; it is pure arithmetic on the model.
 */
export function imagePlacement(c: ImageContent, frameW: number, frameH: number) {
  const [nw, nh] = c.natural_px;
  const cw = c.crop.w * nw;
  const ch = c.crop.h * nh;
  const s = c.fit === "contain" ? Math.min(frameW / cw, frameH / ch) : Math.max(frameW / cw, frameH / ch);
  return {
    width_mm: nw * s,
    height_mm: nh * s,
    left_mm: frameW / 2 - (c.crop.x * nw + cw / 2) * s,
    top_mm: frameH / 2 - (c.crop.y * nh + ch / 2) * s,
  };
}

export function imageUrl(ref: string): string {
  const [kind, id] = ref.split(/:(.*)/s);
  if (kind === "tg") return `${import.meta.env.BASE_URL}tg/${id}.png`;
  if (kind === "upload") return `/uploads/${id}`;
  return ref;
}
