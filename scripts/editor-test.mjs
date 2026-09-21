// End-to-end editor check with real mouse/keyboard input (installed Chrome via Playwright).
// Usage: node scripts/editor-test.mjs <screenshot dir>   (dev server must be running on :5178)
import { chromium } from "playwright";
import fs from "node:fs";

const out = process.argv[2] ?? "editor-test-out";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const results = [];
page.on("dialog", (dlg) => dlg.accept());
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const doc = () => page.evaluate(() => window.__onepager.get());
const el = async (id) => (await doc()).pages.flatMap((p) => p.elements).find((e) => e.id === id);
const PX = 96 / 25.4;
const uploadsBefore = new Set(fs.existsSync("documents/uploads") ? fs.readdirSync("documents/uploads") : []);

await page.goto("http://localhost:5178/");
await page.waitForSelector(".selector .pick");
const addComp = async (code) => page.locator(".selector .pick", { has: page.locator(".code", { hasText: new RegExp(`^${code}$`) }) }).locator("button").click();
await addComp("DC5");
await addComp("DC6");
await page.waitForSelector(".canvas-edit .page [data-top]");
await page.waitForTimeout(400);
let d = await doc();
check("auto-populated pages", d.pages.length >= 1 && d.pages[0].elements.length > 10, `${d.pages.length} page(s), ${d.pages[0].elements.length} elements`);

// Distances below are in screen px at the default zoom; checks use generous thresholds.

// --- one-pagers carry no internal codes (DC5, OL2 …) or NIPUN / preparation chips
const pageText = (await doc()).pages.flatMap((p) => p.elements).filter((e) => e.type === "text").map((e) => e.content.text).join("\n");
check("no competency codes on the page", !/\b(OL|SE|DC|RF|RC|WR)\d\b|\bCFU\b|\bDR\d?\b/.test(pageText));
check("no NIPUN / preparation chips on the page", !/निपुण\s+[A-Z]+\d|NIPUN\s+[A-Z]+\d|पूर्व-तैयारी/.test(pageText));

// --- "संदर्शिका में" (weeks) and "अन्य रूप" (variants) are opt-in extras, off in every template by default
{
  const labels = () => doc().then((x) => x.pages.flatMap((p) => p.elements).filter((e) => e.type === "text").map((e) => e.content.text));
  const has = (arr, t) => arr.some((s) => s === t);
  let texts = await labels();
  check("weeks / variants absent by default", !has(texts, "संदर्शिका में") && !has(texts, "अन्य रूप"));
  const chips = await page.locator(".fieldbar .chip.extra").allInnerTexts();
  check("offered as optional extras", chips.some((c) => c.includes("संदर्शिका में")) && chips.some((c) => c.includes("अन्य रूप")), chips.join(" | "));
  await page.locator(".fieldbar .chip.extra", { hasText: "संदर्शिका में" }).click();
  await page.waitForTimeout(400);
  texts = await labels();
  check("switching an extra on adds it", has(texts, "संदर्शिका में"));
  await page.locator(".fieldbar .chip.on", { hasText: "संदर्शिका में" }).click();
  await page.waitForTimeout(400);
  check("switching it off removes it again", !has(await labels(), "संदर्शिका में"));
  d = await doc(); // toggling re-flowed the page: element ids are new
}

