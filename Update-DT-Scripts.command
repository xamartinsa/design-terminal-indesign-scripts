#!/bin/bash
# Downloads the full DT InDesign scripts kit into Scripts Panel / Actual Scripts.
# Public mirror: https://xamartin.ru/dt-indesign-scripts/
# Source of truth: git sandbox/scripts/Indesign - *

set -euo pipefail
BASE_URL="${DT_SCRIPTS_BASE_URL:-https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main}"
BASE_URL="${BASE_URL%/}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dt-indesign-kit.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Downloading manifest: $BASE_URL/manifest.json"
curl -fsSL "$BASE_URL/manifest.json" -o "$TMP/manifest.json"

python3 - <<'PY' "$TMP/manifest.json" "$BASE_URL" "$TMP"
import hashlib, json, os, shutil, sys, urllib.request
from pathlib import Path

manifest_path, base_url, tmp = sys.argv[1:4]
m = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
home = Path.home()
root = home / "Library/Preferences/Adobe InDesign"
if not root.exists():
    raise SystemExit(f"Adobe InDesign preferences not found: {root}\nOpen InDesign once, then retry.")

panels = sorted(root.rglob("Scripts Panel"), key=lambda p: str(p), reverse=True)
if not panels:
    raise SystemExit(f"Scripts Panel not found under {root}")
panel = panels[0]
subdir = m.get("panelSubdir") or "Actual Scripts"
target = panel / subdir
archive = target / "Archive"
target.mkdir(parents=True, exist_ok=True)
archive.mkdir(parents=True, exist_ok=True)
print(f"Target: {target}")
print(f"Kit updatedAt: {m.get('updatedAt')}")

for f in m["files"]:
    name = f["name"]
    url = f"{base_url}/kit/{name}"
    dl = Path(tmp) / name
    print(f"  {f['id']} -> {name}")
    urllib.request.urlretrieve(url, dl)
    digest = hashlib.sha256(dl.read_bytes()).hexdigest()
    expected = (f.get("sha256") or "").lower()
    if expected and digest != expected:
        raise SystemExit(f"SHA256 mismatch for {name}")
    prefix = f["id"]
    for old in target.glob(f"{prefix}-*.jsx"):
        if old.name != name:
            shutil.move(str(old), str(archive / old.name))
    shutil.copy2(dl, target / name)

print(f"\nDone. Installed {len(m['files'])} scripts.")
print("Restart InDesign if the Scripts panel looks stale.")
PY

echo
read -r -p "Press Enter to close…" _
