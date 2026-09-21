/**
 * Read-only view of the data pipeline output (compendium.json + web/translations_hi.json + image library).
 * Never write back: content changes go through merge.py / consolidate.py.
 */
import rawCompendium from "../../../compendium.json";
import translations from "../../../web/translations_hi.json";
import imageLibrary from "../../data/image_library.json";

export interface Variant { note: string; note_hindi: string; source_refs: string[] }
export interface Strategy {
  strategy_id: string;
  strategy_name_hindi: string;
  strategy_name_english: string;
  type: "competency" | "general";
  competency_ids: string[];
  bucket_id?: string;
  how_to_hindi: string;
  how_to_english: string;
  detailed_explanation_hindi?: string;
  detailed_explanation_english?: string;
  example?: string;
  materials?: string[];
  variants?: Variant[];
  source_refs: string[];
  frequency_count: number;
  shared_resource_refs?: string[];
  reference_pages?: string[];
}
export interface Competency {
  competency_id: string;
  competency_name_hindi: string;
  competency_name_english: string;
  nipun_codes: string[];
  domain_id: string;
}
export interface Domain { domain_id: string; domain_name_english: string; domain_name_hindi: string; competencies: Competency[] }
export interface Bucket { bucket_id: string; bucket_name_english: string; bucket_name_hindi: string }
export interface Routine {
  routine_id: string;
  routine_name_hindi: string;
  routine_name_english: string;
  how_to_hindi: string;
  how_to_english: string;
  applies_to: string[];
  applies_to_hindi: string[];
  source_refs: string[];
  frequency_count: number;
}
export interface LibraryImage {
  image_id: string;
  file: string;
  kind: "illustration" | "infographic" | "diagram";
  source: { pdf_page: number; printed_page: number };
  width_px: number;
  height_px: number;
  aspect: number;
  caption_hi: string;
  caption_en: string;
  tags: { strategy_ids: string[]; competency_ids: string[]; bucket_ids: string[]; routine_ids: string[] };
}

// Hindi names the kosh web page uses for domains and buckets (the taxonomy stores English only).
const DOMAIN_HI: Record<string, string> = {
  OL: "मौखिक भाषा", SE: "सामाजिक-भावनात्मक", DC: "डिकोडिंग", RF: "पठन प्रवाह",
  RC: "समझ के साथ पढ़ना", WR: "लेखन", GA: "सामान्य गतिविधियाँ",
};
const BUCKET_HI: Record<string, string> = {
  "GA-WARM": "सौहार्दपूर्ण वातावरण", "GA-CFU": "समझ की जाँच", "GA-ASSESS": "आकलन की विधि", "GA-REVIEW": "पुनरावृत्ति",
  "GA-PEER": "जोड़ी / समूह कार्य", "GA-DISPLAY": "बच्चों का कार्य प्रदर्शित करना", "GA-CREATE": "सृजनात्मक गतिविधियाँ",
  "GA-FACIL": "शिक्षण के सामान्य तरीके",
};
const MERGED_TAG = /^\[merged from '[^']*'\]\s*/;

type RawVariant = { note: string; source_refs: string[] };
const raw = rawCompendium as unknown as Omit<typeof rawCompendium, "strategies" | "differentiation_routines"> & {
  strategies: (Omit<Strategy, "variants"> & { variants?: RawVariant[] })[];
  differentiation_routines: Omit<Routine, "applies_to_hindi">[];
};
const tr = translations as { variant_notes: Record<string, string>; applies_to: Record<string, string> };

export const strategies: Strategy[] = raw.strategies.map((s) => ({
  ...s,
  variants: s.variants?.map((v) => ({
    ...v,
    note_hindi: tr.variant_notes[v.note] ?? v.note,
    note: v.note.replace(MERGED_TAG, ""),
  })),
}));

export const domains: Domain[] = raw.taxonomy.domains.map((d) => ({
  domain_id: d.domain_id,
  domain_name_english: d.domain_name_english,
  domain_name_hindi: DOMAIN_HI[d.domain_id] ?? d.domain_name_english,
  competencies: d.competencies.map((c) => ({ ...c, domain_id: d.domain_id })),
}));

export const buckets: Bucket[] = raw.taxonomy.general_activity_buckets.map((b) => ({
  ...b,
  bucket_name_hindi: BUCKET_HI[b.bucket_id] ?? b.bucket_name_english,
}));

export const routines: Routine[] = raw.differentiation_routines.map((r) => ({
  ...r,
  applies_to_hindi: r.applies_to.map((a) => tr.applies_to[a] ?? a),
}));

export const nipunGoals: Record<string, string> = raw.meta.nipun_codes as Record<string, string>;
export const sourceCredit = raw.meta.source;

export const competencies: Competency[] = domains.flatMap((d) => d.competencies);
export const competencyById = new Map(competencies.map((c) => [c.competency_id, c]));
export const strategyById = new Map(strategies.map((s) => [s.strategy_id, s]));
export const routineById = new Map(routines.map((r) => [r.routine_id, r]));
export const bucketById = new Map(buckets.map((b) => [b.bucket_id, b]));

const lib = imageLibrary as unknown as {
  images: LibraryImage[];
  by_strategy: Record<string, string[]>;
  by_competency: Record<string, string[]>;
  by_bucket: Record<string, string[]>;
  by_routine: Record<string, string[]>;
};
export const libraryImages = lib.images;
export const imageById = new Map(lib.images.map((i) => [i.image_id, i]));
export const imagesForStrategy = (id: string) => lib.by_strategy[id] ?? [];
export const imagesForCompetency = (id: string) => lib.by_competency[id] ?? [];
export const imagesForRoutine = (id: string) => lib.by_routine[id] ?? [];
export const imagesForBucket = (id: string) => lib.by_bucket[id] ?? [];

/** Decoding competencies DC1–DC6 have no NIPUN goal of their own: they prepare for R2/R3. */
export const isPrepCompetency = (id: string) => /^DC[1-6]$/.test(id);

export function domainColourKey(competencyOrBucket: string): string {
  return `d_${competencyOrBucket.startsWith("GA") ? "GA" : competencyOrBucket.replace(/\d+$/, "")}`;
}

/** "W3D2", "W3D4", "W5D1" → Hindi "स.3 · दि. 2, 4; स.5 · दि. 1" or English "W3 · D2, 4; W5 · D1". */
export function formatWeeks(refs: string[], lang: "hi" | "en"): string {
  const byWeek = new Map<number, number[]>();
  for (const r of refs) {
    const m = /^W(\d+)D(\d+)$/.exec(r);
    if (!m) continue;
    const w = +m[1], d = +m[2];
    const days = byWeek.get(w) ?? [];
    if (!days.includes(d)) days.push(d);
    byWeek.set(w, days);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, ds]) => {
      const days = ds.sort((a, b) => a - b).join(", ");
      return lang === "hi" ? `स.${w} · दि. ${days}` : `W${w} · D${days}`;
    })
    .join("; ");
}
