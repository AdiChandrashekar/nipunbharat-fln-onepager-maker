# Prompt: Competency One-Pager Maker (build in this project)

> **Changes agreed during the build (September 2026).** These override the brief below; `README.md` describes the tool as built.
> - The One-Pager Maker is a **separate app and repository** from the रणनीति कोश. It was built inside the kosh repository (paths below) and moved out; it keeps its own copy of the data in `data/` (`npm run sync-data`) and does not touch the kosh.
> - One-pagers print **no internal codes** (DC5, OL2, CFU …) and **no NIPUN or "R2/R3 की पूर्व-तैयारी" chips**: they are not Sandarshika language. Codes remain in the selector and tray for categorisation; cross-references use competency names.
> - **"संदर्शिका में" (weeks) and "अन्य रूप" (variants)** are in no template; they are opt-in extras per document. Templates were re-balanced to use the space.
> - Images are **one per strategy** (by strategy type); competency cards use their first strategy's image.
> - Tiers each try their own optional fields, then leave them out, before the next tier; compact then shrinks images, then text.
> - Added beyond the brief: drag-box (marquee) multi-select, a right-click menu, and an in-app clipboard.
> - PDF text is searchable in Chrome/Edge (PDFium); copy-paste of Devanagari from Chromium PDFs can include stray spaces (see README, *Known limit*).

## What we're building

A local tool for making **teacher/mentor one-pagers** (which may run to several pages) on how to teach specific competencies. Today my team builds these from scratch each time. The tool should let me:

1. **Select content at two levels**: whole **competencies** (the tool brings in their strategies), and/or **specific strategies** picked one by one. Both come from our existing Grade 2 Hindi data, up to the limits below.
2. **Auto-populate** a document with the selected teaching strategies, text and Teacher Guide (TG) illustrations, **scaled to how much I picked**: a few items get a spacious, large-type layout; many items get a denser one that runs onto more pages.
3. **Choose the page format**: A3, A4, A5, A6, US Letter, US Legal, or a custom size in mm, each in **portrait or landscape**.
4. **Freely edit** every element once populated: move, resize, restyle and rewrite text, swap, crop or delete images, add or remove elements and pages.
5. **Export** to **PNG** and **PDF**.

**Out of scope for this build:** Figma and Canva exports. They come in a follow-up once the main tool works, so don't build them now. The document model must still be designed so they can be added later without restructuring; see "Later: Figma and Canva" at the end.

Work in stages and check in with me at the end of each phase listed at the bottom. Don't build everything in one pass.

---

## What already exists in this project (read before designing anything)

Working directory: `C:\Users\adich\Desktop\Claude Code\TG Compendium\`. Public repo: `AdiChandrashekar/nipunbharat-fln-teachingstrategies`.

| Asset | Use it for |
|---|---|
| `compendium.json` | **The content source.** Stage-3 schema: `taxonomy` (6 domains → 32 competencies, each with Hindi/English names and `nipun_codes`), 94 `strategies` (Hindi and English name, `how_to`, optional `detailed_explanation`, `example`, `materials`, `variants`, `source_refs` like `W3D2`, `frequency_count`, `shared_resource_refs`), 4 `differentiation_routines`, 14 `shared_resources`. `meta.nipun_codes` holds the NIPUN goal text. |
| `web/translations_hi.json` | Hindi for every English-only field (variant notes, resource descriptions, routine `applies_to`). `web/build.py` shows how to merge it. |
| `web/kosh.template.html` | The existing design tokens (the light theme: ink blue `#1F4F9A`, marigold for NIPUN codes, domain colours `--d-OL` … `--d-GA`) and fonts (Tiro Devanagari Hindi, Mukta, IBM Plex Mono). Reuse the **flat light palette and type**, **not** the Liquid Glass effects. Glass and blur don't print and don't survive export to PPTX, Figma or Canva. |
| `stage4_notes.md`, `taxonomy.json` | Background on how the data was built. |
| Source PDF | `C:\Users\adich\Desktop\Hindi TG Grade 2.pdf` (200 pp). **Not in the repo; never commit it or images derived from it without asking me.** Its text layer is a legacy font encoding that comes out garbled. To read or crop it, render pages with PyMuPDF (`pip install pymupdf`). Printed page N = PDF page N+2. |

