#!/usr/bin/env bash
# macOS updater for Design Terminal InDesign scripts.
# No admin. Writes only under ~/Library/Preferences/Adobe InDesign (+ a small log).
# If macOS says the file is "damaged" (Telegram/quarantine): open Terminal and run:
#   xattr -cr "/path/to/Update-DT-Scripts.command" && chmod +x "/path/to/Update-DT-Scripts.command" && open "/path/to/Update-DT-Scripts.command"
# Or simply: bash "/path/to/Update-DT-Scripts.command"
set -euo pipefail

BASE_URL="${DT_SCRIPTS_BASE_URL:-https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main}"
BASE_URL="${BASE_URL%/}"

# Old .command in Downloads: fetch the current updater, then run that.
if [[ "${DT_UPDATER_BOOTSTRAPPED:-}" != "1" ]]; then
  BOOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dt-indesign-boot.XXXXXX")"
  if curl -fsSL "$BASE_URL/Update-DT-Scripts.command" -o "$BOOT_TMP/Update-DT-Scripts.command"; then
    chmod +x "$BOOT_TMP/Update-DT-Scripts.command" 2>/dev/null || true
    export DT_UPDATER_BOOTSTRAPPED=1
    export DT_SCRIPTS_BASE_URL="$BASE_URL"
    exec bash "$BOOT_TMP/Update-DT-Scripts.command"
  fi
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/dt-indesign-kit.XXXXXX")"
LOG_DIR="$HOME/Library/Logs/DesignTerminal"
LOG_FILE="$LOG_DIR/update-last.log"
STATUS="fail"
NOTES=()
TECH_FOLDER="zzz Technical"
INSTALL_TARGETS=()

mkdir -p "$LOG_DIR" 2>/dev/null || true

log_line() {
  NOTES+=("$*")
  echo "$*"
}

write_log() {
  {
    echo "updatedAtLocal=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "status=$STATUS"
    echo "host=$(hostname 2>/dev/null || echo unknown)"
    echo "user=${USER:-unknown}"
    echo "baseUrl=$BASE_URL"
    echo "script=$0"
    for line in "${NOTES[@]:-}"; do
      echo "$line"
    done
  } >"$LOG_FILE" 2>/dev/null || true
}

