// Export check: builds test documents, exports PDF + PNG through the app's /api/export, writes them to <outdir>
// with the document JSON beside each, for scripts/verify_exports.py. Dev server must be running on :5178.
import { chromium } from "playwright";
import fs from "node:fs";

const out = process.argv[2] ?? "export-test-out";
fs.mkdirSync(out, { recursive: true });
const ORIGIN = "http://localhost:5178";
// Fail fast with a clear message when the dev server isn't up.
try { await fetch("http://localhost:5178/"); } catch { console.error("The dev server isn't running on :5178. Start it first: npm run dev"); process.exit(2); }
const TEST = "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग";

// ---- 1. Devanagari test document: the hand-written sample plus harder cases.
const sample = JSON.parse(fs.readFileSync("documents/sample-a4-portrait.json", "utf-8"));
const els = sample.pages[0].elements;
const zTop = Math.max(...els.map((e) => e.z));
const base = { rotation: 0, locked: false };
els.push(
  { ...base, id: "t-bold", name: "bold test", type: "text", x_mm: 15.5, y_mm: 262, w_mm: 120, h_mm: 8, z: zTop + 1,
    style: { font_family: "Mukta", font_size_pt: 13, weight: 700, colour: "#1F4F9A", line_height: 1.3 }, content: { text: TEST } },
  { ...base, id: "t-rot", name: "rotated test", type: "text", x_mm: 140, y_mm: 250, w_mm: 55, h_mm: 8, rotation: -8, z: zTop + 2,
    style: { font_family: "Tiro Devanagari Hindi", font_size_pt: 11, colour: "#A03A6E", line_height: 1.3, fill: "#F4E3EC", padding_mm: 1 }, content: { text: "स्त्रीलिंग · श्रुतलेख" } },
  { ...base, id: "t-just", name: "justified", type: "text", x_mm: 15.5, y_mm: 271, w_mm: 179, h_mm: 10, z: zTop + 3,
    style: { font_family: "Noto Sans Devanagari", font_size_pt: 8.5, align: "justify", colour: "#15202C", line_height: 1.35 },
    content: { text: `${TEST} — ${TEST} — ${TEST} — ${TEST} — ${TEST}` } },
);
// Crop the first image to its middle half, so crop fidelity is visible in the exports.
const img = els.find((e) => e.type === "image");
img.content.crop = { x: 0.25, y: 0.2, w: 0.5, h: 0.6 };
sample.id = "export-test-devanagari";
const docs = [{ name: "devanagari-a4", doc: sample }];

// ---- 2–4. Template documents built by the real app (auto-population measures text in a browser).
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
async function build(comps, patch) {
  await page.goto(ORIGIN + "/");
  await page.waitForSelector(".selector .pick");
  if (patch.orientation === "landscape") await page.getByRole("button", { name: "Landscape" }).click();
  if (patch.size) await page.locator(".toolbar label", { hasText: /^Page(?!s)/ }).locator("select").selectOption(patch.size);
  if (patch.bleed) await page.locator(".toolbar label", { hasText: "Bleed" }).locator("input").fill(String(patch.bleed));
  for (const c of comps) await page.locator(".selector .pick", { has: page.locator(".code", { hasText: new RegExp(`^${c}$`) }) }).locator("button").click();
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__onepager.get());
}
docs.push({ name: "cards-8-a4", doc: { ...(await build(["RF1", "RF2", "RF3"], {})), id: "export-test-cards-8" } });
docs.push({ name: "cards-24-a4-land", doc: { ...(await build(["OL1", "OL2", "OL3", "OL4", "OL5", "OL6", "OL7", "SE2"], { orientation: "landscape" })), id: "export-test-cards-24" } });
docs.push({ name: "a5-bleed", doc: { ...(await build(["DC5", "DC6"], { size: "A5", bleed: 3 })), id: "export-test-a5-bleed" } });
await browser.close();

// ---- export each document through the app's endpoint
for (const { name, doc } of docs) {
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(doc));
  const variants = [
    ["pdf", "format=pdf", "pdf"],
    ["png150", "format=png&dpi=150", null],
    ["png300", "format=png&dpi=300", null],
  ];
  if (name === "a5-bleed") variants.push(["pdf-bleed", "format=pdf&bleed=1", "pdf"], ["png150-bleed", "format=png&dpi=150&bleed=1", null]);
  for (const [tag, q] of variants) {
    const t0 = Date.now();
    const res = await fetch(`${ORIGIN}/api/export?${q}`, { method: "POST", body: JSON.stringify(doc) });
    if (!res.ok) { console.log(`FAIL ${name} ${tag}: ${res.status} ${await res.text()}`); continue; }
    const type = res.headers.get("content-type");
    const ext = type.includes("pdf") ? "pdf" : type.includes("zip") ? "zip" : "png";
    fs.writeFileSync(`${out}/${name}.${tag}.${ext}`, Buffer.from(await res.arrayBuffer()));
    console.log(`ok   ${name}.${tag}.${ext}  ${((Date.now() - t0) / 1000).toFixed(1)} s  (${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""})`);
  }
}
