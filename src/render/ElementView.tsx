import type { CSSProperties } from "react";
import type { Element } from "../model/types";
import { boxCss, frameCss, imagePlacement, imageUrl, textCss } from "./styles";

const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

export function ElementView({ el }: { el: Element }) {
  const frame = frameCss(el);
  const attrs = { "data-el": el.id, "data-type": el.type } as Record<string, string>;

  switch (el.type) {
    case "text": {
      const css: CSSProperties = {
        ...frame,
        ...boxCss(el.style),
        ...textCss(el.style),
        display: "flex",
        flexDirection: "column",
        justifyContent: JUSTIFY[el.style.vertical_align ?? "top"],
      };
      const runs = el.content.runs;
      return (
        <div style={css} {...attrs}>
          <div>
            {runs
              ? runs.map((r, i) => (
                  <span key={i} style={r.style ? textRunCss(r.style) : undefined}>
                    {r.text}
                  </span>
                ))
              : el.content.text}
          </div>
        </div>
      );
    }
    case "image": {
      const p = imagePlacement(el.content, el.w_mm, el.h_mm);
      return (
        <div style={{ ...frame, ...boxCss(el.style), overflow: "hidden" }} {...attrs}>
          <img
            src={imageUrl(el.content.image_ref)}
            alt={el.content.alt ?? ""}
            draggable={false}
            style={{
              position: "absolute",
              left: `${p.left_mm}mm`,
              top: `${p.top_mm}mm`,
              width: `${p.width_mm}mm`,
              height: `${p.height_mm}mm`,
              maxWidth: "none",
            }}
          />
        </div>
      );
    }
    case "shape":
      return <div style={{ ...frame, ...boxCss(el.style, el.content.shape_kind === "ellipse") }} {...attrs} />;
    case "line": {
      const s = el.style.stroke ?? { colour: "#15202C", width_mm: 0.3 };
      // A border strip rotated about its start point: exact for any angle, and (unlike a zero-height SVG) always painted.
      const len = Math.hypot(el.w_mm, el.h_mm);
      const angle = (Math.atan2(el.h_mm, el.w_mm) * 180) / Math.PI;
      return (
        <div
          style={{
            position: "absolute",
            left: `${el.x_mm}mm`,
            top: `${el.y_mm - s.width_mm / 2}mm`,
            width: `${len}mm`,
            height: 0,
            borderTop: `${s.width_mm}mm ${s.dash ?? "solid"} ${s.colour}`,
            transform: angle ? `rotate(${angle}deg)` : undefined,
            transformOrigin: `0 ${s.width_mm / 2}mm`,
            zIndex: el.z,
            opacity: el.style.opacity,
            visibility: el.hidden ? "hidden" : undefined,
          }}
          {...attrs}
        />
      );
    }
    case "group":
      return (
        <div style={{ ...frame, ...boxCss(el.style) }} {...attrs}>
          {sortByZ(el.content.children).map((c) => (
            <ElementView key={c.id} el={c} />
          ))}
        </div>
      );
  }
}

function textRunCss(s: NonNullable<NonNullable<import("../model/types").TextContent["runs"]>[number]["style"]>): CSSProperties {
  return {
    fontWeight: s.weight,
    fontStyle: s.italic ? "italic" : undefined,
    color: s.colour,
    fontFamily: s.font_family ? `"${s.font_family}", "Noto Sans Devanagari", sans-serif` : undefined,
    fontSize: s.font_size_pt ? `${s.font_size_pt}pt` : undefined,
  };
}

export function sortByZ<T extends { z: number }>(els: T[]): T[] {
  return [...els].sort((a, b) => a.z - b.z);
}
