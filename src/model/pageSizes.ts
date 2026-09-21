import type { Margins, Orientation, PageSetup, PageSizeId } from "./types";

/** Portrait trim sizes in mm. */
export const PAGE_SIZES: Record<Exclude<PageSizeId, "custom">, { w: number; h: number; label: string }> = {
  A3: { w: 297, h: 420, label: "A3" },
  A4: { w: 210, h: 297, label: "A4" },
  A5: { w: 148, h: 210, label: "A5" },
  A6: { w: 105, h: 148, label: "A6" },
  Letter: { w: 215.9, h: 279.4, label: "US Letter" },
  Legal: { w: 215.9, h: 355.6, label: "US Legal" },
};

/** Default margins scale with the page's short side (≈ 12 mm on A4, 8 mm on A6, 16 mm on A3). */
export function defaultMargins(w: number, h: number): Margins {
  const m = Math.round(Math.min(w, h) * 0.057 * 2) / 2;
  return { top: m, right: m, bottom: m, left: m };
}

export function makePage(
  size: PageSizeId,
  orientation: Orientation,
  opts: { custom?: { w: number; h: number }; margins?: Margins; bleed_mm?: number } = {},
): PageSetup {
  const base = size === "custom" ? opts.custom : PAGE_SIZES[size];
  if (!base) throw new Error("custom page size needs width and height");
  const short = Math.min(base.w, base.h);
  const long = Math.max(base.w, base.h);
  const [w, h] = orientation === "portrait" ? [short, long] : [long, short];
  return {
    size,
    orientation,
    width_mm: w,
    height_mm: h,
    margins_mm: opts.margins ?? defaultMargins(w, h),
    bleed_mm: opts.bleed_mm ?? 0,
  };
}

export function pageLabel(p: PageSetup): string {
  const name = p.size === "custom" ? `${p.width_mm} × ${p.height_mm} mm` : PAGE_SIZES[p.size].label;
  return `${name} ${p.orientation}`;
}

/** Body text floor for the page (spec: ≥ 9 pt on A4/A5, larger on posters, a little smaller only on A6). */
export function minBodyPt(p: PageSetup): number {
  const area = p.width_mm * p.height_mm;
  if (area >= 297 * 420 * 0.95) return 12; // A3 and up
  if (area <= 105 * 148 * 1.05) return 8; // A6
  return 9;
}
