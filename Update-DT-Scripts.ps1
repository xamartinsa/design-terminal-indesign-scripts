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
$techFolder = 'zzz Technical'

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

#region Python for kit scripts (AIToInDesign: numpy + pillow)
$PythonInstallerUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe'
$PythonPathMarker = Join-Path $logDir 'python-path.txt'

function Invoke-PythonProbe([string]$exe, [string[]]$prefix, [string]$code) {
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $exe @prefix -c $code 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($out | Select-Object -Last 1) -as [string]).Trim()
  } catch { return $null }
}

function Get-PythonCandidates {
  $list = New-Object System.Collections.Generic.List[string]
  $probe = 'import sys;print(sys.executable)'
  foreach ($c in @(@('python', @()), @('py', @('-3')), @('python3', @()))) {
    if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
    $exe = Invoke-PythonProbe $c[0] $c[1] $probe
    if ($exe -and ($exe -notmatch '\\WindowsApps\\') -and (Test-Path -LiteralPath $exe)) { $list.Add($exe) }
  }
  $globs = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3*\python.exe'),
    (Join-Path $env:ProgramFiles 'Python3*\python.exe')
  )
  foreach ($g in $globs) {
    Get-ChildItem -Path $g -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { $list.Add($_.FullName) }
  }
  $seen = @{}
  $result = @()
  foreach ($p in $list) {
    $key = $p.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $result += $p
  }
  return $result
}

function Test-PythonModules([string]$exe, [string[]]$imports) {
  # Только одинарные кавычки внутри: PowerShell 5.1 съедает двойные в аргументах программы.
  $code = 'import ' + ($imports -join ',') + ";print('ok')"
  return ((Invoke-PythonProbe $exe @() $code) -eq 'ok')
}

function Install-PythonForUser {
  $installer = Join-Path $tmp 'python-installer.exe'
  Add-Note "  python: downloading $PythonInstallerUrl"
  Invoke-WebRequest -Uri $PythonInstallerUrl -OutFile $installer -UseBasicParsing
  $sig = Get-AuthenticodeSignature -LiteralPath $installer
  if ($sig.Status -ne 'Valid' -or ([string]$sig.SignerCertificate.Subject) -notmatch 'Python Software Foundation') {
    throw "python installer signature check failed ($($sig.Status))"
  }
  Add-Note '  python: installing for this user (no admin, ~1 min)'
  $p = Start-Process -FilePath $installer -ArgumentList @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_doc=0', 'Include_tcltk=0', 'Shortcuts=0') -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "python installer exit code $($p.ExitCode)" }
}

function Ensure-KitPython($files) {
  $modules = @()
  foreach ($f in $files) {
    if ($f.PSObject.Properties['pythonModules'] -and $f.pythonModules) { $modules += @($f.pythonModules) }
  }
  if ($modules.Count -eq 0) { return }
  $imports = @($modules | ForEach-Object { [string]$_.import } | Select-Object -Unique)
  $pips = @($modules | ForEach-Object { [string]$_.pip } | Select-Object -Unique)
  Add-Note ("Python for kit scripts: needs {0}" -f ($pips -join ', '))

  $candidates = @(Get-PythonCandidates)
  $ready = $candidates | Where-Object { Test-PythonModules $_ $imports } | Select-Object -First 1
  if (-not $ready) {
    if ($candidates.Count -eq 0) {
      Install-PythonForUser
      $candidates = @(Get-PythonCandidates)
      if ($candidates.Count -eq 0) { throw 'python installed but not found' }
    }
    $exe = $candidates[0]
    Add-Note "  python: pip install $($pips -join ' ') -> $exe"
    $ErrorActionPreference = 'Continue'
    & $exe -m pip install --user --disable-pip-version-check --no-warn-script-location @pips 2>&1 | ForEach-Object { Write-Host "    $_" }
    $ErrorActionPreference = 'Stop'
    if (Test-PythonModules $exe $imports) { $ready = $exe } else { throw "pip install $($pips -join ' ') failed" }
  }
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  [System.IO.File]::WriteAllText($PythonPathMarker, $ready)
  Add-Note "  python ok: $ready"
}
#endregion

