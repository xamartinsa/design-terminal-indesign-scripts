#!/usr/bin/env bash
# macOS updater for Design Terminal InDesign scripts.
# No admin. Writes only under ~/Library/Preferences/Adobe InDesign.
# First open after download (Gatekeeper): right-click → Open — same as FigmaToIndd.
set -euo pipefail

BASE_URL="${DT_SCRIPTS_BASE_URL:-https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main}"
BASE_URL="${BASE_URL%/}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dt-indesign-kit.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pause_close() {
  echo
  read -r -p "Press Enter to close…" _ || true
}

die() {
  echo "ERROR: $*" >&2
  echo "If macOS blocked the file: right-click Update-DT-Scripts.command → Open." >&2
  echo "If Terminal says Permission denied: chmod +x \"\$HOME/Downloads/Update-DT-Scripts.command\"" >&2
  pause_close
  exit 1
}

if [[ -f "$0" && ! -x "$0" ]]; then
  chmod +x "$0" 2>/dev/null || true
fi

command -v curl >/dev/null 2>&1 || die "curl not found"
command -v shasum >/dev/null 2>&1 || die "shasum not found"
command -v osascript >/dev/null 2>&1 || die "osascript not found"

echo "Downloading manifest: $BASE_URL/manifest.json"
curl -fsSL "$BASE_URL/manifest.json" -o "$TMP/manifest.json" || die "failed to download manifest.json"

MAP_FILE="$TMP/map.tsv"
export DT_MANIFEST_PATH="$TMP/manifest.json"
export DT_MAP_PATH="$MAP_FILE"
osascript -l JavaScript <<'JXA' || die "failed to parse manifest.json"
ObjC.import("Foundation");
function readUtf8(path) {
  const data = $.NSData.dataWithContentsOfFile(path);
  if (!data) throw new Error("cannot read " + path);
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}
function writeUtf8(path, text) {
  const str = $.NSString.alloc.initWithUTF8String(text);
  str.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}
const env = $.NSProcessInfo.processInfo.environment;
const manifestPath = env.objectForKey("DT_MANIFEST_PATH").js;
const outPath = env.objectForKey("DT_MAP_PATH").js;
const m = JSON.parse(readUtf8(manifestPath));
const lines = [];
lines.push((m.updatedAt || "") + "\t" + (m.panelSubdir || "Design Terminal Git"));
for (const f of (m.files || [])) {
  lines.push([f.id, f.name, String(f.sha256 || "").toLowerCase()].join("\t"));
}
writeUtf8(outPath, lines.join("\n") + "\n");
JXA

HEADER="$(head -n 1 "$MAP_FILE")"
UPDATED_AT="${HEADER%%$'\t'*}"
SUBDIR="${HEADER#*$'\t'}"
[[ -n "$SUBDIR" ]] || SUBDIR="Design Terminal Git"

ROOT="$HOME/Library/Preferences/Adobe InDesign"
[[ -d "$ROOT" ]] || die "Adobe InDesign preferences not found:
$ROOT
Open InDesign once, then retry."

PANEL_LIST="$TMP/panels.txt"
: > "$PANEL_LIST"
while IFS= read -r -d '' panel; do
  case "$panel" in
    */child_*/Scripts\ Panel) continue ;;
  esac
  printf '%s\n' "$panel" >> "$PANEL_LIST"
done < <(find "$ROOT" -type d -name 'Scripts Panel' -print0 2>/dev/null)

[[ -s "$PANEL_LIST" ]] || die "Scripts Panel not found under $ROOT"

MAX_VER="$(
  sed -n 's/.*Version \([0-9][0-9.]*\).*/\1/p' "$PANEL_LIST" \
    | awk -F. '{ printf "%04d.%04d.%04d %s\n", $1+0, $2+0, $3+0, $0 }' \
    | sort -r | head -n 1 | awk '{ print $2 }'
)"
[[ -n "$MAX_VER" ]] || die "could not detect InDesign version from Scripts Panel paths"

TARGETS=()
while IFS= read -r panel; do
  case "$panel" in
    *"Version $MAX_VER"*) TARGETS+=("$panel") ;;
  esac
done < "$PANEL_LIST"
[[ ${#TARGETS[@]} -gt 0 ]] || die "no Scripts Panel under Version $MAX_VER"

echo "Kit updatedAt: $UPDATED_AT"
echo "InDesign Version $MAX_VER: installing into ${#TARGETS[@]} Scripts Panel folder(s)"

while IFS=$'\t' read -r id name sha; do
  [[ -n "${name:-}" ]] || continue
  echo "  download $id -> $name"
  curl -fsSL "$BASE_URL/kit/$name" -o "$TMP/$name" || die "failed to download $name"
  got="$(shasum -a 256 "$TMP/$name" | awk '{ print tolower($1) }')"
  if [[ -n "$sha" && "$got" != "$sha" ]]; then
    die "SHA256 mismatch for $name"
  fi
done < <(tail -n +2 "$MAP_FILE")

for panel in "${TARGETS[@]}"; do
  target="$panel/$SUBDIR"
  mkdir -p "$target"
  echo "Target: $target"
  while IFS=$'\t' read -r id name sha; do
    [[ -n "${name:-}" ]] || continue
    find "$target" -maxdepth 1 -type f -name "${id}-*.jsx" ! -name "$name" -delete 2>/dev/null || true
    cp -f "$TMP/$name" "$target/$name"
  done < <(tail -n +2 "$MAP_FILE")
  [[ -d "$target/_old" ]] && rm -rf "$target/_old"
  for legacy in "DT Scripts GitHub Auto"; do
    if [[ "$legacy" != "$SUBDIR" && -d "$panel/$legacy" ]]; then
      rm -rf "$panel/$legacy"
      echo "Removed legacy folder: $legacy"
    fi
  done
done

echo
echo "Done. Installed scripts into '$SUBDIR' (${#TARGETS[@]} locale folder(s) under Version $MAX_VER)."
echo "Look in Scripts panel for that folder. Older InDesign versions were not changed."
echo "Restart InDesign if the Scripts panel looks stale."
pause_close
