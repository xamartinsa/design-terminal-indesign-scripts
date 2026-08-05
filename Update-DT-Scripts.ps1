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
  $panels = @(Get-ChildItem -LiteralPath $indesignRoot -Directory -Recurse -Filter 'Scripts Panel' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\child_\d+\\' })
  if ($panels.Count -eq 0) {
    throw "Scripts Panel folder not found under $indesignRoot. Open InDesign once, then retry."
  }

  function Get-IndesignVersionFromPath([string]$path) {
    if ($path -match 'Version (\d+(?:\.\d+)*)') { return [version]$Matches[1] }
    return [version]'0.0'
  }

  $maxVer = ($panels | ForEach-Object { Get-IndesignVersionFromPath $_.FullName } | Measure-Object -Maximum).Maximum
  $targets = @($panels | Where-Object { (Get-IndesignVersionFromPath $_.FullName) -eq $maxVer })
  if ($targets.Count -eq 0) { $targets = @($panels | Sort-Object FullName -Descending | Select-Object -First 1) }

  $subdir = if ($m.panelSubdir) { [string]$m.panelSubdir } else { 'Design Terminal Git' }
  $legacySubdirs = @('DT Scripts GitHub Auto')
  Write-Host "Kit updatedAt: $($m.updatedAt)"
  Write-Host ("InDesign Version {0}: installing into {1} Scripts Panel folder(s)" -f $maxVer, $targets.Count)

  # Download + verify once
  $downloaded = @{}
  foreach ($f in $m.files) {
    $dl = Join-Path $tmp $f.name
    Write-Host "  download $($f.id) -> $($f.name)"
    Invoke-WebRequest -Uri "$base/kit/$($f.name)" -OutFile $dl -UseBasicParsing
    $hash = (Get-FileHash -LiteralPath $dl -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$f.sha256).ToLowerInvariant()
    if ($expected -and ($hash -ne $expected)) {
      throw "SHA256 mismatch for $($f.name)"
    }
    $downloaded[$f.name] = $dl
  }

  foreach ($panel in $targets) {
    $target = Join-Path $panel.FullName $subdir
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Write-Host "Target: $target"
    foreach ($f in $m.files) {
      $dl = $downloaded[$f.name]
      $dest = Join-Path $target $f.name
      # Старые версии того же скрипта удаляем (без папки _old)
      Get-ChildItem -LiteralPath $target -Filter ($f.id + '-*.jsx') -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $f.name } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
      Copy-Item -LiteralPath $dl -Destination $dest -Force
    }
    $staleArchive = Join-Path $target '_old'
    if (Test-Path -LiteralPath $staleArchive) {
      Remove-Item -LiteralPath $staleArchive -Recurse -Force
    }
    foreach ($legacy in $legacySubdirs) {
      $legacyPath = Join-Path $panel.FullName $legacy
      if ((Test-Path -LiteralPath $legacyPath) -and ($legacy -ne $subdir)) {
        Remove-Item -LiteralPath $legacyPath -Recurse -Force
        Write-Host "Removed legacy folder: $legacy"
      }
    }
  }

  Write-Host ""
  Write-Host ("Done. Installed {0} scripts into '{1}' ({2} locale folder(s) under Version {3})." -f $m.files.Count, $subdir, $targets.Count, $maxVer)
  Write-Host 'Look in Scripts panel for that folder. Older InDesign versions were not changed.'
  Write-Host 'Restart InDesign if the Scripts panel looks stale.'
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