// --- marquee: drag from the empty left margin around the first card
{
  const first = (await doc()).pages[0].elements.find((e) => e.name === "card");
  const trim = await page.locator(".canvas-edit .page .trim").first().boundingBox();
  const k = trim.width / (await doc()).page.width_mm; // screen px per mm
  await page.mouse.move(trim.x + 3 * k, trim.y + (first.y_mm - 1.5) * k);
  await page.mouse.down();
  await page.mouse.move(trim.x + 100 * k, trim.y + (first.y_mm + 20) * k, { steps: 5 });
  await page.mouse.move(trim.x + (first.x_mm + first.w_mm + 1.5) * k, trim.y + (first.y_mm + first.h_mm + 1.5) * k, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const head = await page.locator(".props-head").innerText().catch(() => "");
  const n = parseInt(head);
  check("marquee selects everything inside the box", n > 3 && head.includes("elements"), head.replace(/\s+/g, " "));
  await page.keyboard.press("Escape");
}

// --- right-click menu on an element: copy, then paste at an empty spot; lock
{
  const target = (await doc()).pages[0].elements.find((e) => e.binding?.field === "name" && e.binding.strategy_id);
  const loc = page.locator(`.canvas-edit [data-top][data-el="${target.id}"]`);
  await loc.click({ button: "right", force: true });
  await page.waitForSelector(".ctx-menu");
  const items = await page.locator(".ctx-menu button").allInnerTexts();
  check("context menu on element", ["Edit text", "Copy", "Bring to front", "Lock", "Refresh from data"].every((l) => items.some((t) => t.startsWith(l))), items.length + " items");
  await page.locator(".ctx-menu button", { hasText: /^Copy/ }).click();
  const trim = await page.locator(".canvas-edit .page .trim").first().boundingBox();
  const k = trim.width / (await doc()).page.width_mm;
  const before = (await doc()).pages[0].elements.length;
  await page.mouse.click(trim.x + 3 * k, trim.y + 250 * k, { button: "right" }); // left margin, empty
  await page.waitForSelector(".ctx-menu");
  const empty = await page.locator(".ctx-menu button").allInnerTexts();
  check("context menu on empty space", empty.some((t) => t.startsWith("Paste here")) && empty.some((t) => t.startsWith("Add text here")));
  await page.locator(".ctx-menu button", { hasText: /^Paste here/ }).click();
  await page.waitForTimeout(150);
  const after = (await doc()).pages[0].elements;
  const pasted = after.at(-1);
  check("paste here places the copy at the pointer", after.length === before + 1 && pasted.content.text === target.content.text && Math.abs(pasted.x_mm - 3) < 1 && Math.abs(pasted.y_mm - 250) < 1, `(${pasted.x_mm}, ${pasted.y_mm})`);
  await page.locator(`.canvas-edit [data-top][data-el="${pasted.id}"]`).click({ button: "right", force: true });
  await page.locator(".ctx-menu button", { hasText: /^Lock/ }).click();
  check("lock from context menu", (await el(pasted.id)).locked === true);
  await page.mouse.click(trim.x + 3 * k, trim.y + 150 * k, { button: "right" });
  await page.locator(".ctx-menu button", { hasText: /^Add text here/ }).click();
  await page.waitForSelector(".editing-text");
  await page.keyboard.press("Escape");
  const added = (await doc()).pages[0].elements.at(-1);
  check("add text here", added.type === "text" && Math.abs(added.y_mm - 150) < 1);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z"); // back to the auto layout for the checks below
  await page.waitForTimeout(200);
}

// --- select + drag a strategy name
const nameEl = d.pages[0].elements.find((e) => e.binding?.field === "how_to");
const node = page.locator(`.canvas-edit [data-top][data-el="${nameEl.id}"]`);
await node.scrollIntoViewIfNeeded();
let box = await node.boundingBox();
await page.mouse.move(box.x + 20, box.y + 8);
await page.mouse.down();
await page.mouse.move(box.x + 20 + 30 * PX / 3, box.y + 8 + 5, { steps: 4 });
await page.mouse.move(box.x + 20 + 20 * PX, box.y + 8 + 10 * PX, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(250);
let moved = await el(nameEl.id);
check("drag moves element", Math.abs(moved.x_mm - nameEl.x_mm) > 5 && Math.abs(moved.y_mm - nameEl.y_mm) > 5, `(${nameEl.x_mm},${nameEl.y_mm}) → (${moved.x_mm},${moved.y_mm})`);
check("edit marks layout hand-edited", (await doc()).layout.manually_edited === true);
check("properties panel shows selection", await page.locator(".props-head").isVisible());
await page.screenshot({ path: `${out}/1-selected.png` });

// --- resize via the south-east handle
const se = page.locator(".moveable-control.moveable-se").first();
const sb = await se.boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + 15 * PX, sb.y + 12 * PX, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const resized = await el(nameEl.id);
check("resize changes w/h", resized.w_mm > moved.w_mm + 5 && resized.h_mm > moved.h_mm + 5, `${moved.w_mm}×${moved.h_mm} → ${resized.w_mm}×${resized.h_mm}`);

// --- rotate via the rotation handle
const rot = page.locator(".moveable-rotation-control").first();
const rb = await rot.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
await page.mouse.move(rb.x + 120, rb.y + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const rotated = await el(nameEl.id);
check("rotate sets rotation", rotated.rotation > 5, `${rotated.rotation}°`);

// --- undo x3 restores original geometry, redo re-applies
await page.keyboard.press("Escape");
for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const undone = await el(nameEl.id);
check("undo restores position/size/rotation", undone.x_mm === nameEl.x_mm && undone.w_mm === nameEl.w_mm && undone.rotation === 0);
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(200);
check("redo re-applies", (await el(nameEl.id)).x_mm === moved.x_mm);

// --- inline text editing (Hindi)
const title = (await doc()).pages[0].elements.find((e) => e.binding?.field === "name" && e.binding.strategy_id);
const tnode = page.locator(`.canvas-edit [data-top][data-el="${title.id}"]`);
await tnode.scrollIntoViewIfNeeded();
await tnode.dblclick();
await page.waitForSelector(".editing-text");
await page.keyboard.press("Control+a");
await page.keyboard.type("क्षत्रिय प्रवाहपूर्ण श्रुतलेख");
await page.mouse.click(5, 500); // click outside the pages to commit
await page.waitForTimeout(250);
const edited = await el(title.id);
check("inline text edit commits", edited.content.text === "क्षत्रिय प्रवाहपूर्ण श्रुतलेख", JSON.stringify(edited.content.text));
await page.screenshot({ path: `${out}/2-text-edited.png` });

// --- refresh from data restores the bound text
await tnode.click({ force: true });
await page.getByRole("button", { name: /Refresh from data|Reset to data/ }).click();
await page.waitForTimeout(200);
check("refresh from data restores text", (await el(title.id)).content.text === title.content.text);

// --- image: swap from library, crop by wheel, delete
const img = (await doc()).pages[0].elements.find((e) => e.type === "image");
const inode = page.locator(`.canvas-edit [data-top][data-el="${img.id}"]`);
await inode.scrollIntoViewIfNeeded();
await inode.click({ force: true });
await page.getByRole("button", { name: "Swap / upload…" }).click();
await page.waitForSelector(".lib-item");
const suggested = await page.locator(".lib-item").count();
await page.locator(".modal .seg button", { hasText: "All TG images" }).click();
await page.locator(".lib-item").nth(5).click();
await page.waitForTimeout(200);
const swapped = await el(img.id);
check("image swap from library", swapped.content.image_ref !== img.content.image_ref, `${img.content.image_ref} → ${swapped.content.image_ref} (suggested ${suggested})`);
await inode.dblclick({ force: true });
await page.waitForSelector(".crop-live");
const cb = await page.locator(".crop-live").boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
await page.mouse.down();
await page.mouse.move(cb.x + cb.width / 2 - 40, cb.y + cb.height / 2 - 20, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
const cropped = await el(img.id);
check("crop zoom + pan", cropped.content.crop.w < 0.9 && cropped.content.crop.x > 0, JSON.stringify(cropped.content.crop));
await page.screenshot({ path: `${out}/3-crop.png` });
await page.keyboard.press("Escape");

// --- upload own image
fs.writeFileSync(`${out}/upload.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#FBE9C2"/><text x="40" y="160" font-size="48">Upload test</text></svg>`);
await page.locator(".insert-bar button", { hasText: "+ Image" }).click();
await page.waitForSelector(".modal");
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload my own…" }).click()]);
await chooser.setFiles(`${out}/upload.svg`);
await page.waitForTimeout(800);
const up = (await doc()).pages.flatMap((p) => p.elements).find((e) => e.type === "image" && e.content.image_ref.startsWith("upload:"));
check("upload inserts image", !!up && up.content.natural_px[0] === 400, up?.content.image_ref);

// --- add text / shape / page; layers hide; delete; duplicate
await page.locator(".insert-bar button", { hasText: "+ Rectangle" }).click();
const nEls = (await doc()).pages.flatMap((p) => p.elements).length;
await page.keyboard.press("Control+d");
check("duplicate", (await doc()).pages.flatMap((p) => p.elements).length === nEls + 1);
await page.keyboard.press("Delete");
check("delete", (await doc()).pages.flatMap((p) => p.elements).length === nEls);
await page.locator(".insert-bar button", { hasText: "+ Text" }).click();
await page.waitForSelector(".editing-text");
await page.keyboard.type(" — मेरा नोट");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const texts = (await doc()).pages.flatMap((p) => p.elements).filter((e) => e.type === "text" && e.content.text.includes("मेरा नोट"));
check("add text box + type", texts.length === 1, texts[0]?.content.text);
await page.locator(".panel.left .tabs button", { hasText: "Layers" }).click();
await page.locator(".layers li").first().locator("button[title=Hide]").click();
check("layers hide toggles", (await doc()).pages[0].elements.some((e) => e.hidden));
await page.locator(".panel.left .tabs button", { hasText: "Pages" }).click();
const pagesBefore = (await doc()).pages.length;
await page.locator(".pages-panel button", { hasText: "+ Blank page" }).click();
check("add page", (await doc()).pages.length === pagesBefore + 1);
await page.screenshot({ path: `${out}/4-panels.png` });

// --- multi-select (shift), align, group / ungroup
await page.locator(".insert-bar button", { hasText: "+ Ellipse" }).click();
const e1 = (await doc()).pages.flatMap((p) => p.elements).at(-1).id;
await page.locator(".insert-bar button", { hasText: "+ Rectangle" }).click();
const e2 = (await doc()).pages.flatMap((p) => p.elements).at(-1).id;
for (let i = 0; i < 7; i++) { await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowDown"); } // move e2 clear of e1
await page.locator(`.canvas-edit [data-top][data-el="${e1}"]`).click({ force: true, modifiers: ["Shift"] });
await page.getByRole("button", { name: "Align left" }).click();
check("shift multi-select + align left", (await el(e1)).x_mm === (await el(e2)).x_mm);
await page.keyboard.press("Control+g");
await page.waitForTimeout(150);
const grp = (await doc()).pages.flatMap((p) => p.elements).find((e) => e.type === "group");
check("group", !!grp && grp.content.children.length === 2);
await page.keyboard.press("Control+Shift+g");
await page.waitForTimeout(150);
check("ungroup", !(await doc()).pages.flatMap((p) => p.elements).some((e) => e.type === "group") && !!(await el(e1)));

// --- header logo upload (re-lays out an unedited doc; on an edited doc it goes through the re-flow guard)
const [logoChooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".file-btn").click()]);
await logoChooser.setFiles(`${out}/upload.svg`);
await page.waitForTimeout(600);
check("logo upload stored on the document", ((await doc()).meta.logo_ref ?? "").startsWith("upload:"));
const logoRef = (await doc()).meta.logo_ref;
if (await page.locator(".banner").isVisible()) await page.getByRole("button", { name: "Re-flow" }).click();
await page.waitForTimeout(400);
check("logo placed in header", (await doc()).pages[0].elements.some((e) => e.binding?.field === "logo" && e.content.image_ref === logoRef));
await page.keyboard.press("Control+z"); // back to the hand-edited layout for the next checks
await page.waitForTimeout(300);

// --- manual edits win: adding a competency asks before re-flowing
await page.locator(".panel.left .tabs button", { hasText: "Content" }).click();
await addComp("DC7");
await page.waitForSelector(".banner");
check("re-flow guard banner appears", await page.locator(".banner").isVisible());
const pagesEdited = (await doc()).pages.length;
await page.getByRole("button", { name: "Keep my layout" }).click();
await page.waitForTimeout(300);
d = await doc();
const dc7 = d.pages.slice(pagesEdited).flatMap((p) => p.elements).some((e) => e.binding?.competency_id === "DC7");
check("keep layout appends only new items", d.pages.length > pagesEdited && dc7 && d.pages[0].elements.some((e) => e.id === nameEl.id), `${pagesEdited} → ${d.pages.length} pages`);

// --- title edit patches in place without re-flow
await page.locator(".title-input").fill("ब्लेंडिंग एवं शब्द पठन");
await page.waitForTimeout(300);
d = await doc();
check("title change patches hand-edited layout in place", d.pages[0].elements.some((e) => e.binding?.field === "title" && e.content.text === "ब्लेंडिंग एवं शब्द पठन") && !(await page.locator(".banner").isVisible()));

// --- save and reopen
await page.keyboard.press("Control+s");
await page.waitForTimeout(400);
const saved = await doc();
const file = `documents/${saved.id}.json`;
check("save writes documents/<id>.json", fs.existsSync(file), file);
await page.reload();
await page.waitForSelector(".file-actions");
await page.getByRole("button", { name: "Open…" }).click();
await page.locator(".open-list button", { hasText: "ब्लेंडिंग एवं शब्द पठन" }).first().click();
await page.waitForTimeout(500);
const reopened = await doc();
check("reopen restores document without re-flow", reopened.pages.length === saved.pages.length && JSON.stringify(reopened.pages) === JSON.stringify(saved.pages), `${reopened.pages.length} pages`);
await page.screenshot({ path: `${out}/5-reopened.png` });

// --- export from the toolbar: PDF and PNG downloads (the exporters themselves: scripts/export-test.mjs)
for (const [item, ext] of [[/^PDF/, ".pdf"], [/^PNG · 150 dpi/, reopened.pages.length > 1 ? ".zip" : ".png"]]) {
  await page.getByRole("button", { name: "Export ▾" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(".export-pop button", { hasText: item }).click()]);
  const p = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(p);
  check(`export ${ext} from the toolbar`, dl.suggestedFilename().endsWith(ext) && fs.statSync(p).size > 20000, `${dl.suggestedFilename()} ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
  const exported = `exports/${dl.suggestedFilename()}`;
  if (fs.existsSync(exported)) fs.unlinkSync(exported);
}
fs.unlinkSync(file);
// Remove every upload this run created.
for (const f of fs.readdirSync("documents/uploads")) if (!uploadsBefore.has(f)) fs.unlinkSync(`documents/uploads/${f}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
