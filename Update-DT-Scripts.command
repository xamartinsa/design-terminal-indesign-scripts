#!/usr/bin/env bash
# macOS updater for Design Terminal InDesign scripts.
# Scripts go under ~/Library/Preferences/Adobe InDesign (no admin) + a small log.
# Kit scripts that need Python (AIToInDesign: numpy + pillow) get a private Python venv in
# ~/Library/Application Support/DesignTerminal; its path goes to python-path.txt there.
# AIToInDesign's launcher goes to Illustrator File > Scripts (/Applications/Adobe Illustrator */Presets*/*/Scripts).
# Only these two may ask for the Mac password (python.org installer, Illustrator folder), and neither
# failing stops the update: WARNING in the log, the scripts stay installed.
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
PY_FILE="$TMP/python.tsv"
MENU_FILE="$TMP/ai-menu.tsv"
export DT_MANIFEST_PATH="$TMP/manifest.json"
export DT_MAP_PATH="$MAP_FILE"
export DT_PY_PATH="$PY_FILE"
export DT_MENU_PATH="$MENU_FILE"
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
  m.panelKitSubdir || m.panelSubdir || "Design Terminal Kit",
  m.technicalFolder || "zzz Technical"
].join("\t"));
for (const f of (m.files || [])) {
  lines.push([
    f.id || "",
    f.name || "",
    String(f.sha256 || "").toLowerCase(),
    // "-" вместо пустого panelFolder: bash с IFS=$'\t' схлопывает пустые
    // поля, и тогда windowsOnly ("0"/"1") съезжает в колонку папки —
    // отсюда папки "0"/"1" у старого набора.
    f.panelFolder || "-",
    f.windowsOnly ? "1" : "0",
    encodeURIComponent(f.name || "")
  ].join("\t"));
}
writeUtf8(outPath, lines.join("\n") + "\n");
// Python modules for kit scripts (import name <tab> pip name) and Illustrator menu launchers.
const py = [];
for (const f of (m.files || [])) {
  for (const mod of (f.pythonModules || [])) {
    const row = (mod.import || "") + "\t" + (mod.pip || mod.import || "");
    if (mod.import && py.indexOf(row) < 0) py.push(row);
  }
}
writeUtf8(env.objectForKey("DT_PY_PATH").js, py.length ? py.join("\n") + "\n" : "");
const menu = (m.illustratorScripts || []).map(s => [s.name || "", s.menuName || "", String(s.sha256 || "").toLowerCase(), encodeURIComponent(s.name || "")].join("\t"));
writeUtf8(env.objectForKey("DT_MENU_PATH").js, menu.length ? menu.join("\n") + "\n" : "");
JXA

HEADER="$(head -n 1 "$MAP_FILE")"
UPDATED_AT="$(printf '%s' "$HEADER" | cut -f1)"
SUBDIR="$(printf '%s' "$HEADER" | cut -f2)"
TECH_FOLDER="$(printf '%s' "$HEADER" | cut -f3)"
[[ -n "$SUBDIR" ]] || SUBDIR="Design Terminal Kit"
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

while IFS=$'\t' read -r id name sha folder winonly encoded; do
  [[ -n "${name:-}" ]] || continue
  if [[ "${winonly:-0}" == "1" ]]; then
    log_line "  skip $id (Windows only)"
    continue
  fi
  log_line "  download $id -> $name"
  url_name="${encoded:-$name}"
  curl -fsSL "$BASE_URL/kit/$url_name" -o "$TMP/$name" || die "failed to download $name"
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
  # В KEEP корень записан как "-": bash с IFS=$'\t' схлопывает пустые поля,
  # и без плейсхолдера пары (папка, имя) на корневых файлах разъезжаются.
  local key="$folder"
  [[ -z "$key" ]] && key="-"
  awk -F '\t' -v f="$key" -v n="$name" '$1==f && $2==n { found=1 } END { exit !found }' "$file"
}

