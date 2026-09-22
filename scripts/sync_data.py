"""Refresh the strategy data from the रणनीति कोश repository (read-only there).

    python scripts/sync_data.py                       # kosh folder next to this one: ../TG Compendium
    python scripts/sync_data.py --kosh "D:/path/TG Compendium"   # or set KOSH_DIR

Copies compendium.json and web/translations_hi.json into data/. Nothing in the kosh folder is written.
Rebuild the kosh data there first (python merge.py && python consolidate.py) if its content changed.
"""
import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = Path(os.environ.get("KOSH_DIR", ROOT.parent / "TG Compendium"))
FILES = {"compendium.json": "compendium.json", "web/translations_hi.json": "translations_hi.json"}


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12] if p.exists() else "-"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kosh", type=Path, default=DEFAULT, help="path to the रणनीति कोश repository")
    args = ap.parse_args()
    for src_rel, dst_name in FILES.items():
        src, dst = args.kosh / src_rel, ROOT / "data" / dst_name
        if not src.exists():
            sys.exit(f"Not found: {src}  (pass --kosh or set KOSH_DIR)")
        before = digest(dst)
        shutil.copyfile(src, dst)
        after = digest(dst)
        print(f"{dst_name}: {'unchanged' if before == after else 'updated'}")
    print("Reload the app to use the new data. If strategies were added or renamed, re-check the image tags "
          "(npm run images reports any unknown ids).")


if __name__ == "__main__":
    main()
