/** CSS reference: 96 px per inch. */
export const PX_PER_MM = 96 / 25.4;
export const MM_PER_PT = 25.4 / 72;

export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const ptToMm = (pt: number) => pt * MM_PER_PT;

export function box4(v: number | [number, number, number, number] | undefined): [number, number, number, number] {
  if (v === undefined) return [0, 0, 0, 0];
  return typeof v === "number" ? [v, v, v, v] : v;
}

let counter = 0;
export function uid(prefix = "el"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