#region Illustrator menu (File > Scripts): launcher into Program Files, one UAC "Yes"
function Install-IllustratorMenu($m) {
  if (-not ($m.PSObject.Properties['illustratorScripts'] -and $m.illustratorScripts)) { return }
  $adobe = Join-Path $env:ProgramFiles 'Adobe'
  $scriptDirs = @()
  foreach ($app in @(Get-ChildItem -LiteralPath $adobe -Directory -Filter 'Adobe Illustrator *' -ErrorAction SilentlyContinue)) {
    $presets = Join-Path $app.FullName 'Presets'
    foreach ($loc in @(Get-ChildItem -LiteralPath $presets -Directory -ErrorAction SilentlyContinue)) {
      $scriptDirs += (Join-Path $loc.FullName 'Scripts')
    }
  }
  if ($scriptDirs.Count -eq 0) { Add-Note 'Illustrator menu: Illustrator not found, skipped'; return }

  $copies = @()
  foreach ($s in $m.illustratorScripts) {
    $dl = Join-Path $tmp ([string]$s.name)
    $uri = New-Object System.Uri(($base + '/kit/' + [string]$s.name))
    Invoke-WebRequest -Uri $uri -OutFile $dl -UseBasicParsing
    $hash = (Get-FileHash -LiteralPath $dl -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne ([string]$s.sha256).ToLowerInvariant()) { throw "SHA256 mismatch for $($s.name)" }
    foreach ($dir in $scriptDirs) {
      $dest = Join-Path $dir ([string]$s.menuName)
      if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant() -eq $hash)) { continue }
      $copies += [pscustomobject]@{ Src = $dl; Dest = $dest; Hash = $hash }
    }
  }
  if ($copies.Count -eq 0) { Add-Note 'Illustrator menu: up to date'; return }

  # Program Files пишется только с правами администратора: одно окно Windows "Разрешить?", дальше только при смене запускателя.
  $lines = @('$ErrorActionPreference = ''Stop''')
  foreach ($c in $copies) {
    $d = $c.Dest.Replace("'", "''"); $sp = $c.Src.Replace("'", "''")
    $lines += "New-Item -ItemType Directory -Force -Path (Split-Path -Parent '$d') | Out-Null"
    $lines += "Copy-Item -LiteralPath '$sp' -Destination '$d' -Force"
  }
  $elev = Join-Path $tmp 'install-illustrator-menu.ps1'
  [System.IO.File]::WriteAllText($elev, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding $true))
  Add-Note ("Illustrator menu: installing into {0} folder(s). Windows will ask for permission - click Yes." -f $copies.Count)
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$elev`"")
  $ok = 0
  foreach ($c in $copies) {
    if ((Test-Path -LiteralPath $c.Dest) -and ((Get-FileHash -LiteralPath $c.Dest -Algorithm SHA256).Hash.ToLowerInvariant() -eq $c.Hash)) {
      $ok++
      Add-Note ("  menu {0}" -f $c.Dest)
    } else {
      Add-Note ("  menu FAILED {0}" -f $c.Dest)
    }
  }
  if ($ok -eq 0) { throw "copy failed (exit $($p.ExitCode))" }
  Add-Note 'Illustrator menu ready: restart Illustrator, then File > Scripts > AIToInDesign.'
}
#endregion

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

  $subdir = if ($m.panelKitSubdir) { [string]$m.panelKitSubdir } elseif ($m.panelSubdir) { [string]$m.panelSubdir } else { 'Design Terminal Kit' }
  # Старые имена набора рядом с kit. Папку с прошлым именем (panelSubdir) апдейтер всё равно чистил под манифест.
  $legacySubdirs = @('DT Scripts GitHub Auto', 'Design Terminal Git')
  if ($m.panelSubdir) { $legacySubdirs += [string]$m.panelSubdir }
  Add-Note ("kitUpdatedAt={0}" -f $m.updatedAt)
  Add-Note ("panelSubdir={0}" -f $subdir)
  Add-Note ("technicalFolder={0}" -f $techFolder)
  Add-Note ("InDesign Version {0}: installing into {1} Scripts Panel folder(s)" -f $maxVer, $targets.Count)

  $downloaded = @{}
  foreach ($f in $m.files) {
    $dl = Join-Path $tmp $f.name
    Add-Note "  download $($f.id) -> $($f.name)"
    $fileUri = New-Object System.Uri(($base + '/kit/' + [string]$f.name))
    Invoke-WebRequest -Uri $fileUri -OutFile $dl -UseBasicParsing
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
    Add-Keep $keep '' $techFolder
    Add-Keep $keep $techFolder '_update-last.log'

    foreach ($f in $m.files) {
      $folder = Get-PanelFolder $f
      $destDir = if ($folder) { Join-Path $target $folder } else { $target }
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
      Copy-Item -LiteralPath $downloaded[$f.name] -Destination (Join-Path $destDir $f.name) -Force
      $destFile = Join-Path $destDir $f.name
      if (Test-Path -LiteralPath $destFile) {
        Add-Note ("  place {0}" -f $destFile)
      } else {
        Add-Note ("  PLACE-MISSING after copy: {0}" -f $destFile)
      }
      Add-Keep $keep $folder $f.name
      if ($folder) { Add-Keep $keep '' $folder }
    }

    $pub = @($m.files | Where-Object { $_.id -eq 'Publisher' -or $_.id -eq 'PublishTemplate' }) | Select-Object -First 1
    if ($pub -and $publisherToolDir) {
      $techDir = Join-Path $target $techFolder
      New-Item -ItemType Directory -Path $techDir -Force | Out-Null
      [System.IO.File]::WriteAllText((Join-Path $techDir 'tool-dir.txt'), $publisherToolDir)
      Add-Keep $keep $techFolder 'tool-dir.txt'
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
      if ((Test-Path -LiteralPath $legacyPath) -and ($legacy -ne $subdir) -and ($legacy -ne $techFolder)) {
        Remove-Item -LiteralPath $legacyPath -Recurse -Force
        Add-Note "Removed stray folder: $legacy"
      }
    }

    # Тот же мусор "0"/"1" внутри kit. Но только если корневые скрипты уже на месте:
    # у старого апдейтера живые скрипты могли лежать внутри "0"/"1", не сносим их,
    # пока в корне нет ни одного .jsx из манифеста.
    $rootJsx = 0
    foreach ($f in $m.files) {
      if (Test-WindowsOnly $f) { continue }
      if (Get-PanelFolder $f) { continue }
      if (Test-Path -LiteralPath (Join-Path $target $f.name)) {
        $rootJsx++
      } else {
        Add-Note ("  MISSING in root: {0}" -f $f.name)
      }
    }
    Add-Note ("  root jsx present: {0}" -f $rootJsx)
    foreach ($stray in @('0', '1')) {
      if ($stray -eq $subdir -or $stray -eq $techFolder) { continue }
      $strayPath = Join-Path $target $stray
      if (!(Test-Path -LiteralPath $strayPath)) { continue }
      if ($rootJsx -gt 0) {
        Remove-Item -LiteralPath $strayPath -Recurse -Force
        Add-Note "Removed stray subfolder: $stray"
      } else {
        Add-Note "  KEPT stray subfolder $stray (root has no kit scripts yet)"
      }
    }
  }

  # Python не валит обновление: скрипты уже стоят, без Python у AIToInDesign не будет только встроенных картинок.
  try {
    Ensure-KitPython $m.files
  } catch {
    Add-Note ("WARNING python: {0}" -f $_.Exception.Message)
    Add-Note 'AIToInDesign will skip images embedded in .ai until Python 3 + numpy is installed. Run this updater again or send the log.'
  }

  # Тоже не валит обновление: "Нет" в окне Windows или нет прав → AIToInDesign остаётся в панели InDesign.
  try {
    Install-IllustratorMenu $m
  } catch {
    Add-Note ("WARNING Illustrator menu: {0}" -f $_.Exception.Message)
    Add-Note 'AIToInDesign is still in InDesign Scripts panel (Design Terminal Kit > AI to InDesign). Run this updater again and click Yes to add it to Illustrator File > Scripts.'
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
        Where-Object { $_.Name -ne '_update-last.log' -and $_.Name -ne 'tool-dir.txt' } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
      Copy-Item -LiteralPath $logFile -Destination (Join-Path $tech '_update-last.log') -Force
    } catch {}
  }
  if (Test-Path -LiteralPath $logFile) {
    Write-Host "Log: $logFile"
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
