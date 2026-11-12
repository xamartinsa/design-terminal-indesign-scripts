param(
    [Parameter(Mandatory = $true)]
    [string]$Queue
)

$ErrorActionPreference = "Stop"
$queueFile = Get-Item -LiteralPath $Queue
$sessionDir = $queueFile.DirectoryName
$logFile = Join-Path $sessionDir "paste.log"

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date).ToString("HH:mm:ss"), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

if (-not ("A2I.Win" -as [type])) {
    Add-Type -Namespace A2I -Name Win -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
"@
}

# Буфер обмена: перед каждым копированием чистим его, а перед вставкой ждём, что Иллюстратор
# действительно что-то туда положил. Иначе InDesign вставляет прошлый объект (логотип на месте рамки и т.п.).
if (-not ("A2I.Clip" -as [type])) {
    Add-Type -Namespace A2I -Name Clip -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr hWndNewOwner);
[DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();
[DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
"@
}

function Clear-SystemClipboard {
    for ($try = 1; $try -le 10; $try++) {
        if ([A2I.Clip]::OpenClipboard([IntPtr]::Zero)) {
            try { [void][A2I.Clip]::EmptyClipboard() } finally { [void][A2I.Clip]::CloseClipboard() }
            return $true
        }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

function Wait-ClipboardChange([uint32]$Since, [int]$TimeoutMs) {
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ((Get-Date) -lt $deadline) {
        if ([A2I.Clip]::GetClipboardSequenceNumber() -ne $Since) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return ([A2I.Clip]::GetClipboardSequenceNumber() -ne $Since)
}

function Set-AppForeground([string]$ProcessName) {
    $proc = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }) | Select-Object -First 1
    if (-not $proc) {
        Write-Log ("no window " + $ProcessName)
        return
    }
    if ([A2I.Win]::IsIconic($proc.MainWindowHandle)) {
        [void][A2I.Win]::ShowWindow($proc.MainWindowHandle, 9)
    }
    [A2I.Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [A2I.Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    $ok = [A2I.Win]::SetForegroundWindow($proc.MainWindowHandle)
    Write-Log ("foreground " + $ProcessName + " " + $ok)
}

$copyScript = @'
(function () {
    var reqFile = new File("__REQ__");
    reqFile.encoding = "UTF-8";
    reqFile.open("r");
    var req = eval("(" + reqFile.read() + ")");
    reqFile.close();

    function findDocument(name) {
        var i;
        for (i = 0; i < app.documents.length; i++) {
            if (app.documents[i].name == name) return app.documents[i];
        }
        return null;
    }
    function findByUuid(doc, uuid) {
        if (!uuid) return null;
        var items = doc.pageItems;
        var i;
        for (i = 0; i < items.length; i++) {
            try {
                if (String(items[i].uuid) == String(uuid)) return items[i];
            } catch (e) {}
        }
        return null;
    }
    function hasText(item) {
        if (!item || !item.typename) return false;
        if (item.typename == "TextFrame") return true;
        if (item.typename != "GroupItem") return false;
        var i;
        for (i = 0; i < item.pageItems.length; i++) {
            if (hasText(item.pageItems[i])) return true;
        }
        return false;
    }
    function removeText(item) {
        if (!item || item.typename != "GroupItem") return;
        var i;
        for (i = item.pageItems.length - 1; i >= 0; i--) {
            var child = item.pageItems[i];
            if (child.typename == "TextFrame") {
                try { child.remove(); } catch (e) {}
            } else if (child.typename == "GroupItem") {
                removeText(child);
            }
        }
    }
    function removeLeftoverCopies(doc) {
        var found = [];
        var items = doc.pageItems;
        var i;
        for (i = 0; i < items.length; i++) {
            try {
                if (items[i].name == "__A2I_COPY__") found.push(items[i]);
            } catch (e) {}
        }
        for (i = 0; i < found.length; i++) {
            try { found[i].remove(); } catch (e2) {}
        }
    }
    function unlock(item) {
        var chain = [];
        var current = item;
        var guard = 0;
        while (current && current.typename && guard < 40) {
            chain.push(current);
            current = current.parent;
            guard++;
        }
        var i;
        for (i = chain.length - 1; i >= 0; i--) {
            try { if (chain[i].locked) chain[i].locked = false; } catch (e) {}
        }
    }

    var doc = findDocument(req.sourceDocument);
    if (!doc) return "NODOC";
    app.activeDocument = doc;
    removeLeftoverCopies(doc);
    var item = findByUuid(doc, req.sourceUuid);
    if (!item) {
        if (req.sourcePageItemIndex < 0 || req.sourcePageItemIndex >= doc.pageItems.length) return "NOITEM";
        item = doc.pageItems[req.sourcePageItemIndex];
    }
    if (!item) return "NOITEM";
    unlock(item);
    try { doc.selection = null; } catch (eSel) {}
    var target = item;
    if (item.typename == "GroupItem" && hasText(item)) {
        target = item.duplicate();
        try { target.name = "__A2I_COPY__"; } catch (eName) {}
        removeText(target);
    }

    function prefBool(key, fallback) {
        try { return app.preferences.getBooleanPreference(key); } catch (e) { return fallback; }
    }
    function prefInt(key, fallback) {
        try { return app.preferences.getIntegerPreference(key); } catch (e) { return fallback; }
    }
    function setBool(key, value) {
        try { app.preferences.setBooleanPreference(key, value); return true; } catch (e) { return false; }
    }
    function setInt(key, value) {
        try { app.preferences.setIntegerPreference(key, value); return true; } catch (e) { return false; }
    }
    function remember(file, key, type) {
        var value;
        try {
            value = type == "bool" ? app.preferences.getBooleanPreference(key) : app.preferences.getIntegerPreference(key);
        } catch (e) {
            return;
        }
        file.writeln(key + "\t" + type + "\t" + value);
    }

    var snap = new File("__SNAP__");
    if (!snap.exists) {
        snap.encoding = "UTF-8";
        snap.open("w");
        remember(snap, "plugin/FileClipboard/copyAsPDF", "bool");
        remember(snap, "FileClipboard/copyAsPDF", "bool");
        remember(snap, "plugin/FileClipboard/copyAsAICB", "bool");
        remember(snap, "FileClipboard/copyAsAICB", "bool");
        remember(snap, "plugin/FileClipboard/AICBOption", "int");
        remember(snap, "FileClipboard/AICBOption", "int");
        remember(snap, "plugin/FileClipboard/copySVGCBFormat", "bool");
        remember(snap, "FileClipboard/copySVGCBFormat", "bool");
        snap.close();
    }
    setBool("plugin/FileClipboard/copyAsPDF", false);
    setBool("FileClipboard/copyAsPDF", false);
    setInt("plugin/FileClipboard/copyAsPDF", 0);
    setInt("FileClipboard/copyAsPDF", 0);
    setBool("plugin/FileClipboard/copyAsAICB", true);
    setBool("FileClipboard/copyAsAICB", true);
    setInt("plugin/FileClipboard/copyAsAICB", 1);
    setInt("FileClipboard/copyAsAICB", 1);
    setInt("plugin/FileClipboard/AICBOption", 1);
    setInt("FileClipboard/AICBOption", 1);
    setBool("plugin/FileClipboard/copySVGCBFormat", false);
    setBool("FileClipboard/copySVGCBFormat", false);

    function prefOn(key) {
        try { if (app.preferences.getBooleanPreference(key)) return true; } catch (e) {}
        try { if (parseInt(app.preferences.getIntegerPreference(key), 10)) return true; } catch (e2) {}
        return false;
    }
    var pdfOn = prefOn("plugin/FileClipboard/copyAsPDF") || prefOn("FileClipboard/copyAsPDF");
    var aicbOn = prefOn("plugin/FileClipboard/copyAsAICB") || prefOn("FileClipboard/copyAsAICB");
    if (pdfOn || !aicbOn) {
        return "PREFS pdf=" + pdfOn + " aicb=" + aicbOn;
    }

    // AICB rasterizes any transparency, including transparent gradient stops. For the copy only,
    // make the stops opaque (the gradient swatch is shared, so restore right after the copy):
    // the shape arrives as a vector and InDesign rebuilds the gradient and its opacity natively.
    function gradientPath(it) {
        var p = it;
        if (p.typename == "CompoundPathItem") p = p.pathItems.length ? p.pathItems[0] : null;
        if (!p || p.typename != "PathItem" || !p.filled || p.fillColor.typename != "GradientColor") return null;
        return p;
    }
    function makeGradientOpaque(it) {
        var p = gradientPath(it);
        if (!p) return null;
        var gc = p.fillColor, g = gc.gradient, keep = [], k;
        for (k = 0; k < g.gradientStops.length; k++) {
            keep.push(g.gradientStops[k].opacity);
            g.gradientStops[k].opacity = 100;
        }
        p.fillColor = gc;
        return { path: p, keep: keep };
    }
    function restoreGradient(state) {
        if (!state) return;
        var gc = state.path.fillColor, g = gc.gradient, k;
        for (k = 0; k < state.keep.length && k < g.gradientStops.length; k++) {
            g.gradientStops[k].opacity = state.keep[k];
        }
        state.path.fillColor = gc;
    }
    var gradientState = null;
    if (req.opaqueGradient) {
        try { gradientState = makeGradientOpaque(target); } catch (eGrad) { gradientState = null; }
    }
    // Object opacity and blend mode: AICB would rasterize them (or drop the blend). Copy the object
    // opaque and normal; InDesign sets the same opacity and blend natively after the paste.
    var blendState = null;
    try {
        var keepOpacity = target.opacity;
        var keepBlend = target.blendingMode;
        if (keepOpacity < 100 || keepBlend != BlendModes.NORMAL) {
            blendState = { opacity: keepOpacity, blend: keepBlend };
            target.opacity = 100;
            target.blendingMode = BlendModes.NORMAL;
        }
    } catch (eBlend) { blendState = null; }
    try {
        target.selected = true;
        try { doc.selection = [target]; } catch (eSel2) {}
        var selectedCount = 0;
        try { selectedCount = doc.selection.length; } catch (eCount) {}
        if (!selectedCount) return "NOSEL";
        try { app.redraw(); } catch (eRedraw) {}
        var method = req.copyMethod || "menu";
        if (method == "api") {
            app.copy();
        } else {
            try {
                app.executeMenuCommand("copy");
            } catch (eMenu) {
                app.copy();
                method = "api-fallback " + eMenu.message;
            }
        }
        return "OK " + method + (gradientState ? " opaque-gradient" : "") + (blendState ? " opaque-blend" : "");
    } finally {
        try { restoreGradient(gradientState); } catch (eRestore) {}
        if (blendState) {
            try { target.opacity = blendState.opacity; } catch (eRestoreOpacity) {}
            try { target.blendingMode = blendState.blend; } catch (eRestoreBlend) {}
        }
    }
})();
'@

$restorePrefsScript = @'
(function () {
    var snap = new File("__SNAP__");
    if (!snap.exists) return "NOSNAP";
    snap.encoding = "UTF-8";
    snap.open("r");
    var text = snap.read();
    snap.close();
    if (text.length && text.charCodeAt(0) == 0xFEFF) text = text.substring(1);
    var lines = text.split(/\n/);
    var i;
    for (i = 0; i < lines.length; i++) {
        var parts = lines[i].replace(/^\s+|\s+$/g, "").split("\t");
        if (parts.length < 3 || !parts[0]) continue;
        try {
            if (parts[1] == "bool") {
                app.preferences.setBooleanPreference(parts[0], parts[2] == "true");
            } else {
                app.preferences.setIntegerPreference(parts[0], parseInt(parts[2], 10));
            }
        } catch (e) {}
    }
    try { snap.remove(); } catch (eRemove) {}
    return "RESTORED";
})();
'@

$pasteScript = @'
(function () {
    var reqFile = new File("__REQ__");
    reqFile.encoding = "UTF-8";
    reqFile.open("r");
    var req = eval("(" + reqFile.read() + ")");
    reqFile.close();

    var doc = null;
    var i;
    for (i = 0; i < app.documents.length; i++) {
        try {
            if (app.documents[i].extractLabel("AIToInDesignSession") == req.sessionId) {
                doc = app.documents[i];
                break;
            }
        } catch (e) {}
    }
    if (!doc) return "NODOC";
    app.activeDocument = doc;
    var page = doc.pages[0];
    try { app.activeWindow.activePage = page; } catch (ePage) {}
    try { app.activate(); } catch (eAct) {}
    try { app.selection = NothingEnum.NOTHING; } catch (eClear) {}
    $.sleep(400);

    var prevUi = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    var pasted = false;
    var lastError = "";
    var round;
    try {
        for (round = 1; round <= 4; round++) {
            try {
                app.paste();
                pasted = true;
            } catch (ePaste) {
                lastError = ePaste.message;
                try {
                    app.pasteInPlace();
                    pasted = true;
                } catch (ePlace) {
                    lastError = ePlace.message;
                    try {
                        var pasteAction = app.menuActions.item("$ID/Paste");
                        if (pasteAction.isValid && pasteAction.enabled) {
                            pasteAction.invoke();
                            pasted = true;
                        } else {
                            lastError = lastError + " menu=" + (pasteAction.isValid ? "disabled" : "missing");
                        }
                    } catch (eMenu) {
                        lastError = eMenu.message;
                    }
                }
            }
            if (pasted && app.selection && app.selection.length) break;
            pasted = false;
            if (!lastError) lastError = "EMPTY";
            $.sleep(500);
        }
    } finally {
        try { app.scriptPreferences.userInteractionLevel = prevUi; } catch (eUi) {}
    }
    if (!pasted) return "FAIL " + lastError;
    if (!app.selection || !app.selection.length) return "EMPTY";

    var item = app.selection[0];
    if (app.selection.length > 1) {
        try { item = page.groups.add(app.selection); } catch (eGroup) {}
    }
    var b = req.bounds;
    var expectRot = Number(req.rotation || 0);
    // Live effects (drop shadow, glow) come expanded, so the pasted object is the size of the
    // visible bounds, not of the path. Then place and check it by the visible bounds.
    var withEffects = false;
    try {
        var pre = item.geometricBounds;
        var pw = Math.abs(pre[3] - pre[1]);
        var ph = Math.abs(pre[2] - pre[0]);
        var vb = req.visibleBounds;
        if (vb && (Math.abs(pw - b.width) > 1 || Math.abs(ph - b.height) > 1) &&
            Math.abs(pw - vb.width) < 1 && Math.abs(ph - vb.height) < 1) {
            b = vb;
            withEffects = true;
        }
    } catch (eVisible) {}
    try {
        var current = item.geometricBounds;
        var rotNow = 0;
        try { rotNow = Number(item.rotationAngle || 0); } catch (eRot) {}
        if (Math.abs(expectRot) > 0.05 || Math.abs(rotNow) > 0.05) {
            var ccx = (current[1] + current[3]) / 2;
            var ccy = (current[0] + current[2]) / 2;
            item.move(undefined, [(b.x + b.width / 2) - ccx, (b.y + b.height / 2) - ccy]);
        } else {
            item.move(undefined, [b.x - current[1], b.y - current[0]]);
        }
    } catch (eMove) {
        return "MOVED_FAIL " + eMove.message;
    }
    clearEmptyStroke(item);
    try { item.label = "A2I:" + req.id; } catch (eLabel) {}
    try { if (req.name) item.name = String(req.name); } catch (eName) {}
    try {
        var groupList = req.groups;
        if (typeof groupList == "string") groupList = [groupList];
        if (groupList && groupList.length) item.insertLabel("a2iGroups", groupList.join(","));
    } catch (eGroups) {}
    applyBlend(item, req.opacity, req.blendMode);
    var after = item.geometricBounds;
    var ax = after[1];
    var ay = after[0];
    var aw = Math.abs(after[3] - after[1]);
    var ah = Math.abs(after[2] - after[0]);
    var rotAfter = 0;
    try { rotAfter = Number(item.rotationAngle || 0); } catch (eRot2) {}
    var worst;
    if (Math.abs(expectRot) > 0.05) {
        worst = Math.max(Math.abs(ax + aw / 2 - (b.x + b.width / 2)), Math.abs(ay + ah / 2 - (b.y + b.height / 2)));
        var dRot = Math.abs(rotAfter - expectRot) % 360;
        if (dRot > 180) dRot = 360 - dRot;
        if (worst > 0.5 || dRot > 0.5) return "OK MISMATCH center=" + worst + " rot=" + dRot;
        return "OK check center=" + worst + " rot=" + rotAfter;
    }
    worst = Math.max(Math.abs(ax - b.x), Math.abs(ay - b.y), Math.abs(aw - b.width), Math.abs(ah - b.height));
    // Size far off = a stale object from the clipboard was pasted. Remove it so it does not litter the layout.
    var sizeOff = Math.max(Math.abs(aw - b.width), Math.abs(ah - b.height));
    if (sizeOff > Math.max(5, 0.05 * Math.max(b.width, b.height))) {
        try { item.remove(); } catch (eRemove) {}
        return "WRONG removed size=" + aw + "x" + ah + " expected=" + b.width + "x" + b.height;
    }
    var effectNote = "";
    if (withEffects) {
        var hasPicture = false;
        try { hasPicture = item.allGraphics.length > 0; } catch (eGraphics) {}
        effectNote = hasPicture ? " effects-as-picture" : " effects-expanded";
    }
    if (worst > 0.5) return "OK MISMATCH d=" + worst + effectNote;
    return "OK check d=" + worst + effectNote;

    function applyBlend(target, opacity, blendName) {
        var names = {
            MULTIPLY: "MULTIPLY", SCREEN: "SCREEN", OVERLAY: "OVERLAY", SOFTLIGHT: "SOFT_LIGHT", HARDLIGHT: "HARD_LIGHT",
            COLORDODGE: "COLOR_DODGE", COLORBURN: "COLOR_BURN", DARKEN: "DARKEN", LIGHTEN: "LIGHTEN", DIFFERENCE: "DIFFERENCE",
            EXCLUSION: "EXCLUSION", HUE: "HUE", SATURATIONBLEND: "SATURATION", COLORBLEND: "COLOR", LUMINOSITY: "LUMINOSITY"
        };
        var key = String(blendName || "").toUpperCase().replace(/^.*\./, "");
        try {
            var bs = target.transparencySettings.blendingSettings;
            if (opacity !== null && opacity !== undefined && Number(opacity) < 100) bs.opacity = Number(opacity);
            if (names[key] && BlendMode[names[key]] !== undefined) bs.blendMode = BlendMode[names[key]];
        } catch (eBlendSet) {}
    }

    function clearEmptyStroke(root) {
        var list = [root];
        try {
            var nested = root.allPageItems;
            var n;
            for (n = 0; n < nested.length; n++) list.push(nested[n]);
        } catch (eNest) {}
        var i, it, colorName, weight;
        for (i = 0; i < list.length; i++) {
            it = list[i];
            colorName = "";
            weight = 0;
            try { colorName = String(it.strokeColor.name); } catch (eColor) {}
            try { weight = it.strokeWeight; } catch (eWeight) {}
            if (weight && (colorName == "None" || colorName == "")) {
                try { it.strokeWeight = 0; } catch (eZero) {}
                try { it.strokeColor = app.activeDocument.swatches.itemByName("None"); } catch (eNone) {}
            }
        }
    }
})();
'@

$cleanupScript = @'
(function () {
    function findDocument(name) {
        var i;
        for (i = 0; i < app.documents.length; i++) {
            if (app.documents[i].name == "__DOC__") return app.documents[i];
        }
        return null;
    }
    var doc = findDocument("__DOC__");
    if (!doc) return "NODOC";
    var found = [];
    var items = doc.pageItems;
    var i;
    for (i = 0; i < items.length; i++) {
        try { if (items[i].name == "__A2I_COPY__") found.push(items[i]); } catch (e) {}
    }
    for (i = 0; i < found.length; i++) {
        try { found[i].remove(); } catch (e2) {}
    }
    try { doc.selection = null; } catch (e3) {}
    return "OK";
})();
'@

function Get-ComApp([string[]]$ProgIds) {
    foreach ($progId in $ProgIds) {
        try {
            return [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
        } catch {}
    }
    foreach ($progId in $ProgIds) {
        try {
            return New-Object -ComObject $progId
        } catch {}
    }
    throw ("COM недоступен: " + ($ProgIds -join ", "))
}

$script:AiApp = $null
$script:RestoreCode = $null
function Restore-ClipboardPrefs {
    if (-not $script:AiApp -or -not $script:RestoreCode) { return }
    try {
        $restored = $script:AiApp.DoJavaScript($script:RestoreCode)
        Write-Log ("prefs " + $restored)
    } catch {
        Write-Log ("prefs restore failed " + $_.Exception.Message)
    }
    $script:RestoreCode = $null
}

try {
    Write-Log "start aicb"
    Start-Sleep -Seconds 3
    $queueText = Get-Content -LiteralPath $Queue -Raw -Encoding UTF8
    $job = $queueText | ConvertFrom-Json
    $ai = Get-ComApp @("Illustrator.Application", "Illustrator.Application.30")
    $script:AiApp = $ai
    $id = Get-ComApp @("InDesign.Application.2026", "InDesign.Application")
    Write-Log ("COM connected doc=" + $job.sourceDocument)
    $reqPath = Join-Path $sessionDir "current-vector.json"
    $snapPath = Join-Path $sessionDir "clipboard-prefs-snapshot.txt"
    $snapJs = ($snapPath -replace '\\', '/')
    $copyTemplate = $copyScript.Replace("__SNAP__", $snapJs)
    $script:RestoreCode = $restorePrefsScript.Replace("__SNAP__", $snapJs)
    $vectors = @($job.vectors)
    $actions = @($job.actions)
    Write-Log ("vectors=" + $vectors.Count + " actions=" + $actions.Count)

    function Invoke-VectorStep($vector, [int]$index) {
        $pastedThis = $false
        foreach ($method in @("menu", "api")) {
            $req = [ordered]@{
                id = [string]$vector.id
                opaqueGradient = [bool]$vector.opaqueGradient
                sourceDocument = [string]$job.sourceDocument
                sessionId = [string]$job.sessionId
                sourceUuid = [string]$vector.sourceUuid
                sourcePageItemIndex = [int]$vector.sourcePageItemIndex
                bounds = $vector.bounds
                visibleBounds = $vector.visibleBounds
                rotation = $vector.rotation
                opacity = $vector.opacity
                blendMode = $vector.blendMode
                name = [string]$vector.name
                groups = @($vector.groups | Where-Object { $_ })
                copyMethod = $method
            }
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($reqPath, ($req | ConvertTo-Json -Depth 6), $utf8)
            $reqJs = ($reqPath -replace '\\', '/')
            $cleared = Clear-SystemClipboard
            $clipSeq = [A2I.Clip]::GetClipboardSequenceNumber()
            Set-AppForeground "Illustrator"
            Start-Sleep -Milliseconds 300
            Write-Log ("copy {0}/{1} {2} {3}" -f $index, $vectors.Count, $vector.sourceType, $method)
            $copyCode = $copyTemplate.Replace("__REQ__", $reqJs)
            try {
                $copyResult = $ai.DoJavaScript($copyCode)
            } catch {
                $copyResult = "FAIL " + $_.Exception.Message
            }
            Write-Log ("copy result " + $copyResult)
            if ([string]$copyResult -notlike "OK*") {
                Write-Log "skip paste, copy failed"
                break
            }
            Start-Sleep -Milliseconds 700
            Set-AppForeground "InDesign"
            if (-not (Wait-ClipboardChange $clipSeq 3000)) {
                Write-Log ("clipboard empty after copy (cleared=" + $cleared + "), skip paste")
                continue
            }
            $pasteCode = $pasteScript.Replace("__REQ__", $reqJs)
            Write-Log ("paste {0}" -f $index)
            try {
                $pasteResult = $id.DoScript($pasteCode, 1246973031)
            } catch {
                $pasteResult = "FAIL " + $_.Exception.Message
            }
            Write-Log ("paste result " + $pasteResult)
            if ([string]$pasteResult -like "OK*") {
                $pastedThis = $true
                break
            }
        }
        if (-not $pastedThis) {
            Write-Log ("vector {0} not pasted" -f $index)
        }
    }

    function Invoke-ActionStep([string]$actionPath, [int]$step) {
        if (-not $actionPath) { return }
        Write-Log ("action {0}/{1} {2}" -f $step, $actions.Count, $actionPath)
        $evalPath = ([string]$actionPath) -replace '\\', '/'
        $evalCode = '$.evalFile("' + ($evalPath -replace '"', '\"') + '");'
        try {
            $actionResult = $id.DoScript($evalCode, 1246973031)
            if ($null -eq $actionResult) {
                Write-Log "action result <null>"
            } else {
                Write-Log ("action result " + [string]$actionResult)
            }
        } catch {
            $ex = $_.Exception
            Write-Log ("action failed " + $ex.GetType().FullName + " :: " + $ex.Message)
            if ($ex.InnerException) {
                Write-Log ("action inner " + $ex.InnerException.GetType().FullName + " :: " + $ex.InnerException.Message)
            }
        }
    }

    # One queue, bottom to top, exactly as stacked in Illustrator: every new object lands on top in InDesign.
    $steps = @()
    if ($job.steps) { $steps = @($job.steps) }
    if (-not $steps.Count) {
        for ($n = 0; $n -lt $vectors.Count; $n++) { $steps += [pscustomobject]@{ kind = "vector"; index = $n } }
        for ($n = 0; $n -lt $actions.Count; $n++) { $steps += [pscustomobject]@{ kind = "action"; index = $n } }
        Write-Log "queue has no steps, old order: vectors first"
    }
    $vectorNo = 0
    $actionNo = 0
    foreach ($queued in $steps) {
        if ($queued.kind -eq "vector") {
            $vectorNo++
            Invoke-VectorStep $vectors[[int]$queued.index] $vectorNo
        } elseif ($queued.kind -eq "action") {
            $actionNo++
            Invoke-ActionStep ([string]$actions[[int]$queued.index]) $actionNo
        }
    }

    $docJs = ([string]$job.sourceDocument).Replace("\", "\\").Replace("'", "\'")
    $cleanupCode = $cleanupScript.Replace("__DOC__", $docJs)
    try {
        $cleanupResult = $ai.DoJavaScript($cleanupCode)
        Write-Log ("cleanup " + $cleanupResult)
    } catch {
        Write-Log ("cleanup failed " + $_.Exception.Message)
    }

    if ($job.referenceJpeg) {
        $refPath = ([string]$job.referenceJpeg) -replace '\\', '/'
        $logJs = (($sessionDir -replace '\\', '/') + "/indesign.log")
        $refCode = @"
(function () {
    var doc = null;
    var i;
    for (i = 0; i < app.documents.length; i++) {
        try {
            if (app.documents[i].extractLabel('AIToInDesignSession') == '$($job.sessionId)') doc = app.documents[i];
        } catch (e) {}
    }
    if (!doc) return 'NODOC';
    app.activeDocument = doc;
    var page = doc.pages[0];
    var file = new File('$refPath');
    if (!file.exists) return 'NOFILE';
    var logFile = new File('$logJs');
    function note(message) {
        try {
            logFile.encoding = 'UTF-8';
            logFile.open('a');
            logFile.writeln('[' + new Date().toUTCString() + '][InDesign] ' + message);
            logFile.close();
        } catch (eNote) {}
    }
    function layerNamed(name) {
        var layer = doc.layers.itemByName(name);
        try { if (layer.isValid) return layer; } catch (e) {}
        return doc.layers.add({ name: name });
    }
    function placeOn(layer, blendName, rectName) {
        try { layer.locked = false; layer.visible = true; } catch (eUnlock) {}
        try { layer.move(LocationOptions.AT_BEGINNING); } catch (eMove) {}
        try { layer.printable = true; } catch (ePrint) {}
        var none = doc.swatches.itemByName('None');
        var rect = page.rectangles.add({ itemLayer: layer });
        var pageH = doc.documentPreferences.pageHeight;
        var pageW = doc.documentPreferences.pageWidth;
        rect.geometricBounds = [0, 0, pageH, pageW];
        rect.strokeWeight = 0;
        rect.strokeColor = none;
        rect.fillColor = none;
        rect.place(file);
        try { rect.fit(FitOptions.FILL_PROPORTIONALLY); } catch (eFit) {}
        try { rect.fit(FitOptions.CENTER_CONTENT); } catch (eFit2) {}
        try {
            var graphic = rect.allGraphics && rect.allGraphics.length ? rect.allGraphics[0] : null;
            if (graphic && DisplaySettingOptions.HIGH_QUALITY !== undefined) {
                graphic.localDisplaySetting = DisplaySettingOptions.HIGH_QUALITY;
            }
        } catch (eDisp) {}
        rect.name = rectName;
        rect.transparencySettings.blendingSettings.blendMode = blendName == 'MULTIPLY' ? BlendMode.MULTIPLY : BlendMode.NORMAL;
        rect.transparencySettings.blendingSettings.opacity = 100;
        var gb = rect.geometricBounds;
        var worst = Math.max(Math.abs(gb[0]), Math.abs(gb[1]), Math.abs(gb[2] - pageH), Math.abs(gb[3] - pageW));
        if (worst > 0.5) note('[Mismatch] ' + rectName + ' dmax=' + worst + 'mm');
        else note('[Check] ' + rectName + ' OK dmax=' + worst + 'mm');
        try { rect.bringToFront(); } catch (eFront) {}
        rect.locked = true;
        layer.visible = false;
        layer.locked = true;
    }
    placeOn(layerNamed('Illustrator Reference'), 'NORMAL', 'Illustrator Reference');
    placeOn(layerNamed('Illustrator Reference Multiply'), 'MULTIPLY', 'Illustrator Reference Multiply');
    note('Reference overlay: layers Illustrator Reference and Illustrator Reference Multiply are off and locked. Turn one on to compare.');
    return 'OK';
})();
"@
        try {
            $refResult = $id.DoScript($refCode, 1246973031)
            Write-Log ("reference " + $refResult)
        } catch {
            Write-Log ("reference failed " + $_.Exception.Message)
        }
    }
    Restore-ClipboardPrefs
    Write-Log "done"
} catch {
    Write-Log ("ERROR " + $_.Exception.Message)
    Restore-ClipboardPrefs
    exit 1
}
