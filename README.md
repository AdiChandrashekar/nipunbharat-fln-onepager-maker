# One-Pager Maker

A local tool for making teacher and mentor one-pagers (which may run to a few pages) on how to teach
specific competencies, from the Grade 2 Hindi *Sandarshika* strategy compendium.

It is a separate app from the **रणनीति कोश** (the published strategy web page,
[AdiChandrashekar/nipunbharat-fln-teachingstrategies](https://github.com/AdiChandrashekar/nipunbharat-fln-teachingstrategies)).
It keeps its own copy of the kosh's strategy data in `data/` and never reads or writes the kosh folder
while it runs.
Pick competencies or single strategies; the document lays itself out with the guide's text and
illustrations, sized to how much you picked; then edit anything by hand and export PDF or PNG.

Everything runs on your computer. Nothing is uploaded anywhere.

## Web version

**Open it:** https://adichandrashekar.github.io/nipunbharat-fln-onepager-maker/

GitHub Pages serves the `docs/` folder, a build of the same app that needs no server. It differs from
the local tool in these ways:

| | Local (`npm run dev`) | Web version |
|---|---|---|
| Save / Open | `documents/` on disk | This browser's storage; **Download** saves a `.json` file, and **Open… → Open a .json file** loads one |
| Your images | `documents/uploads/` | Embedded in the document (up to 3 MB each) |
| TG illustrations | Yes, once cropped | Yes: the build copies the 34 crops into `docs/tg/` (you need them in `assets/tg/`, see below) |
| PDF export | One click, headless Chromium | Opens the print dialog; choose **Save as PDF**. Chrome or Edge give the same result as the local tool |
| PNG export | Headless Chromium | Drawn in the browser, at the same exact pixel sizes |

To update the web version after changing the code, rebuild it and commit `docs/`. The build needs the TG crops
in `assets/tg/` (`npm run images`) and stops if any is missing:

```bash
npm run build:pages
npm run preview:pages      # optional: check it at http://localhost:5179
```

## Setting up (once)

You need **Node.js 18+** and **Python 3.9+**.

```bash
npm install
npx playwright install chromium     # headless browser for export (~150 MB); without it, export uses your installed Chrome
pip install pymupdf pillow          # for the TG illustration crops
```

**TG illustrations.** The pictures come from the source teacher guide, which is not in this repository.
Crop them once from your copy of the PDF (they land in `assets/tg/`, which git ignores):

```bash
npm run images                                   # uses the default path, or:
python scripts/tg_images.py --pdf "D:/path/Hindi TG Grade 2.pdf"
```

Without this step the tool still works; image frames just show nothing until the crops exist.

**Strategy data.** `data/compendium.json` and `data/translations_hi.json` are copies of the रणनीति कोश
pipeline output. When the kosh's data changes (after `python merge.py && python consolidate.py` there),
refresh the copies — this only reads from the kosh folder:

```bash
npm run sync-data                                   # expects the kosh at ../TG Compendium, or:
python scripts/sync_data.py --kosh "D:/path/TG Compendium"
```

## Running

```bash
npm run dev
```

Open http://localhost:5178. In Claude Code, the **onepager** entry in `.claude/launch.json` opens it in the
preview pane.

## Making a one-pager

1. **Pick content** (left panel, *Content*).
   - *Competencies*: adding one brings in its heading and its **top 3 strategies** by use in the guide.
     In the tray you can tick more of its strategies or remove some.
   - *Strategies*: search in Hindi or English, or filter by domain, competency, general-activity bucket
     or week. A strategy goes under its competency's heading, created automatically if needed;
     general activities (warm-up, check for understanding …) go under their bucket name.
   - *Routines*: the four differentiation (Group A / B) routines, under their own heading.
2. **Arrange** in the *Selection tray* (right panel): drag groups and strategies to reorder; the document
   follows. A strategy that serves several selected competencies is printed once, with a
   "इनमें भी सहायक: …" note, and a one-line pointer under the other headings.
3. **Set the page** (toolbar): template, page size (A3, A4, A5, A6, US Letter, US Legal or custom mm),
   portrait / landscape, margins, bleed, and language (हिंदी, English, or द्विभाषी = Hindi with English).
4. **Title and footer**: title, subtitle, organisation, author, date, optional logo. The footer always
   credits the *Sandarshika* 2026-27.
5. **Edit by hand** on the page (see *Editing*), then **Save** and **Export**.

### Limits

At most **8 competency groups** and **24 strategies** per document (routines count as strategies;
a strategy shared by two groups counts once). When a limit is reached, further picks are disabled with a
message saying which one. Both numbers are constants in `src/config.ts`.

### What the pages show — and don't

- Headings are the competency / activity **names**. Internal codes (DC5, OL2, CFU …) and NIPUN
  goal chips are used only for categorising inside the tool; they are not Sandarshika language, so they
  never appear on a one-pager.
- Each strategy shows its name and how-to, and, when there is room, the read-more explanation, the
  classroom example and the materials. English documents use the English fields; Hindi documents
  the Hindi ones.
- **Optional extras** — *संदर्शिका में* (where it appears in the guide, by week and day) and *अन्य रूप*
  (variants) — are in no template. Switch them on for a document from the chips above the page.

### How the layout scales

Every template has three density tiers — **Spacious**, **Standard**, **Compact** — each with its own type
sizes, image size and column count, scaled to the page size. The fitter tries them from most spacious
to most compact and keeps the first that needs the fewest pages: within a tier it first leaves out the
optional fields; in Compact it then shrinks images, and only then takes text to the minimum readable size
(9 pt body on A4/A5, 12 pt on A3). Text is measured as actually rendered, so Hindi line heights are exact.

The toolbar readout shows the result, e.g. *Standard · 2 pages, A4 portrait*. Fields left out to fit
appear as chips you can click to switch back on (the document may grow a page). You can also force a tier
or choose *Fit to N pages*.

### Templates

| Template | One card per | Best for |
|---|---|---|
| Competency cards · दक्षता कार्ड | competency group, with one TG illustration | whole competencies or a domain |
| Strategy cards · रणनीति कार्ड | strategy, with its illustration | a hand-picked mix of strategies |
| Deep-dive · विस्तृत विवरण | strategy, full detail | 1–4 strategies |
| Strategy table · रणनीति तालिका | row per strategy | comparing many; landscape |
| Poster · पोस्टर | strategy, large type and hero image | walls; A3 or A4, a few strategies |

Templates are data (`src/templates/index.ts`); a new one is another entry there.

## Editing

Once populated, every element is free-form.

| Do this | How |
|---|---|
| Select | click; **shift-click** to add; **drag a box** on empty page space to select everything inside it |
| Move / resize / rotate | drag; handles; top handle rotates (snaps to 0/90/180/270°). Elements snap to margins, page centre and each other |
| Nudge | arrow keys (0.5 mm), with Shift 5 mm |
| Edit text | double-click or Enter; Esc or click away to finish |
| Style | *Properties* panel: font, size, weight, line height, spacing, padding, alignment, colours, fill, stroke, radius, opacity |
| Images | *Swap / upload…* (library filtered to the strategy's images first, or your own file); double-click to crop — drag to reposition, scroll to zoom; *Fill frame* / *Fit inside* |
| Everything else | **right-click**: edit, crop, swap, refresh from data, cut / copy / paste / duplicate / delete, bring forward / send back, group, align, lock, hide; on empty space: paste here, add text / image / shape / line here, page operations |
| Layers, pages | left panel *Layers* (restack by drag, hide, lock) and *Pages* (thumbnails; add, duplicate, delete, reorder) |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) |
| Shortcuts | Ctrl+C / X / V, Ctrl+D duplicate, Ctrl+A select all on the page, Ctrl+G / Ctrl+Shift+G group / ungroup, Delete, Ctrl+S save |

Auto-filled elements remember where they came from (*From data* in Properties); **Refresh from data**
restores the text or image from the compendium.

**Your edits win.** After you edit a page by hand, changing the selection or page settings asks first:
*Re-flow* rebuilds from the data (undo brings your edits back), *Keep my layout* leaves your pages alone
and lays out only the newly added items on pages at the end. Title and footer changes update in place.

## Saving and exporting

- **Save** (Ctrl+S) writes `documents/<id>.json`; **Open…** lists saved documents. Documents and uploaded
  images (`documents/uploads/`) stay on your computer; git ignores them except the three samples.
- **Export ▾**: **PDF** (vector text with embedded fonts, one PDF page per page, exact page size),
  **PNG 150 dpi** or **300 dpi** (A4 at 300 dpi = 2480 × 3508 px; several pages download as a zip), and
  *Include bleed* when a bleed is set. A copy of each export is kept in `exports/` (git-ignored).

Export prints the same page renderer the editor uses in headless Chromium, so Devanagari is shaped exactly
as on screen; text position matches the editor within 0.2 mm.

**Known limit.** PDF text is real, selectable text, and searching it works in Chrome and Edge (and other
PDFium-based viewers). *Copying* Hindi out of the PDF can bring stray spaces or a doubled syllable, and
MuPDF-based readers double some vowel signs; this comes from Chromium's PDF writer, not the document.

## Checks

With `npm run dev` running:

```bash
npm run typecheck
npm run test:editor    # 42 end-to-end editor checks with real mouse and keyboard input
npm run test:export    # exports test documents as PDF + PNG and verifies size, fonts, search, position, Devanagari crops
```

`test:export` needs `pip install pypdfium2 numpy`. Outputs go to `test-output/` (git-ignored).

## How it is built

| Path | What it is |
|---|---|
| `src/model/` | The **document model** — the single source of truth: pages of `text`, `image`, `shape`, `line`, `group` elements, all geometry in millimetres, fonts in points, concrete colours, image crops as fractions of the source, and a `binding` recording where auto-filled content came from |
| `data/` | Copies of the kosh's `compendium.json` and `translations_hi.json` (`npm run sync-data`), and the TG image index `image_library.json` |
| `src/data/compendium.ts` | Read-only view of `data/` |
| `src/selection/` | Tray groups, limits, de-duplication |
| `src/content/fields.ts` | Language rules for every printed field |
| `src/templates/` | The five templates and their tiers (data) |
| `src/layout/` | Text measurement, the layout engine, and the tier fitter |
| `src/render/` | DOM page renderer, shared by editor, thumbnails and export |
| `src/editor/`, `src/ui/` | Editor (react-moveable, react-selecto), panels, tray, selector |
| `server/plugin.ts` | Vite dev-server middleware: documents, uploads, export endpoints |
| `server/exporters/` | One module per format (`pdf.ts`, `png.ts`) reading only the document model |
| `scripts/tg_images.py`, `scripts/tg_image_sources.json` | TG illustration crops and their strategy / competency tags |

The data is never edited here. To change content, change the रणनीति कोश pipeline (`merge.py`,
`consolidate.py` in that repository), rebuild it, then `npm run sync-data`.

**Later: Figma and Canva.** Because every element's position, size, rotation, crop and style is in the
JSON, a Figma plugin (frames, text layers, image fills) or a PPTX exporter for Canva can rebuild pages
from the model alone, as another module in `server/exporters/`. All fonts are Google Fonts; Noto Sans
Devanagari is the fallback in every font stack.
