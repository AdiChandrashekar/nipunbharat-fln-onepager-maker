/**
 * Language-aware text for auto-population. Rule: never mix languages inside one field. Hindi documents use
 * the *_hindi fields, English documents the English ones; bilingual = Hindi primary + English secondary.
 */
import {
  bucketById, competencyById, formatWeeks, isPrepCompetency, nipunGoals, routineById, strategyById,
} from "../data/compendium";
import type { Language, OptionalField, SelectionGroup } from "../model/types";

export const UI_LABELS = {
  explanation: { hi: "विस्तार से", en: "In detail" },
  example: { hi: "उदाहरण", en: "Example" },
  materials: { hi: "सामग्री", en: "Materials" },
  variants: { hi: "अन्य रूप", en: "Variants" },
  weeks: { hi: "संदर्शिका में", en: "In the guide" },
  english: { hi: "English", en: "English" },
  applies: { hi: "कब", en: "When" },
  also: { hi: "यह भी:", en: "also" },
  see: { hi: "देखें", en: "see" },
  page: { hi: "पृष्ठ", en: "Page" },
  credit: {
    hi: "स्रोत: आधारशिला क्रियान्वयन शिक्षक संदर्शिका, कक्षा 2 हिंदी (उत्तर प्रदेश), 2026-27",
    en: "Source: Aadharshila Kriyanvayan Shikshak Sandarshika (Teacher Guide), Grade 2 Hindi, Uttar Pradesh, 2026-27",
  },
  prep: { hi: "R2/R3 की पूर्व-तैयारी", en: "Prepares for NIPUN R2/R3" },
  routines: { hi: "विभेदित शिक्षण की दिनचर्या", en: "Differentiation routines" },
  defaultTitle: { hi: "शिक्षण रणनीतियाँ: शिक्षक एवं मेंटर हेतु", en: "Teaching strategies for teachers and mentors" },
  defaultSubtitle: { hi: "कक्षा 2 हिंदी · निपुण भारत", en: "Grade 2 Hindi · NIPUN Bharat" },
} as const;

export const FIELD_NAMES: Record<OptionalField, string> = {
  explanation: "Read-more explanation",
  example: "Example",
  materials: "Materials",
  variants: "Variants",
  weeks: "Weeks in the guide",
  english: "English secondary text",
};

const primary = (lang: Language): "hi" | "en" => (lang === "en" ? "en" : "hi");
export const label = (key: keyof typeof UI_LABELS, lang: Language) => UI_LABELS[key][primary(lang)];

export interface GroupText {
  code: string;
  name: string;
  name_secondary?: string;
  /** NIPUN chip / preparation chip text; undefined for buckets and routines. */
  chip?: string;
  kind: SelectionGroup["kind"];
  domain: string; // colour key: OL, DC, …, GA
}

export function groupText(g: SelectionGroup, lang: Language): GroupText {
  if (g.kind === "competency") {
    const c = competencyById.get(g.id)!;
    let chip: string | undefined;
    if (isPrepCompetency(g.id)) chip = label("prep", lang);
    else if (c.nipun_codes.length) {
      // Goal text exists only in Hindi (meta.nipun_codes); English documents show the codes alone.
      chip = lang === "en"
        ? `NIPUN ${c.nipun_codes.join(", ")}`
        : c.nipun_codes.map((n) => `निपुण ${n}: ${nipunGoals[n]}`).join("   ");
    }
    return {
      code: g.id,
      name: lang === "en" ? c.competency_name_english : c.competency_name_hindi,
      name_secondary: lang === "bi" ? c.competency_name_english : undefined,
      chip,
      kind: g.kind,
      domain: c.domain_id,
    };
  }
  if (g.kind === "bucket") {
    const b = bucketById.get(g.id)!;
    return {
      code: g.id.replace(/^GA-/, ""),
      name: lang === "en" ? b.bucket_name_english : b.bucket_name_hindi,
      name_secondary: lang === "bi" ? b.bucket_name_english : undefined,
      kind: g.kind,
      domain: "GA",
    };
  }
  return {
    code: "DR",
    name: label("routines", lang),
    name_secondary: lang === "bi" ? UI_LABELS.routines.en : undefined,
    kind: g.kind,
    domain: "GA",
  };
}

export interface ItemText {
  name: string;
  name_secondary?: string;
  how_to: string;
  optional: Partial<Record<OptionalField | "applies", string | string[]>>;
}

/** "कागज़ की गेंद (paper ball)" → Hindi or English part. */
function splitBilingual(s: string, lang: Language): string {
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(s);
  if (!m || lang === "bi") return s;
  return lang === "en" ? m[2] : m[1];
}

const BM_REF = /\s*\((?:BM|Front matter) p\.\s?\d+(?:,\s*(?:BM|Front matter) p\.\s?\d+)*\)/g;

function guidePages(refs: string[] | undefined, lang: Language): string | undefined {
  if (!refs?.length) return undefined;
  const pages = refs.map((r) => r.replace(/^(BM|Front matter) p\.\s?/, "")).join(", ");
  return lang === "en" ? `Guide p. ${pages}` : `संदर्शिका पृ. ${pages}`;
}

export function itemText(kind: "strategy" | "routine", id: string, lang: Language): ItemText {
  const p = primary(lang);
  if (kind === "routine") {
    const r = routineById.get(id)!;
    return {
      name: p === "en" ? r.routine_name_english : r.routine_name_hindi,
      name_secondary: lang === "bi" ? r.routine_name_english : undefined,
      how_to: p === "en" ? r.how_to_english : r.how_to_hindi,
      optional: {
        applies: p === "en" ? r.applies_to : r.applies_to_hindi,
        weeks: formatWeeks(r.source_refs, p) || undefined,
        english: lang === "bi" ? r.how_to_english : undefined,
      },
    };
  }
  const s = strategyById.get(id)!;
  const explanation = (p === "en" ? s.detailed_explanation_english : s.detailed_explanation_hindi)?.replace(BM_REF, "");
  return {
    name: p === "en" ? s.strategy_name_english : s.strategy_name_hindi,
    name_secondary: lang === "bi" ? s.strategy_name_english : undefined,
    how_to: p === "en" ? s.how_to_english : s.how_to_hindi,
    optional: {
      explanation: explanation || undefined,
      // Examples are Hindi classroom language (with some English glosses) in a single field; they are shown
      // as written because the Hindi words are the teaching content itself.
      example: s.example || undefined,
      materials: s.materials?.map((m) => splitBilingual(m, lang)),
      variants: s.variants?.map((v) => (p === "en" ? v.note : v.note_hindi)),
      weeks: formatWeeks(s.source_refs, p) || guidePages(s.reference_pages, lang),
      english: lang === "bi" ? s.how_to_english : undefined,
    },
  };
}

/** Short code for "also OL2" notes and pointers. */
export function groupCode(gid: string): string {
  return gid.replace(/^GA-/, "");
}
