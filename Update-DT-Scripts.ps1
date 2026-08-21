#Requires -Version 5.1
param(
  [string]$BaseUrl = 'https://raw.githubusercontent.com/xamartinsa/design-terminal-indesign-scripts/main'
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$tmp = Join-Path $env:TEMP ('dt-indesign-kit-' + [guid]::NewGuid().ToString('n'))
$logDir = Join-Path $env:LOCALAPPDATA 'DesignTerminal'
$logFile = Join-Path $logDir 'update-last.log'
$notes = New-Object System.Collections.Generic.List[string]
$status = 'fail'
$installTargets = @()

function Write-DtLog {
  try {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $lines = @(
      ("updatedAtLocal={0}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
      ("status={0}" -f $status)
      ("host={0}" -f $env:COMPUTERNAME)
      ("user={0}" -f $env:USERNAME)
      ("baseUrl={0}" -f $base)
    ) + $notes
    [System.IO.File]::WriteAllLines($logFile, $lines)
  } catch {}
}

function Add-Note([string]$text) {
  $notes.Add($text) | Out-Null
  Write-Host $text
}

New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  Add-Note "Downloading manifest: $base/manifest.json"
  $manifestPath = Join-Path $tmp 'manifest.json'
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
  Add-Note ("kitUpdatedAt={0}" -f $m.updatedAt)
  Add-Note ("panelSubdir={0}" -f $subdir)
  Add-Note ("InDesign Version {0}: installing into {1} Scripts Panel folder(s)" -f $maxVer, $targets.Count)

  $downloaded = @{}
  foreach ($f in $m.files) {
    $dl = Join-Path $tmp $f.name
    Add-Note "  download $($f.id) -> $($f.name)"
    Invoke-WebRequest -Uri "$base/kit/$($f.name)" -OutFile $dl -UseBasicParsing
    $hash = (Get-FileHash -LiteralPath $dl -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$f.sha256).ToLowerInvariant()
    if ($expected -and ($hash -ne $expected)) {
      Add-Note "  expectedSha=$expected"
      Add-Note "  gotSha=$hash"
      throw "SHA256 mismatch for $($f.name)"
    }
    $downloaded[$f.name] = $dl
  }

  foreach ($panel in $targets) {
    $target = Join-Path $panel.FullName $subdir
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $installTargets += $target
    Add-Note "Target: $target"
    foreach ($f in $m.files) {
      $dl = $downloaded[$f.name]
      $dest = Join-Path $target $f.name
      Get-ChildItem -LiteralPath $target -Filter ($f.id + '-*.jsx') -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $f.name } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
      Copy-Item -LiteralPath $dl -Destination $dest -Force
    }
    foreach ($staleName in @('ImageLinkSyncer-*.jsx', 'FontSyncer-*.jsx', 'MiniPackage-*.jsx', 'TerminalSyncer-*.jsx')) {
      Get-ChildItem -LiteralPath $target -Filter $staleName -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    }
    $staleArchive = Join-Path $target '_old'
    if (Test-Path -LiteralPath $staleArchive) {
      Remove-Item -LiteralPath $staleArchive -Recurse -Force
    }
    foreach ($legacy in $legacySubdirs) {
      $legacyPath = Join-Path $panel.FullName $legacy
      if ((Test-Path -LiteralPath $legacyPath) -and ($legacy -ne $subdir)) {
        Remove-Item -LiteralPath $legacyPath -Recurse -Force
        Add-Note "Removed legacy folder: $legacy"
      }
    }
  }

  $status = 'ok'
  Write-Host ""
  Add-Note ("Done. Installed {0} scripts into '{1}' ({2} locale folder(s) under Version {3})." -f $m.files.Count, $subdir, $targets.Count, $maxVer)
  Write-Host 'Look in Scripts panel for that folder. Older InDesign versions were not changed.'
  Write-Host 'Restart InDesign if the Scripts panel looks stale.'
}
catch {
  Add-Note ("ERROR: {0}" -f $_.Exception.Message)
  throw
}
finally {
  Write-DtLog
  foreach ($t in $installTargets) {
    try { Copy-Item -LiteralPath $logFile -Destination (Join-Path $t '_update-last.log') -Force } catch {}
  }
  if (Test-Path -LiteralPath $logFile) {
    Write-Host "Log: $logFile"
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