Rebuild the data pipeline with `python merge.py && python consolidate.py`; don't edit `compendium.json` by hand.

---

## Decisions already made (don't re-ask)

### Two ways to select: competencies and individual strategies
- **Add a competency:** it brings in that competency's heading block (code, name, NIPUN goal) plus its **top 3 strategies by `frequency_count`** (the guide's core methods). I can then tick more of its strategies or untick some.
- **Add a specific strategy:** search or browse all 94 strategies by name, domain, competency, week or keyword, in Hindi or English, and add just that one. The strategy is placed under its competency's heading, which is created automatically. General-activity strategies (warm-up, check-for-understanding games, facilitation practices, etc.) sit under their bucket name instead. The 4 differentiation routines can be added the same way.
- **The selection tray:** show one list of everything selected, grouped by competency. I can reorder items and groups by dragging, and remove anything. The document follows the tray's order.
- **No duplicates:** a strategy that serves several selected competencies appears once, under the first of them, with a small cross-reference ("also OL2") under the others.

### Limits: **8 competency groups and 24 strategies per document**
Both come from what the data looks like:
- **8 competency groups.** The biggest domains (Oral Language, Decoding, Writing) have **7 competencies each**, so 8 fits a whole domain in one handout plus one related competency (e.g. DC1–DC7 + RF2). Groups created by adding a single strategy count towards the 8.
- **24 strategies.** One strategy block (name, how-to of roughly 40–90 words, a small image) takes about a sixth to an eighth of an A4 page at the smallest readable size. So 24 strategies ≈ 3–4 A4 pages, and 24 is also 8 competencies × the default 3. Past that it stops being a one-pager and becomes a booklet.
- Enforce both limits in the selector: disable further picks with a message saying which limit was hit. Make both one config constant each.

### Layout scales with the selection
The document must **size itself to the content**, not use one fixed layout:
- **Density tiers.** Define at least three: *spacious*, *standard* and *compact*. Each sets the type sizes, image size, column count and spacing for the chosen page size and orientation. For example, 1–3 strategies on A4 might get spacious (large headings, big images, one column); 8–12 get standard (two columns); 20–24 get compact (three columns in landscape, smaller images).
- **Fit before overflowing.** Starting from the most spacious tier, pick the first tier that fits the selection on the fewest pages. Add pages only once even the compact tier can't fit. Never go below a minimum readable size, scaled to the page (e.g. body text no smaller than 9 pt on A4 and A5; larger minimums on A3 posters). Measure real rendered text heights when fitting, because Hindi line heights differ from English.
- **Recalculate live.** As I add or remove items, change page size or orientation, or switch language, re-run the fit and show the resulting tier and page count ("Standard · 2 pages, A4 portrait").
- **Let me override.** Controls to force a tier, and to choose "fit to N pages" instead of auto.
- **Manual edits win.** Once I've hand-edited a page, don't silently re-flow over my edits. Warn me and offer "re-flow" or "keep my layout", and only add newly selected items to the end.

### Page formats
- ISO A3, A4, A5 and A6, US Letter, US Legal, and custom sizes (mm), each in portrait or landscape.
- Configurable margins, with an optional bleed setting for print shops.
- Store all geometry in **millimetres** in the document model; convert per exporter.

### Language
- Each document is **Hindi**, **English** or **bilingual** (Hindi primary with English secondary). Hindi is the default.

---

## Architecture I expect (push back if you have a better idea, but justify it)

### 1. One document model is the source of truth
A JSON document that every renderer and exporter reads:

```
document { id, title, language, page: {size, orientation, width_mm, height_mm, margins_mm, bleed_mm},
           selection: [ {kind: competency | strategy | routine, id, strategies?: [strategy_id]} ],  // tray order
           layout: {template, tier: auto | spacious | standard | compact, fit_pages: auto | N, manually_edited},
           theme: {palette, fonts}, pages: [ page ] }
page     { id, elements: [ element ] }
element  { id, type: text | image | shape | line | group, x_mm, y_mm, w_mm, h_mm, rotation, z, locked,
           style: {font_family, font_size_pt, weight, colour, align, line_height, fill, stroke, radius, padding},
           content: {text | image_ref+crop | shape_kind},
           binding?: {competency_id | strategy_id, field} }   // where auto-populated content came from
```

