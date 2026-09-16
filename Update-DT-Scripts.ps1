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
$techFolder = 'Technical'

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

function Get-PanelFolder($fileEntry) {
  if ($fileEntry.PSObject.Properties['panelFolder'] -and [string]$fileEntry.panelFolder) {
    return [string]$fileEntry.panelFolder
  }
  return ''
}

function Test-WindowsOnly($fileEntry) {
  return [bool]($fileEntry.PSObject.Properties['windowsOnly'] -and $fileEntry.windowsOnly)
}

function Find-PublisherToolDir {
  $marker = Join-Path $logDir 'publisher-tool-dir.txt'
  if (Test-Path -LiteralPath $marker) {
    $p = ([string](Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue)).Trim()
    if ($p -and (Test-Path -LiteralPath (Join-Path $p 'publish.py'))) { return $p }
  }
  $candidates = @(
    (Join-Path $env:USERPROFILE 'Desktop\gitlab\design-terminal\sandbox\scripts\Indesign - Template Publisher')
    (Join-Path $env:USERPROFILE 'Desktop\design-terminal\sandbox\scripts\Indesign - Template Publisher')
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c 'publish.py')) {
      New-Item -ItemType Directory -Path $logDir -Force | Out-Null
      [System.IO.File]::WriteAllText($marker, $c)
      return $c
    }
  }
  return $null
}

function Add-Keep([hashtable]$keep, [string]$folder, [string]$name) {
  if (-not $keep.ContainsKey($folder)) { $keep[$folder] = @{} }
  $keep[$folder][$name] = $true
}

New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  Add-Note "Downloading manifest: $base/manifest.json"
  $manifestPath = Join-Path $tmp 'manifest.json'
  Invoke-WebRequest -Uri "$base/manifest.json" -OutFile $manifestPath -UseBasicParsing
  $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($m.PSObject.Properties['technicalFolder'] -and [string]$m.technicalFolder) {
    $techFolder = [string]$m.technicalFolder
  }

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
  Add-Note ("technicalFolder={0}" -f $techFolder)
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

  $publisherToolDir = Find-PublisherToolDir
  if ($publisherToolDir) {
    Add-Note ("publisherToolDir={0}" -f $publisherToolDir)
  }

  foreach ($panel in $targets) {
    $target = Join-Path $panel.FullName $subdir
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $installTargets += $target
    Add-Note "Target: $target"

    $keep = @{}
    Add-Keep $keep '' 'tool-dir.txt'
    Add-Keep $keep '' $techFolder

    foreach ($f in $m.files) {
      $folder = Get-PanelFolder $f
      $destDir = if ($folder) { Join-Path $target $folder } else { $target }
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
      Copy-Item -LiteralPath $downloaded[$f.name] -Destination (Join-Path $destDir $f.name) -Force
      Add-Keep $keep $folder $f.name
      if ($folder) { Add-Keep $keep '' $folder }
    }

    $pub = @($m.files | Where-Object { $_.id -eq 'PublishTemplate' }) | Select-Object -First 1
    if ($pub -and $publisherToolDir) {
      $pubFolder = Get-PanelFolder $pub
      $pubDir = if ($pubFolder) { Join-Path $target $pubFolder } else { $target }
      [System.IO.File]::WriteAllText((Join-Path $pubDir 'tool-dir.txt'), $publisherToolDir)
      Add-Keep $keep $pubFolder 'tool-dir.txt'
    }

    foreach ($folder in @($keep.Keys)) {
      $dir = if ($folder) { Join-Path $target $folder } else { $target }
      if (!(Test-Path -LiteralPath $dir)) { continue }
      Get-ChildItem -LiteralPath $dir -Force | ForEach-Object {
        if (-not $keep[$folder].ContainsKey($_.Name)) {
          Add-Note ("  remove {0}" -f $_.FullName.Substring($target.Length).TrimStart('\'))
          Remove-Item -LiteralPath $_.FullName -Recurse -Force
        }
      }
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
    try {
      $tech = Join-Path $t $techFolder
      New-Item -ItemType Directory -Path $tech -Force | Out-Null
      Get-ChildItem -LiteralPath $tech -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '_update-last.log' } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
      Copy-Item -LiteralPath $logFile -Destination (Join-Path $tech '_update-last.log') -Force
    } catch {}
  }
  if (Test-Path -LiteralPath $logFile) {
    Write-Host "Log: $logFile"
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