for panel in "${TARGETS[@]}"; do
  target="$panel/$SUBDIR"
  mkdir -p "$target"
  INSTALL_TARGETS+=("$target")
  log_line "Target: $target"
  KEEP="$TMP/keep-$(echo "$target" | shasum -a 256 | awk '{ print $1 }').tsv"
  : > "$KEEP"
  printf '%s\t%s\n' "-" "$TECH_FOLDER" >> "$KEEP"
  printf '%s\t%s\n' "$TECH_FOLDER" "_update-last.log" >> "$KEEP"

  while IFS=$'\t' read -r id name sha folder winonly encoded; do
    [[ -n "${name:-}" ]] || continue
    if [[ "${winonly:-0}" == "1" ]]; then
      log_line "  skip $id (Windows only)"
      continue
    fi
    dest_dir="$target"
    [[ "$folder" == "-" ]] && folder=""
    if [[ -n "${folder:-}" ]]; then
      dest_dir="$target/$folder"
      printf '%s\t%s\n' "-" "$folder" >> "$KEEP"
    fi
    mkdir -p "$dest_dir"
    if cp -f "$TMP/$name" "$dest_dir/$name"; then
      if [[ -f "$dest_dir/$name" ]]; then
        log_line "  place $dest_dir/$name"
      else
        log_line "  PLACE-MISSING after cp: $dest_dir/$name"
      fi
    else
      log_line "  PLACE-FAILED cp $name -> $dest_dir"
    fi
    if [[ -n "${folder:-}" ]]; then
      printf '%s\t%s\n' "$folder" "$name" >> "$KEEP"
    else
      printf '%s\t%s\n' "-" "$name" >> "$KEEP"
    fi
  done < <(tail -n +2 "$MAP_FILE")

  # Что реально лежит в корне kit до чистки — чтобы разбирать, если у человека
  # скрипты «не появились».
  log_line "  root before cleanup:"
  if [[ -d "$target" ]]; then
    while IFS= read -r -d '' before; do
      log_line "    $(basename "$before")"
    done < <(find "$target" -mindepth 1 -maxdepth 1 -print0)
  fi

  # Managed folder: drop Archive, barcode, old preparators, leftover root files.
  folders=("-")
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
    if [[ "$folder" != "-" ]]; then dir="$target/$folder"; fi
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

  # Старое имя набора рядом с kit.
  for legacy in "DT Scripts GitHub Auto" "Design Terminal Git"; do
    if [[ "$legacy" != "$SUBDIR" && "$legacy" != "$TECH_FOLDER" && -d "$panel/$legacy" ]]; then
      rm -rf "$panel/$legacy"
      log_line "Removed stray folder: $legacy"
    fi
  done
  # Тот же мусор внутри kit. Но только если корневые скрипты уже на месте:
  # у старого апдейтера живые скрипты могли лежать внутри "0"/"1", не сносим
  # их, пока в корне не окажется хотя бы один .jsx из манифеста.
  root_jsx=0
  while IFS=$'\t' read -r id name sha folder winonly encoded; do
    [[ -n "${name:-}" ]] || continue
    [[ "${winonly:-0}" == "1" ]] && continue
    [[ "$folder" == "-" ]] && folder=""
    [[ -n "${folder:-}" ]] && continue
    if [[ -f "$target/$name" ]]; then
      root_jsx=$((root_jsx + 1))
    else
      log_line "  MISSING in root: $name"
    fi
  done < <(tail -n +2 "$MAP_FILE")
  log_line "  root jsx present: $root_jsx"
  if [[ "$root_jsx" -gt 0 ]]; then
    for stray in "0" "1"; do
      if [[ "$stray" != "$SUBDIR" && "$stray" != "$TECH_FOLDER" && -d "$target/$stray" ]]; then
        rm -rf "$target/$stray"
        log_line "Removed stray subfolder: $stray"
      fi
    done
  else
    for stray in "0" "1"; do
      if [[ -d "$target/$stray" ]]; then
        log_line "  KEPT stray subfolder $stray (root has no kit scripts yet)"
      fi
    done
  fi
done

# ---------- Python for kit scripts (AIToInDesign: numpy + pillow) ----------
# A private venv: works the same with python.org, Homebrew (no "externally managed" error)
# and Apple's Command Line Tools Python. No python3 at all -> python.org installer
# (signature checked, the Mac asks for the password once).
DT_SUPPORT="$HOME/Library/Application Support/DesignTerminal"
PY_MARKER="$DT_SUPPORT/python-path.txt"
PY_VENV="$DT_SUPPORT/python-venv"
PY_PKG_URL="https://www.python.org/ftp/python/3.12.10/python-3.12.10-macos11.pkg"
PY_IMPORTS=""

