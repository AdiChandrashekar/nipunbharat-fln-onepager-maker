/**
 * Language-aware text for auto-population. Rule: never mix languages inside one field. Hindi documents use
 * the *_hindi fields, English documents the English ones; bilingual = Hindi primary + English secondary.
 */
import { bucketById, competencyById, domains, formatWeeks, routineById, strategyById } from "../data/compendium";
import type { Language, OptionalField, SelectionGroup } from "../model/types";

export const UI_LABELS = {
  explanation: { hi: "विस्तार से", en: "In detail" },
  example: { hi: "उदाहरण", en: "Example" },
  materials: { hi: "सामग्री", en: "Materials" },
  variants: { hi: "अन्य रूप", en: "Variants" },
  weeks: { hi: "संदर्शिका में", en: "In the guide" },
  english: { hi: "English", en: "English" },
  applies: { hi: "कब", en: "When" },
  also: { hi: "इनमें भी सहायक:", en: "Also supports:" },
  see: { hi: "देखें", en: "see" },
  continued: { hi: "जारी", en: "continued" },
  page: { hi: "पृष्ठ", en: "Page" },
  credit: {
    hi: "स्रोत: आधारशिला क्रियान्वयन शिक्षक संदर्शिका, कक्षा 2 हिंदी (उत्तर प्रदेश), 2026-27",
    en: "Source: Aadharshila Kriyanvayan Shikshak Sandarshika (Teacher Guide), Grade 2 Hindi, Uttar Pradesh, 2026-27",
  },
  routines: { hi: "विभेदित शिक्षण की दिनचर्या", en: "Differentiation routines" },
  generalActivities: { hi: "सामान्य गतिविधियाँ", en: "General activities" },
  defaultTitle: { hi: "शिक्षण रणनीतियाँ: शिक्षक एवं मेंटर हेतु", en: "Teaching strategies for teachers and mentors" },
  defaultSubtitle: { hi: "कक्षा 2 हिंदी · निपुण भारत", en: "Grade 2 Hindi · NIPUN Bharat" },
} as const;

export const FIELD_NAMES: Record<OptionalField, string> = {
  explanation: "Read-more explanation",
  example: "Example",
  materials: "Materials",
  variants: "अन्य रूप (variants)",
  weeks: "संदर्शिका में (weeks in the guide)",
  english: "English secondary text",
};

const primary = (lang: Language): "hi" | "en" => (lang === "en" ? "en" : "hi");
export const label = (key: keyof typeof UI_LABELS, lang: Language) => UI_LABELS[key][primary(lang)];

/**
 * Group heading text. `code` (DC5, OL2, CFU …) is our internal categorisation: it appears in the selector
 * and tray only, never on a one-pager, because it isn't Sandarshika nomenclature. Likewise no NIPUN chips.
 */
export interface GroupText {
  code: string;
  name: string;
  name_secondary?: string;
  kind: SelectionGroup["kind"];
  domain: string; // colour key: OL, DC, …, GA
}

export function groupText(g: SelectionGroup, lang: Language): GroupText {
  if (g.kind === "competency") {
    const c = competencyById.get(g.id)!;
    return {
      code: g.id,
      name: lang === "en" ? c.competency_name_english : c.competency_name_hindi,
      name_secondary: lang === "bi" ? c.competency_name_english : undefined,
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

/**
 * A how-to as numbered steps: the compendium joins a strategy's steps with semicolons. Splits only at
 * top level (not inside brackets or quotes) and ends each step with a full stop (। in Hindi).
 */
export function howToSteps(text: string, lang: Language): string[] {
  const parts: string[] = [];
  let depth = 0, quote = false, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === "'" && (i === 0 || /[\s(:]/.test(text[i - 1]) || quote)) quote = !quote;
    if (ch === ";" && depth === 0 && !quote) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const stop = primary(lang) === "en" ? "." : "।";
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const s = primary(lang) === "en" ? p[0].toUpperCase() + p.slice(1) : p;
      return /[।.!?)'"”’…]$/.test(s) ? s : s + stop;
    });
}

/** Domain name for a group's kicker line ("पठन प्रवाह"), in the document's primary language. */
export function domainName(domain: string, lang: Language): string {
  if (domain === "GA") return label("generalActivities", lang);
  const d = domains.find((x) => x.domain_id === domain);
  if (!d) return "";
  return primary(lang) === "en" ? d.domain_name_english : d.domain_name_hindi;
}

/** "3 दक्षताएँ · 8 रणनीतियाँ" under the title. */
export function summaryText(counts: { competencies: number; strategies: number; routines: number }, lang: Language): string {
  const en = primary(lang) === "en";
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (counts.competencies) parts.push(en ? n(counts.competencies, "competency", "competencies") : n(counts.competencies, "दक्षता", "दक्षताएँ"));
  if (counts.strategies) parts.push(en ? n(counts.strategies, "strategy", "strategies") : n(counts.strategies, "रणनीति", "रणनीतियाँ"));
  if (counts.routines) parts.push(en ? n(counts.routines, "grouping routine", "grouping routines") : n(counts.routines, "समूह व्यवस्था", "समूह व्यवस्थाएँ"));
  return parts.join("  ·  ");
}

/** Heading name of a selected group, for cross-references printed on the page (names, never codes). */
export function groupName(sel: SelectionGroup[], gid: string, lang: Language): string {
  const g = sel.find((x) => x.id === gid);
  return g ? groupText(g, lang).name : gid;
}

/** "इनमें भी सहायक: चित्र के बारे में …; समृद्ध चर्चा …" under a strategy that serves other selected groups. */
export function alsoText(sel: SelectionGroup[], also: string[], lang: Language): string {
  return also.length ? `${label("also", lang)} ${also.map((g) => groupName(sel, g, lang)).join("; ")}` : "";
}

/** One-line pointer where a strategy is shown in full under an earlier group. */
export function pointerText(sel: SelectionGroup[], itemName: string, toGroup: string, lang: Language): string {
  const where = groupName(sel, toGroup, lang);
  return lang === "en" ? `→ ${itemName} (see “${where}”)` : `→ ${itemName} (“${where}” में देखें)`;
}

/** Label at the top of a column where a group carries on. */
export function continuedText(name: string, lang: Language): string {
  return `${name} (${label("continued", lang)})`;
}
