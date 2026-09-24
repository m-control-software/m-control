"""Developer script (run directly, NOT via mctl): diff two snapshots from snapshot.py.
Step 4 of the controlled-change method in docs/maintenance.md.

    python research/diff_snapshots.py <before-dir> <after-dir> [--all]

Reports changed files, changed registry fingerprints and a structural diff of
the settings document. Paths the agent rewrites on its own (token refresh, app
run times, firmware checks, icon cache) are hidden unless --all is given.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import docdiff  # noqa: E402


def load(d: Path, name: str):
    return json.loads((d / name).read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("before")
    ap.add_argument("after")
    ap.add_argument("--all", action="store_true", help="include paths the agent rewrites on its own")
    args = ap.parse_args()
    a, b = Path(args.before), Path(args.after)
    sys.stdout.reconfigure(encoding="utf-8")
    ma, mb = load(a, "meta.json"), load(b, "meta.json")
    print(f"# {a.name} -> {b.name}\n")
    print(f"blob {ma['blobSha256'][:16]} -> {mb['blobSha256'][:16]}  ({ma['blobLen']} -> {mb['blobLen']} bytes), "
          f"last saved {ma['rowDateCreatedUtc']} -> {mb['rowDateCreatedUtc']} UTC\n")

    fa = {r["path"]: r for r in load(a, "files.json")}
    fb = {r["path"]: r for r in load(b, "files.json")}
    print("## files")
    for p in sorted(set(fa) | set(fb), key=str.lower):
        ra, rb = fa.get(p), fb.get(p)
        if ra is None or rb is None or ra.get("sha256") != rb.get("sha256"):
            print(f"  {'+' if ra is None else '-' if rb is None else '~'} {p}")

    ga, gb = load(a, "registry.json"), load(b, "registry.json")
    print("\n## registry (fingerprints only)")
    for k in sorted(set(ga) | set(gb)):
        if ga.get(k) != gb.get(k):
            print(f"  ~ {k}: {ga.get(k)} -> {gb.get(k)}")

    da = json.loads((a / "settings.blob").read_bytes())
    db = json.loads((b / "settings.blob").read_bytes())
    print("\n## settings document")
    for line in docdiff.describe(da, db, include_noise=args.all, limit=400):
        print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