python_has_modules() {
  local exe="$1"
  [[ -n "$exe" && -x "$exe" ]] || return 1
  "$exe" -c "import ${PY_IMPORTS}" >/dev/null 2>&1
}

python_candidates() {
  local c
  if [[ -f "$PY_MARKER" ]]; then head -n 1 "$PY_MARKER" | tr -d '\r'; fi
  echo "$PY_VENV/bin/python3"
  echo "/Library/Frameworks/Python.framework/Versions/Current/bin/python3"
  for c in /Library/Frameworks/Python.framework/Versions/3.*/bin/python3; do
    if [[ -x "$c" ]]; then echo "$c"; fi
  done
  echo "/opt/homebrew/bin/python3"
  echo "/usr/local/bin/python3"
  # Without Command Line Tools /usr/bin/python3 only opens an "install developer tools" window.
  if /usr/bin/xcode-select -p >/dev/null 2>&1; then echo "/usr/bin/python3"; fi
  return 0
}

python_base() {
  local c
  while IFS= read -r c; do
    [[ -n "$c" && -x "$c" ]] || continue
    [[ "$c" == "$PY_VENV/"* ]] && continue
    if "$c" -c 'import sys, venv; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
      echo "$c"
      return 0
    fi
  done < <(python_candidates)
  return 1
}

log_tail() {
  local file="$1" n="$2" l
  [[ -f "$file" ]] || return 0
  while IFS= read -r l; do log_line "    $l"; done < <(tail -n "$n" "$file")
}

install_python_pkg() {
  local pkg="$TMP/python.pkg"
  log_line "  python: downloading $PY_PKG_URL"
  curl -fsSL "$PY_PKG_URL" -o "$pkg" || { log_line "  python: download failed"; return 1; }
  pkgutil --check-signature "$pkg" > "$TMP/pkg-sig.txt" 2>&1 || true
  if ! grep -q "Python Software Foundation" "$TMP/pkg-sig.txt" || ! grep -qi "signed by a developer certificate issued by Apple" "$TMP/pkg-sig.txt"; then
    log_line "  python: installer signature check failed"
    log_tail "$TMP/pkg-sig.txt" 8
    return 1
  fi
  log_line "  python: installing Python 3.12 from python.org. The Mac asks for your password."
  if ! osascript -e "do shell script \"/usr/sbin/installer -pkg \" & quoted form of \"$pkg\" & \" -target /\" with administrator privileges" >/dev/null 2>&1; then
    log_line "  python: installer cancelled or failed"
    return 1
  fi
  return 0
}

ensure_kit_python() {
  [[ -s "$PY_FILE" ]] || return 0
  PY_IMPORTS="$(cut -f1 "$PY_FILE" | paste -sd, -)"
  local pips
  pips="$(cut -f2 "$PY_FILE" | tr '\n' ' ')"
  log_line "Python for kit scripts: needs $pips"
  local c ready="" base=""
  while IFS= read -r c; do
    if python_has_modules "$c"; then ready="$c"; break; fi
  done < <(python_candidates)
  if [[ -z "$ready" ]]; then
    base="$(python_base || true)"
    if [[ -z "$base" ]]; then
      install_python_pkg || return 1
      base="$(python_base || true)"
      [[ -n "$base" ]] || { log_line "  python: installed but not found"; return 1; }
    fi
    log_line "  python: venv $PY_VENV from $base"
    mkdir -p "$DT_SUPPORT" || return 1
    if [[ ! -x "$PY_VENV/bin/python3" ]]; then
      rm -rf "$PY_VENV"
      if ! "$base" -m venv "$PY_VENV" >>"$TMP/pip.log" 2>&1; then
        log_line "  python: venv failed"
        log_tail "$TMP/pip.log" 5
        return 1
      fi
    fi
    log_line "  python: pip install $pips (1-2 min)"
    "$PY_VENV/bin/python3" -m pip install --disable-pip-version-check --upgrade pip >>"$TMP/pip.log" 2>&1 || true
    # shellcheck disable=SC2086
    "$PY_VENV/bin/python3" -m pip install --disable-pip-version-check $pips >>"$TMP/pip.log" 2>&1 || true
    if python_has_modules "$PY_VENV/bin/python3"; then
      ready="$PY_VENV/bin/python3"
    else
      log_line "  python: pip install failed"
      log_tail "$TMP/pip.log" 8
      return 1
    fi
  fi
  mkdir -p "$DT_SUPPORT" || return 1
  printf '%s\n' "$ready" > "$PY_MARKER" || return 1
  log_line "  python ok: $ready"
  return 0
}

