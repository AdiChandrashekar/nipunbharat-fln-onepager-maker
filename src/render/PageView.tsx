import type { ReactNode } from "react";
import type { Page, PageSetup } from "../model/types";
import { ElementView, sortByZ, type EditHooks } from "./ElementView";

interface Props {
  page: Page;
  setup: PageSetup;
  /** Display scale (1 = true size at 96 px/in). Export always renders at 1. */
  scale?: number;
  /** Show bleed area around the trim box (print export), else clip to trim. */
  withBleed?: boolean;
  /** Editor overlays (selection handles, margin guides) drawn in page mm coordinates. */
  overlay?: ReactNode;
  hooks?: EditHooks;
}

/** Renders one page as absolutely positioned DOM in mm. The same component serves editor, thumbnails and export. */
export function PageView({ page, setup, scale = 1, withBleed = false, overlay, hooks }: Props) {
  const bleed = withBleed ? setup.bleed_mm : 0;
  const w = setup.width_mm + 2 * bleed;
  const h = setup.height_mm + 2 * bleed;
  return (
    <div className="page-shell" style={{ width: `${w * scale}mm`, height: `${h * scale}mm`, position: "relative" }}>
      <div
        className="page"
        data-page={page.id}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${w}mm`,
          height: `${h}mm`,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: "0 0",
          background: page.background ?? "#FFFFFF",
          overflow: "hidden",
        }}
      >
        <div className="trim" style={{ position: "absolute", left: `${bleed}mm`, top: `${bleed}mm`, width: `${setup.width_mm}mm`, height: `${setup.height_mm}mm` }}>
          {sortByZ(page.elements).map((el) => (
            <ElementView key={el.id} el={el} top hooks={hooks} />
          ))}
          {overlay}
        </div>
      </div>
    </div>
  );
}