cleanup() {
  write_log
  local t
  for t in "${INSTALL_TARGETS[@]:-}"; do
    mkdir -p "$t/$TECH_FOLDER" 2>/dev/null || true
    find "$t/$TECH_FOLDER" -mindepth 1 -maxdepth 1 ! -name '_update-last.log' ! -name 'tool-dir.txt' -exec rm -rf {} + 2>/dev/null || true
    cp -f "$LOG_FILE" "$t/$TECH_FOLDER/_update-last.log" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

pause_close() {
  echo
  echo "Log: $LOG_FILE"
  read -r -p "Press Enter to close…" _ || true
}

die() {
  log_line "ERROR: $*"
  echo "If macOS says damaged/quarantine (often after Telegram):" >&2
  echo "  xattr -cr \"$0\" && chmod +x \"$0\" && open \"$0\"" >&2
  echo "Or run without double-click:" >&2
  echo "  bash \"$0\"" >&2
  echo "If Permission denied: chmod +x \"$0\"" >&2
  pause_close
  exit 1
}

# Clear quarantine if we were started via Terminal/bash (double-click may never reach here).
if [[ -f "$0" ]]; then
  xattr -dr com.apple.quarantine "$0" 2>/dev/null || true
  chmod +x "$0" 2>/dev/null || true
fi

command -v curl >/dev/null 2>&1 || die "curl not found"
command -v shasum >/dev/null 2>&1 || die "shasum not found"
command -v osascript >/dev/null 2>&1 || die "osascript not found"

log_line "Downloading manifest: $BASE_URL/manifest.json"
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
lines.push([
  m.updatedAt || "",
  m.panelSubdir || "Design Terminal Git",
  m.technicalFolder || "zzz Technical"
].join("\t"));
for (const f of (m.files || [])) {
  lines.push([
    f.id || "",
    f.name || "",
    String(f.sha256 || "").toLowerCase(),
    f.panelFolder || "",
    f.windowsOnly ? "1" : "0"
  ].join("\t"));
}
writeUtf8(outPath, lines.join("\n") + "\n");
JXA

HEADER="$(head -n 1 "$MAP_FILE")"
UPDATED_AT="$(printf '%s' "$HEADER" | cut -f1)"
SUBDIR="$(printf '%s' "$HEADER" | cut -f2)"
TECH_FOLDER="$(printf '%s' "$HEADER" | cut -f3)"
[[ -n "$SUBDIR" ]] || SUBDIR="Design Terminal Git"
[[ -n "$TECH_FOLDER" ]] || TECH_FOLDER="zzz Technical"
log_line "kitUpdatedAt=$UPDATED_AT"
log_line "panelSubdir=$SUBDIR"
log_line "technicalFolder=$TECH_FOLDER"

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

log_line "InDesign Version $MAX_VER: installing into ${#TARGETS[@]} Scripts Panel folder(s)"

while IFS=$'\t' read -r id name sha folder winonly; do
  [[ -n "${name:-}" ]] || continue
  if [[ "${winonly:-0}" == "1" ]]; then
    log_line "  skip $id (Windows only)"
    continue
  fi
  log_line "  download $id -> $name"
  curl -fsSL "$BASE_URL/kit/$name" -o "$TMP/$name" || die "failed to download $name"
  got="$(shasum -a 256 "$TMP/$name" | awk '{ print tolower($1) }')"
  if [[ -n "$sha" && "$got" != "$sha" ]]; then
    log_line "  expectedSha=$sha"
    log_line "  gotSha=$got"
    die "SHA256 mismatch for $name"
  fi
done < <(tail -n +2 "$MAP_FILE")

keep_has() {
  local file="$1"
  local folder="$2"
  local name="$3"
  awk -F '\t' -v f="$folder" -v n="$name" '$1==f && $2==n { found=1 } END { exit !found }' "$file"
}

for panel in "${TARGETS[@]}"; do
  target="$panel/$SUBDIR"
  mkdir -p "$target"
  INSTALL_TARGETS+=("$target")
  log_line "Target: $target"
  KEEP="$TMP/keep-$(echo "$target" | shasum -a 256 | awk '{ print $1 }').tsv"
  : > "$KEEP"
  printf '%s\t%s\n' "" "$TECH_FOLDER" >> "$KEEP"
  printf '%s\t%s\n' "$TECH_FOLDER" "_update-last.log" >> "$KEEP"

  while IFS=$'\t' read -r id name sha folder winonly; do
    [[ -n "${name:-}" ]] || continue
    if [[ "${winonly:-0}" == "1" ]]; then
      continue
    fi
    dest_dir="$target"
    if [[ -n "${folder:-}" ]]; then
      dest_dir="$target/$folder"
      printf '%s\t%s\n' "" "$folder" >> "$KEEP"
    fi
    mkdir -p "$dest_dir"
    cp -f "$TMP/$name" "$dest_dir/$name"
    printf '%s\t%s\n' "${folder:-}" "$name" >> "$KEEP"
  done < <(tail -n +2 "$MAP_FILE")

  # Managed folder: drop Archive, barcode, old preparators, leftover root files.
  folders=("")
  while IFS=$'\t' read -r folder name; do
    [[ -n "$folder" ]] || continue
    skip=0
    for existing in "${folders[@]}"; do
      if [[ "$existing" == "$folder" ]]; then skip=1; break; fi
    done
    if [[ $skip -eq 0 ]]; then folders+=("$folder"); fi
  done < "$KEEP"

  for folder in "${folders[@]}"; do
    dir="$target"
    [[ -n "$folder" ]] && dir="$target/$folder"
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' item; do
      base="$(basename "$item")"
      if keep_has "$KEEP" "$folder" "$base"; then
        continue
      fi
      rel="${item#$target/}"
      log_line "  remove $rel"
      rm -rf "$item"
    done < <(find "$dir" -mindepth 1 -maxdepth 1 -print0)
  done

  for legacy in "DT Scripts GitHub Auto"; do
    if [[ "$legacy" != "$SUBDIR" && -d "$panel/$legacy" ]]; then
      rm -rf "$panel/$legacy"
      log_line "Removed legacy folder: $legacy"
    fi
  done
done

STATUS="ok"
echo
log_line "Done. Installed scripts into '$SUBDIR' (${#TARGETS[@]} locale folder(s) under Version $MAX_VER)."
echo "Look in Scripts panel for that folder. Older InDesign versions were not changed."
echo "Restart InDesign if the Scripts panel looks stale."
write_log
pause_close