- Auto-population creates elements; after that they're **free-form**.
- The `binding` field records provenance, so I can "refresh from data" on an element or reset it.
- Saving and loading documents means reading and writing this JSON on disk (e.g. `onepager/documents/*.json`).

### 2. Layout templates that populate the model
Give me at least these templates. Each one works with any mix of competencies and individual strategies, fills the chosen page size and orientation, and uses the density tiers above:
- **Competency cards:** one card per competency group: code, name, NIPUN chip, its selected strategies, and an image.
- **Strategy cards:** one card per strategy (name, how-to, image, competency chips). This suits a hand-picked list of strategies from different competencies.
- **Deep-dive:** full detail per strategy: how-to, the "read more" explanation, example, materials, variants, and where it appears (weeks). Best for 1–4 strategies.
- **Strategy table:** competencies or strategies as rows, how-tos as columns. Landscape-friendly.
- **Poster:** A3 or A4 with large type and one hero image per item.

Templates should be data (JSON or TS config), so new ones can be added without touching the editor. Each template defines its layout for every density tier.

### 3. Editor
- A **local web app** in `onepager/`. Suggested stack: Vite, React and TypeScript.
- **Render pages as DOM, not canvas.** Use absolutely positioned elements, sized in mm and scaled for display. Browsers shape Devanagari conjuncts and matras correctly in DOM text, and many canvas and PDF libraries don't.
- Use a move/resize/rotate library (e.g. react-moveable) with snapping and guides.
- Include:
  - a layers panel;
  - a properties panel (font, size, colour, alignment, spacing);
  - inline text editing;
  - undo/redo;
  - duplicate and delete;
  - add a text box, image, shape or new page;
  - zoom;
  - page thumbnails.

### 4. TG image library (a separate, early phase)
The illustrations I want are in the TG PDF. From my earlier read of the guide, the likely sources are:
- **Back-matter method chapters (printed pp.157–183).** Each strategy type has a line illustration: warm-up / classroom climate, SEL, oral games, oral storytelling, poem poster, story poster, picture-story poster, creative activities, experience sharing, letter recognition, matra recognition, blending, word reading, levelled texts, dictation, reading practice, fluency reading, independent reading and remedial (Group A/B).
- **Front matter:** the check-for-understanding infographic (p.8) and the scaffolding/GRR pyramid (p.10).
- **Day pages:** small grids and example boards. These are less useful.

**Treat that list as leads to verify, not facts.**

Build a script that:
- Renders the relevant pages at 300 dpi (PyMuPDF).
- Detects the illustration regions. Try `page.get_images()` for embedded rasters first. The PDF was produced in CorelDRAW, so much of the art may be vector, in which case crop by bounding box from the rendered page.
- Saves each crop to `onepager/assets/tg/`, which is git-ignored.
- Writes an `image_library.json` manifest: `image_id`, source PDF page, printed page, bbox, file, Hindi/English caption, and tags linking the image to `strategy_id`s and `competency_id`s.

**Show me a contact sheet of the crops and the proposed tags before wiring them in.** The mapping is from strategy *type* to image, so several strategies will share one image, and some will have none.

In the editor, each image must be:
- swappable from the library, filtered by the element's competency or strategy;
- replaceable with my own upload;
- croppable and repositionable within its frame;
- resizable;
- deletable.

### 5. Exporters
All exporters read the document model. Hindi text must come out correctly shaped in every format. **Check this with a test string full of conjuncts and matras (e.g. "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग") in every export format**, not just English.

| Format | Approach | Notes |
|---|---|---|
| **PDF** | Headless Chromium (Playwright) printing the page renderer with `@page` set to the exact size in mm | Gives vector text with correct Devanagari shaping and embedded fonts. **Don't use jsPDF or pdfkit for Hindi text**: they don't shape Indic scripts, so conjuncts and matras break. Multi-page. |
| **PNG** | Playwright screenshot of each page at a chosen DPI (150 / 300) | One PNG per page, zipped if more than one. |

**Fidelity target.** PDF and PNG exports should match the editor within about 1 mm in position, with the same fonts, and the PDF text should stay selectable, searchable text (not images).

