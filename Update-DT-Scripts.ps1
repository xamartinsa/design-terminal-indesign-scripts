#Requires -Version 5.1
param(
  [string]$BaseUrl = 'https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main'
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$tmp = Join-Path $env:TEMP ('dt-indesign-kit-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $manifestPath = Join-Path $tmp 'manifest.json'
  Write-Host "Downloading manifest: $base/manifest.json"
  Invoke-WebRequest -Uri "$base/manifest.json" -OutFile $manifestPath -UseBasicParsing
  $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

  $indesignRoot = Join-Path $env:APPDATA 'Adobe\InDesign'
  if (!(Test-Path -LiteralPath $indesignRoot)) {
    throw "Adobe InDesign AppData folder not found: $indesignRoot"
  }
  $panels = @(Get-ChildItem -LiteralPath $indesignRoot -Directory -Recurse -Filter 'Scripts Panel' -ErrorAction SilentlyContinue)
  if ($panels.Count -eq 0) {
    throw "Scripts Panel folder not found under $indesignRoot. Open InDesign once, then retry."
  }
  $panel = $panels | Sort-Object FullName -Descending | Select-Object -First 1
  $subdir = if ($m.panelSubdir) { [string]$m.panelSubdir } else { 'DT Scripts GitHub Auto' }
  $target = Join-Path $panel.FullName $subdir
  $archive = Join-Path $target '_old'
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  New-Item -ItemType Directory -Path $archive -Force | Out-Null
  Write-Host "Target: $target"
  Write-Host "Kit updatedAt: $($m.updatedAt)"

  foreach ($f in $m.files) {
    $dl = Join-Path $tmp $f.name
    $dest = Join-Path $target $f.name
    Write-Host "  $($f.id) -> $($f.name)"
    Invoke-WebRequest -Uri "$base/kit/$($f.name)" -OutFile $dl -UseBasicParsing
    $hash = (Get-FileHash -LiteralPath $dl -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$f.sha256).ToLowerInvariant()
    if ($expected -and ($hash -ne $expected)) {
      throw "SHA256 mismatch for $($f.name)"
    }
    Get-ChildItem -LiteralPath $target -Filter ($f.id + '-*.jsx') -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne $f.name } |
      ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination (Join-Path $archive $_.Name) -Force }
    # Same fixed name without version suffix (e.g. ImageEmbeddedSyncer.jsx / TerminalBelarusPreparator.jsx)
    if (Test-Path -LiteralPath $dest) {
      # overwrite in place
    }
    Copy-Item -LiteralPath $dl -Destination $dest -Force
  }

  Write-Host ""
  Write-Host ("Done. Installed {0} scripts into '{1}'." -f $m.files.Count, $subdir)
  Write-Host 'Other Scripts Panel folders were not changed.'
  Write-Host 'Restart InDesign if the Scripts panel looks stale.'
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
