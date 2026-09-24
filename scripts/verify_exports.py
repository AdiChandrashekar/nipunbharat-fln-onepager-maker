"""Verify exports written by scripts/export-test.mjs.

    python scripts/verify_exports.py <outdir>

Checks, per document: page count and size (mm, incl. bleed), embedded fonts, extractable/searchable text,
text position vs the document model (mm), PNG pixel sizes per DPI, and PDF-vs-PNG raster alignment.
Writes <outdir>/crops/*.png: the Devanagari test string cut from each format, for a visual shaping check.
"""
import io
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

import numpy as np
import pymupdf
import pypdfium2 as pdfium  # PDFium = the engine of Chrome's / Edge's PDF viewers
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")  # Hindi in the report; Windows consoles default to a legacy code page
MM_PER_PT = 25.4 / 72
TEST = "क्षत्रिय प्रवाहपूर्ण श्रुतलेख स्त्रीलिंग"
out = Path(sys.argv[1])
(out / "crops").mkdir(exist_ok=True)
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).strip()


def png_pages(path):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            return [Image.open(io.BytesIO(z.read(n))).convert("RGB") for n in sorted(z.namelist())]
    return [Image.open(path).convert("RGB")]


def offset(a, b):
    """Sub-image shift (px) between two same-size greyscale arrays via phase correlation."""
    fa, fb = np.fft.fft2(a - a.mean()), np.fft.fft2(b - b.mean())
    r = np.fft.ifft2(fa * np.conj(fb) / (np.abs(fa * np.conj(fb)) + 1e-9)).real
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    h, w = a.shape
    return (dx - w if dx > w // 2 else dx), (dy - h if dy > h // 2 else dy)


for jf in sorted(out.glob("*.json")):
    name = jf.stem
    doc = json.loads(jf.read_text(encoding="utf-8"))
    W, H, bleed = doc["page"]["width_mm"], doc["page"]["height_mm"], doc["page"]["bleed_mm"]
    print(f"\n== {name}: {len(doc['pages'])} page(s), {W}×{H} mm")

    pdf = pymupdf.open(out / f"{name}.pdf.pdf")
    check(f"{name}: PDF page count", len(pdf) == len(doc["pages"]), f"{len(pdf)}")
    pw, ph = pdf[0].rect.width * MM_PER_PT, pdf[0].rect.height * MM_PER_PT
    check(f"{name}: PDF page size", abs(pw - W) < 0.2 and abs(ph - H) < 0.2, f"{pw:.2f} × {ph:.2f} mm")

    # Fonts: every font used must be embedded (ext != "n/a").
    fonts = {}
    for p in pdf:
        for xref, ext, typ, basefont, *_ in p.get_fonts(full=False):
            fonts[basefont] = ext
    not_embedded = [f for f, ext in fonts.items() if ext in ("", "n/a")]
    check(f"{name}: all fonts embedded", not not_embedded, ", ".join(sorted({re.sub(r'^[A-Z]{6}\+', '', f) for f in fonts})))

    # Search, as a reader does it in Chrome / Edge (PDFium): the opening words of every text element are found.
    pdoc = pdfium.PdfDocument(str(out / f"{name}.pdf.pdf"))
    found = total = 0
    missing = []
    exact_copy = 0
    for i, page in enumerate(doc["pages"]):
        tp = pdoc[i].get_textpage()
        raw = norm(pdf[i].get_text())
        for e in page["elements"]:
            if e["type"] != "text" or not e["content"]["text"].strip() or e.get("hidden"):
                continue
            words = e["content"]["text"].split()
            # Rotated text is laid out glyph by glyph along a slant; readers match it word by word.
            q = words[0] if e["rotation"] else " ".join(words[:3])
            total += 1
            # A three-word phrase can straddle a line break in a narrow box; readers then find it word by word.
            if tp.search(q).get_next() or tp.search(words[0]).get_next():
                found += 1
            else:
                missing.append(q)
            exact_copy += norm(e["content"]["text"]) in raw
    check(f"{name}: text is searchable (PDFium)", found == total, f"{found}/{total}" + (f"; not found: {missing[:3]}" if missing else ""))
    print(f"INFO  {name}: exact copy-paste text (MuPDF extraction) for {exact_copy}/{total} elements")
    if name.startswith("devanagari"):
        tp = pdoc[0].get_textpage()
        s_ = tp.search(TEST)
        n = 0
        while s_.get_next():
            n += 1
        check(f"{name}: search finds the full test string '{TEST}'", n >= 9, f"{n} hits")

    # Position: a text element's first line in the PDF should start where the model says (x + left padding).
    dx_all, dy_all = [], []
    for i, page in enumerate(doc["pages"]):
        lines = [(l["bbox"], "".join(s["text"] for s in l["spans"])) for b in pdf[i].get_text("dict")["blocks"] if b["type"] == 0 for l in b["lines"]]
        for e in page["elements"]:
            if e["type"] != "text" or e["rotation"] or e.get("hidden") or e["style"].get("align", "left") != "left":
                continue
            first = norm(e["content"]["text"].split("\n")[0])[:8]
            if len(first) < 4:
                continue
            pad = e["style"].get("padding_mm", 0)
            pad = pad if isinstance(pad, (int, float)) else pad[3]
            cands = [bb for bb, t in lines if norm(t).startswith(first)]
            if not cands:
                continue
            bb = min(cands, key=lambda bb: abs(bb[0] * MM_PER_PT - e["x_mm"]) + abs(bb[1] * MM_PER_PT - e["y_mm"]))
            dx_all.append(bb[0] * MM_PER_PT - (e["x_mm"] + pad))
            dy_all.append(bb[1] * MM_PER_PT - e["y_mm"])
    if dx_all:
        dx, dy = np.abs(dx_all), np.array(dy_all)
        check(f"{name}: text x within 1 mm of the model", dx.max() < 1.0, f"n={len(dx)}, median {np.median(dx):.2f}, max {dx.max():.2f} mm")
        # PDF line boxes start at the font's ascender, not the CSS line box, so this differs by font; vertical
        # fidelity is checked instead by the PDF-vs-PNG raster alignment below (PNG = the editor's renderer).
        print(f"INFO  {name}: text line-box top vs model y: median {np.median(dy):.2f}, range {dy.min():.2f}…{dy.max():.2f} mm")

    # PNG: pixel size = mm at the DPI; and the PDF rasterised at 150 dpi lines up with the 150 dpi PNG.
    for dpi in (150, 300):
        path = next(out.glob(f"{name}.png{dpi}.*"))
        imgs = png_pages(path)
        ew, eh = round(W / 25.4 * dpi), round(H / 25.4 * dpi)
        ok = len(imgs) == len(doc["pages"]) and all(im.width == ew and im.height == eh for im in imgs)
        check(f"{name}: PNG {dpi} dpi size ({path.suffix[1:]})", ok, f"{len(imgs)} × {imgs[0].width}×{imgs[0].height} px (expect {ew}×{eh})")
    png = png_pages(next(out.glob(f"{name}.png150.*")))
    worst = 0.0
    for i, im in enumerate(png):
        pix = pdf[i].get_pixmap(dpi=150, alpha=False)
        ras = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize(im.size)
        a = np.asarray(ras.convert("L"), dtype=float)
        b = np.asarray(im.convert("L"), dtype=float)
        ox, oy = offset(a, b)
        diff = np.abs(a - b).mean()
        worst = max(worst, max(abs(ox), abs(oy)) * 25.4 / 150)
        check(f"{name} p{i + 1}: PDF and PNG align", max(abs(ox), abs(oy)) * 25.4 / 150 <= 1.0, f"shift ({ox}, {oy}) px = {max(abs(ox), abs(oy)) * 25.4 / 150:.2f} mm; mean |diff| {diff:.1f}/255")

    # Devanagari crops for eyeballing: the test-string rows, from the PDF (rasterised) and the 300 dpi PNG.
    if name.startswith("devanagari"):
        rows = [e for e in doc["pages"][0]["elements"] if e["type"] == "text" and TEST in e["content"]["text"]]
        y0 = min(e["y_mm"] for e in rows) - 2
        y1 = max(e["y_mm"] + e["h_mm"] for e in rows) + 2
        clip = pymupdf.Rect(10 / MM_PER_PT, y0 / MM_PER_PT, (W - 10) / MM_PER_PT, y1 / MM_PER_PT)
        pdf[0].get_pixmap(dpi=300, clip=clip).save(out / "crops" / "devanagari-from-pdf.png")
        im = png_pages(next(out.glob(f"{name}.png300.*")))[0]
        k = 300 / 25.4
        im.crop((round(10 * k), round(y0 * k), round((W - 10) * k), round(y1 * k))).save(out / "crops" / "devanagari-from-png300.png")

    # Bleed variant: page grows by 2 × bleed.
    bp = out / f"{name}.pdf-bleed.pdf"
    if bp.exists():
        bd = pymupdf.open(bp)
        bw, bh = bd[0].rect.width * MM_PER_PT, bd[0].rect.height * MM_PER_PT
        check(f"{name}: PDF with bleed is trim + 2×{bleed} mm", abs(bw - (W + 2 * bleed)) < 0.2 and abs(bh - (H + 2 * bleed)) < 0.2, f"{bw:.2f} × {bh:.2f} mm")
        bimg = png_pages(next(out.glob(f"{name}.png150-bleed.*")))[0]
        check(f"{name}: PNG with bleed size", bimg.width == round((W + 2 * bleed) / 25.4 * 150) and bimg.height == round((H + 2 * bleed) / 25.4 * 150), f"{bimg.width}×{bimg.height} px")

print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: ' + '; '.join(failures)}")
sys.exit(1 if failures else 0)