**Keep the later exporters possible.** Keep each exporter a separate module reading the document model, and don't bake layout into the HTML renderer that the model doesn't record. Every element's position, size, rotation, crop and style must live in the JSON, so a Figma or PowerPoint exporter can rebuild the page from the model alone. Stick to fonts that are Google Fonts (Figma has all of them) and check they're also in Canva's library; Noto Sans Devanagari is the safe fallback.

---

## Content rules for auto-population
- Use the Hindi fields (`*_hindi`, `note_hindi` via `translations_hi.json`) for Hindi documents and the English ones for English. Never mix languages inside one field.
- For each competency block, include:
  - the code, the Hindi and/or English name, and a NIPUN chip with the goal text;
  - for DC1–DC6, "R2/R3 की पूर्व-तैयारी" (preparation for R2/R3) instead of a NIPUN chip;
  - the selected strategies' names and `how_to` text;
  - optionally `detailed_explanation`, `example`, `materials`, variants and "appears in weeks …" (grouped by week: `स.3 · दि. 2, 4` in Hindi, `W3 · D2, 4` in English).
- Strategies used by several selected competencies should appear once, with a cross-reference, not be duplicated.
- A competency heading created only because I added one of its strategies gets the same heading block (code, name, NIPUN chip) as a fully selected competency. It shows only the strategies I picked, not its top 3.
- At the compact tier, the optional fields (explanation, example, materials, variants, weeks) drop out first, then image sizes shrink, before the core name and how-to text get smaller. Show me which fields were dropped, so I can switch them back on and let it take another page.
- Footer: source credit to the UP Grade 2 Hindi *Sandarshika* 2026-27, plus an editable field for organisation, author and date.
- Header: editable title, an optional logo upload, and an optional subtitle.

---

## Phases (stop and show me after each)

0. **Plan and questions.** Confirm the stack and repo layout. Ask me anything you genuinely need, e.g. branding assets, favourite existing one-pager examples to match, and whether images should be one per competency or one per strategy.
1. **TG image library.** Extraction script, contact sheet and proposed tag mapping. Wait for my approval.
2. **Document model, page sizes and renderer.** Render a hand-written sample document at A4 portrait, A4 landscape and A5 so I can check that sizes and Devanagari rendering are right.
3. **Selector, templates and auto-population:**
   - selecting whole competencies and individual strategies;
   - the selection tray with drag-reorder;
   - the 8-group and 24-strategy limits;
   - density tiers and fit-before-overflow, with the live "tier · page count" readout;
   - tier and fit-to-N-pages overrides;
   - language modes.

   Show me the same template at 2, 8 and 24 strategies, on A4 portrait and A4 landscape, so I can judge the scaling.
4. **Editor interactions:** move, resize, text editing, image swap and crop, layers, undo, save/load.
5. **PDF and PNG export**, with the Devanagari test.
6. **Polish:** a README section, a `launch.json` entry so it opens in the preview pane, and an update to the repo README. Git-ignore TG crops unless I say otherwise.

## Working style
- Build with the real data from `compendium.json`, never lorem ipsum.
- Keep the data pipeline read-only from this tool. If content needs changing, tell me and we'll change the pipeline.
- Commit per phase on a feature branch, not `main`, with clear messages. Don't push or open PRs unless I ask.
- If an export format can't meet the brief, say so plainly and propose the closest workable option. Don't quietly ship something less.

---

## Later: Figma and Canva (don't build now; kept here so the design allows for them)

Once the main tool is working, a follow-up will add:
- **Figma, fully editable.** Figma has no file format a tool can write, so the document gets rebuilt as native Figma layers: a frame per page, real text layers, image fills and shapes. The reliable route is a small Figma plugin that imports our exported JSON. A second route is the Figma MCP connector in this environment, once I authorise it.
- **Canva, editable.** Canva has no writable file format either, but it imports PowerPoint files as editable designs. So the tool will export a .pptx with every element as its own shape, text box or picture at its exact position, one slide per page sized to the page, which gets imported into Canva. The Canva MCP connector can be tried too once authorised.
- **SVG per page**, as a quick drag-and-drop option.

Nothing in this build needs to implement these. It only needs to keep the document model complete enough, as described under Exporters, that they can be added without restructuring.