# ---------- Illustrator menu: File > Scripts > AIToInDesign ----------
# Copies the launcher into every installed Illustrator, only when the file is missing or different.
# /Applications/Adobe Illustrator * is often writable by an admin user; if not, the Mac asks
# for the password once.
install_illustrator_menu() {
  [[ -s "$MENU_FILE" ]] || return 0
  local dirs=() app loc
  for app in /Applications/Adobe\ Illustrator*/; do
    [[ -d "$app" ]] || continue
    for loc in "$app"Presets.localized/*/ "$app"Presets/*/; do
      [[ -d "$loc" ]] || continue
      dirs+=("${loc%/}/Scripts")
    done
  done
  if [[ ${#dirs[@]} -eq 0 ]]; then
    log_line "Illustrator menu: Illustrator not found, skipped"
    return 0
  fi
  local pending="$TMP/menu-pending.tsv"
  : > "$pending"
  local name menu sha enc dl dir dest got
  while IFS=$'\t' read -r name menu sha enc; do
    [[ -n "$name" && -n "$menu" ]] || continue
    dl="$TMP/menu-$name"
    curl -fsSL "$BASE_URL/kit/${enc:-$name}" -o "$dl" || { log_line "  menu: download failed $name"; return 1; }
    got="$(shasum -a 256 "$dl" | awk '{ print tolower($1) }')"
    [[ -z "$sha" || "$got" == "$sha" ]] || { log_line "  menu: SHA256 mismatch $name"; return 1; }
    for dir in "${dirs[@]}"; do
      dest="$dir/$menu"
      if [[ -f "$dest" ]] && [[ "$(shasum -a 256 "$dest" | awk '{ print tolower($1) }')" == "$got" ]]; then
        continue
      fi
      if mkdir -p "$dir" 2>/dev/null && cp -f "$dl" "$dest" 2>/dev/null; then
        log_line "  menu $dest"
      else
        printf '%s\t%s\n' "$dl" "$dest" >> "$pending"
      fi
    done
  done < "$MENU_FILE"
  if [[ -s "$pending" ]]; then
    local sh="$TMP/menu-admin.sh" src ok=0 bad=0
    {
      echo "#!/bin/bash"
      while IFS=$'\t' read -r src dest; do
        printf 'mkdir -p %q && cp -f %q %q && chmod 644 %q\n' "$(dirname "$dest")" "$src" "$dest" "$dest"
      done < "$pending"
    } > "$sh"
    log_line "Illustrator menu: the Illustrator folder needs the Mac password."
    osascript -e "do shell script \"/bin/bash \" & quoted form of \"$sh\" with administrator privileges" >/dev/null 2>&1 || true
    while IFS=$'\t' read -r src dest; do
      if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
        ok=$((ok + 1))
        log_line "  menu $dest"
      else
        bad=$((bad + 1))
        log_line "  menu FAILED $dest"
      fi
    done < "$pending"
    if [[ $ok -eq 0 && $bad -gt 0 ]]; then return 1; fi
  fi
  log_line "Illustrator menu ready: restart Illustrator, then File > Scripts > AIToInDesign."
  return 0
}

# Neither stops the update: the scripts are already in the InDesign panel.
if ! ensure_kit_python; then
  log_line "WARNING python: not ready. AIToInDesign skips images embedded in .ai until Python 3 + numpy is there. Run this updater again or send the log."
fi
if ! install_illustrator_menu; then
  log_line "WARNING Illustrator menu: not installed. AIToInDesign is still in InDesign Scripts panel (Design Terminal Kit > AI to InDesign)."
fi

STATUS="ok"
echo
log_line "Done. Installed scripts into '$SUBDIR' (${#TARGETS[@]} locale folder(s) under Version $MAX_VER)."
echo "Look in Scripts panel for that folder. Older InDesign versions were not changed."
echo "Restart InDesign if the Scripts panel looks stale."
write_log
pause_close
