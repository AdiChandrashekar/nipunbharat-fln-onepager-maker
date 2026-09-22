"""Build the TG illustration library for the one-pager maker.

    python scripts/tg_images.py            # crop curated regions, write manifest + contact sheet
    python scripts/tg_images.py --detect   # list raw candidates (rasters + vector clusters) for curation
    python scripts/tg_images.py --pdf "D:/path/Hindi TG Grade 2.pdf"   # or set TG_PDF

Reads the source PDF (never committed) and tg_image_sources.json (curated regions and tags).
Writes crops to assets/tg/ (git-ignored) and the manifest to data/image_library.json.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ONEPAGER = ROOT
# Source PDF (never committed). Override with --pdf or the TG_PDF environment variable.
PDF = Path(os.environ.get("TG_PDF", r"C:\Users\adich\Desktop\Hindi TG Grade 2.pdf"))
SOURCES = ONEPAGER / "scripts" / "tg_image_sources.json"
OUT_DIR = ONEPAGER / "assets" / "tg"
MANIFEST = ONEPAGER / "data" / "image_library.json"
COMPENDIUM = ROOT / "data" / "compendium.json"

DPI = 300
PAD_PT = 3            # breathing room around bbox (vector) crops; raster bboxes are already tight
RASTER_INSET_PT = 0.8  # trims the hairline of card title bar that some rasters abut
PRINTED_OFFSET = 2    # printed page N = PDF page N + 2
# Pages worth scanning in --detect: front matter + back-matter method chapters.
DETECT_PAGES = list(range(8, 14)) + list(range(157, 187))
PT_TO_MM = 25.4 / 72


def raster_bbox(page, xref):
    rects = page.get_image_rects(xref)
    if not rects:
        sys.exit(f"xref {xref} not found on PDF page {page.number + 1}")
    return max(rects, key=lambda r: r.width * r.height)


def vector_clusters(page, pad=4, min_area=3000):
    """Group vector drawings into figure-sized clusters (ignores page frames and footers)."""
    R = page.rect
    rects = [pymupdf.Rect(d["rect"]) for d in page.get_drawings()]
    rects = [r for r in rects if not r.is_empty and r.width < R.width * 0.8
             and r.height < R.height * 0.5 and r.y0 > 45 and r.y1 < R.height - 45]
    clusters = []
    for r in rects:
        grown = r + (-pad, -pad, pad, pad)
        cur, n = pymupdf.Rect(r), 1
        for c in [c for c in clusters if c[0].intersects(grown)]:
            cur |= c[0]
            n += c[1]
            clusters.remove(c)
        clusters.append([cur, n])
    merged = True
    while merged:
        merged = False
        for a in clusters:
            for b in clusters:
                if a is not b and (a[0] + (-pad, -pad, pad, pad)).intersects(b[0]):
                    a[0] |= b[0]
                    a[1] += b[1]
                    clusters.remove(b)
                    merged = True
                    break
            if merged:
                break
    return [c for c in clusters if c[0].width * c[0].height >= min_area]


def detect(doc):
    out = []
    for pno in DETECT_PAGES:
        page = doc[pno - 1]
        for info in page.get_image_info(xrefs=True):
            b = pymupdf.Rect(info["bbox"])
            if info["xref"] and b.width >= 60:   # xref 0 = inline card backgrounds
                out.append({"pdf_page": pno, "type": "raster", "xref": info["xref"], "bbox": [round(v, 1) for v in b]})
        for rect, n in vector_clusters(page):
            out.append({"pdf_page": pno, "type": "vector", "paths": n, "bbox": [round(v, 1) for v in rect]})
    for c in out:
        print(json.dumps(c))
    print(f"{len(out)} candidates", file=sys.stderr)


def load_ids():
    data = json.loads(COMPENDIUM.read_text(encoding="utf-8"))
    strategies = {s["strategy_id"]: s for s in data["strategies"]}
    competencies = {c["competency_id"] for d in data["taxonomy"]["domains"] for c in d["competencies"]}
    buckets = {b["bucket_id"] for b in data["taxonomy"]["general_activity_buckets"]}
    routines = {r["routine_id"] for r in data["differentiation_routines"]}
    return strategies, competencies, buckets, routines


def build(doc):
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["images"]
    strategies, competencies, buckets, routines = load_ids()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    errors = []
    images = []
    for src in sources:
        for key, valid in (("strategy_ids", strategies), ("competency_ids", competencies),
                           ("bucket_ids", buckets), ("routine_ids", routines)):
            errors += [f"{src['image_id']}: unknown {key[:-1]} {v}" for v in src.get(key, []) if v not in valid]
        page = doc[src["pdf_page"] - 1]
        loc = src["locate"]
        bbox = raster_bbox(page, loc["xref"]) if "xref" in loc else pymupdf.Rect(loc["bbox"])
        grow = -RASTER_INSET_PT if "xref" in loc else PAD_PT
        clip = (bbox + (-grow, -grow, grow, grow)) & page.rect
        pix = page.get_pixmap(dpi=DPI, clip=clip, alpha=False)
        file = OUT_DIR / f"{src['image_id']}.png"
        pix.save(file)
        images.append({
            "image_id": src["image_id"],
            "file": f"assets/tg/{file.name}",
            "kind": src["kind"],
            "source": {"pdf_page": src["pdf_page"], "printed_page": src["pdf_page"] - PRINTED_OFFSET,
                       "method": "raster" if "xref" in loc else "bbox",
                       "bbox_pt": [round(v, 1) for v in clip]},
            "width_px": pix.width, "height_px": pix.height, "dpi": DPI,
            "aspect": round(pix.width / pix.height, 4),
            "natural_mm": [round(clip.width * PT_TO_MM, 1), round(clip.height * PT_TO_MM, 1)],
            "caption_hi": src["caption_hi"], "caption_en": src["caption_en"],
            "tags": {k: src.get(k, []) for k in ("strategy_ids", "competency_ids", "bucket_ids", "routine_ids")},
        })
    if errors:
        sys.exit("\n".join(errors))

    def index(key):
        idx = {}
        for im in images:
            for t in im["tags"][key]:
                idx.setdefault(t, []).append(im["image_id"])
        return idx

    by_strategy = index("strategy_ids")
    untagged = [s for s in strategies if s not in by_strategy]
    manifest = {
        "_note": "Generated by scripts/tg_images.py from tg_image_sources.json. Crops are git-ignored; re-run the script to regenerate them.",
        "source_pdf": PDF.name,
        "images": images,
        "by_strategy": by_strategy,           # first id = primary image
        "by_competency": index("competency_ids"),
        "by_bucket": index("bucket_ids"),
        "by_routine": index("routine_ids"),
        "strategies_without_image": untagged,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    contact_sheet(images, by_strategy, strategies)
    print(f"{len(images)} images -> {OUT_DIR}")
    print(f"{len(strategies) - len(untagged)}/{len(strategies)} strategies have an image; none for: {', '.join(untagged)}")


def contact_sheet(images, by_strategy, strategies, cols=4, tile=460):
    """One PNG sheet per 12 images: crop + id, page, and the strategies it is primary for."""
    try:
        font = ImageFont.truetype("arial.ttf", 15)
        bold = ImageFont.truetype("arialbd.ttf", 17)
    except OSError:
        font = bold = ImageFont.load_default()
    primary = {}
    for sid, ids in by_strategy.items():
        primary.setdefault(ids[0], []).append(sid)
    text_h = 150
    per_sheet = cols * 3
    for s in range(0, len(images), per_sheet):
        chunk = images[s:s + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tile, rows * (tile + text_h)), "white")
        draw = ImageDraw.Draw(sheet)
        for n, im in enumerate(chunk):
            x, y = (n % cols) * tile, (n // cols) * (tile + text_h)
            crop = Image.open(OUT_DIR / Path(im["file"]).name)
            crop.thumbnail((tile - 20, tile - 20))
            sheet.paste(crop, (x + 10, y + 10))
            draw.rectangle([x + 9, y + 9, x + 10 + crop.width, y + 10 + crop.height], outline="#bbbbbb")
            ty = y + tile - 4
            draw.text((x + 10, ty), f"{s + n + 1}. {im['image_id']}  (p.{im['source']['printed_page']}, {im['kind']})", fill="#1F4F9A", font=bold)
            draw.text((x + 10, ty + 22), im["caption_en"], fill="#222222", font=font)
            prim = primary.get(im["image_id"], [])
            alt = [sid for sid in im["tags"]["strategy_ids"] if sid not in prim]
            other = im["tags"]["competency_ids"] + im["tags"]["bucket_ids"] + im["tags"]["routine_ids"]
            lines = []
            if prim:
                lines.append(f"primary for {len(prim)}: " + ", ".join(strategies[p]["strategy_name_english"] for p in prim))
            if alt:
                lines.append(f"alternate for {len(alt)}: " + ", ".join(strategies[a]["strategy_name_english"] for a in alt))
            if other:
                lines.append("tags: " + " ".join(other))
            ly = ty + 42
            for line in lines:
                for chunk_line in wrap(draw, line, font, tile - 20)[:3]:
                    draw.text((x + 10, ly), chunk_line, fill="#555555", font=font)
                    ly += 18
        sheet.save(OUT_DIR / f"_contact_sheet_{s // per_sheet + 1}.png")


def wrap(draw, text, font, width):
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detect", action="store_true", help="list raw candidate regions instead of building")
    ap.add_argument("--pdf", type=Path, default=PDF, help="path to the Grade 2 Hindi Sandarshika PDF (or set TG_PDF)")
    args = ap.parse_args()
    if not args.pdf.exists():
        sys.exit(f"Source PDF not found: {args.pdf}  (pass --pdf or set TG_PDF)")
    doc = pymupdf.open(args.pdf)
    detect(doc) if args.detect else build(doc)


if __name__ == "__main__":
    main()
