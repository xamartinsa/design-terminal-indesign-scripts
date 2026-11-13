// AIToInDesign, macOS: the vector copy queue (Illustrator -> clipboard -> InDesign).
// Mac twin of paste-vectors.ps1. Same copy-queue.json, same paste.log next to it.
//
// Run: /usr/bin/osascript -l JavaScript paste-vectors-mac.js /path/to/copy-queue.json
// AIToInDesign.jsx starts it in the background through InDesign ("do shell script"),
// so macOS asks "Adobe InDesign wants to control Adobe Illustrator" once: answer OK.
//
// The ExtendScript steps that run inside Illustrator and InDesign ($copyScript, $restorePrefsScript,
// $pasteScript, $cleanupScript, $refCode) are NOT duplicated here: they are read from
// paste-vectors.ps1 next to this file. One copy of that code for both systems.
// Keep their PowerShell form in the .ps1: $name = @' ... '@ (and $refCode = @" ... "@).
//
// Windows talks to the apps through COM (DoJavaScript / DoScript). Here: AppleScript
// "do javascript" (Illustrator) and "do script ... language javascript" (InDesign) via osascript.
// Clipboard: NSPasteboard changeCount instead of GetClipboardSequenceNumber.
// ASCII only in this file: osascript must not depend on the file encoding.

ObjC.import("Foundation");
ObjC.import("AppKit");

var ILLUSTRATOR_ID = "com.adobe.illustrator";
var INDESIGN_ID = "com.adobe.InDesign";

var sys = Application.currentApplication();
sys.includeStandardAdditions = true;

var logPath = "";

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function readText(path) {
    var str = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
    if (!str || str.isNil()) throw new Error("cannot read " + path);
    var text = str.js;
    if (text.length && text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    return text;
}

function writeText(path, text, withBom) {
    var body = (withBom ? "\uFEFF" : "") + text;
    var ok = $(body).writeToFileAtomicallyEncodingError($(path), false, $.NSUTF8StringEncoding, null);
    if (!ok) throw new Error("cannot write " + path);
}

function log(message) {
    var now = new Date();
    var line = "[" + pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds()) + "] " + message + "\n";
    try {
        var fm = $.NSFileManager.defaultManager;
        if (!fm.fileExistsAtPath($(logPath))) {
            writeText(logPath, line, false);
            return;
        }
        var fh = $.NSFileHandle.fileHandleForWritingAtPath($(logPath));
        fh.seekToEndOfFile;
        fh.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding));
        fh.closeFile;
    } catch (e) {}
}

function sleepMs(ms) { delay(ms / 1000); }

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function asString(value) {
    return "\"" + String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
}

// AppleScript through osascript: errors come back as JS exceptions with the AppleScript message.
function runAppleScript(source) {
    var lines = source.split("\n");
    var cmd = "/usr/bin/osascript";
    for (var i = 0; i < lines.length; i++) cmd += " -e " + shellQuote(lines[i]);
    return String(sys.doShellScript(cmd, { alteringLineEndings: false })).replace(/\n+$/, "");
}

function evalInIllustrator(jsxPath) {
    var js = "$.evalFile(new File(" + JSON.stringify(jsxPath) + "))";
    return runAppleScript(
        "with timeout of 600 seconds\n" +
        "tell application id " + asString(ILLUSTRATOR_ID) + " to do javascript " + asString(js) + "\n" +
        "end timeout");
}

function evalInInDesign(jsxPath) {
    var js = "$.evalFile(new File(" + JSON.stringify(jsxPath) + "))";
    return runAppleScript(
        "with timeout of 600 seconds\n" +
        "tell application id " + asString(INDESIGN_ID) + " to do script " + asString(js) + " language javascript\n" +
        "end timeout");
}

// Brings the app to the front (Windows: SetForegroundWindow). Illustrator hands its copy over
// to the system clipboard reliably only when it is the active app and then loses focus.
function activate(bundleId, label) {
    try {
        runAppleScript("tell application id " + asString(bundleId) + " to activate");
        log("foreground " + label + " True");
    } catch (e) {
        log("foreground " + label + " False " + e.message);
    }
}

function pasteboard() { return $.NSPasteboard.generalPasteboard; }

function clipboardCount() { return Number(pasteboard().changeCount); }

function clearClipboard() {
    try {
        pasteboard().clearContents;
        return true;
    } catch (e) {
        return false;
    }
}

function waitClipboardChange(since, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (clipboardCount() !== since) return true;
        sleepMs(100);
    }
    return clipboardCount() !== since;
}

// Pulls a here-string body out of paste-vectors.ps1: $name = @'<newline>...<newline>'@
function hereString(ps1, name, quote) {
    var q = quote || "'";
    var start = ps1.indexOf("$" + name + " = @" + q);
    if (start < 0) throw new Error("paste-vectors.ps1: $" + name + " not found");
    var bodyStart = ps1.indexOf("\n", start) + 1;
    var end = ps1.indexOf("\n" + q + "@", bodyStart);
    if (bodyStart <= 0 || end < 0) throw new Error("paste-vectors.ps1: $" + name + " has no end");
    return ps1.substring(bodyStart, end).replace(/\r$/, "");
}

function dirname(path) { return String(path).replace(/\/[^\/]*$/, ""); }

function run(argv) {
    var queuePath = argv && argv.length ? String(argv[0]) : "";
    if (!queuePath) return "usage: osascript -l JavaScript paste-vectors-mac.js /path/copy-queue.json";
    var sessionDir = dirname(queuePath);
    logPath = sessionDir + "/paste.log";

    var restoreReady = false;
    var restorePath = sessionDir + "/mac-ai-restore-prefs.jsx";
    function restorePrefs() {
        if (!restoreReady) return;
        restoreReady = false;
        try {
            log("prefs " + evalInIllustrator(restorePath));
        } catch (e) {
            log("prefs restore failed " + e.message);
        }
    }

    try {
        log("start aicb (mac)");
        sleepMs(3000);
        var job;
        var queueText = readText(queuePath);
        try { job = JSON.parse(queueText); } catch (eJson) { job = eval("(" + queueText + ")"); }

        var ps1Path = sessionDir + "/paste-vectors.ps1";
        var ps1 = readText(ps1Path).replace(/\r\n/g, "\n");
        var copyScript = hereString(ps1, "copyScript");
        var restorePrefsScript = hereString(ps1, "restorePrefsScript");
        var pasteScript = hereString(ps1, "pasteScript");
        var cleanupScript = hereString(ps1, "cleanupScript");
        var refScript = hereString(ps1, "refCode", "\"");

        var reqPath = sessionDir + "/current-vector.json";
        var snapPath = sessionDir + "/clipboard-prefs-snapshot.txt";
        var copyPath = sessionDir + "/mac-ai-copy.jsx";
        var pastePath = sessionDir + "/mac-id-paste.jsx";
        writeText(copyPath, copyScript.split("__SNAP__").join(snapPath).split("__REQ__").join(reqPath), true);
        writeText(restorePath, restorePrefsScript.split("__SNAP__").join(snapPath), true);
        restoreReady = true;
        writeText(pastePath, pasteScript.split("__REQ__").join(reqPath), true);

        var vectors = job.vectors || [];
        var actions = job.actions || [];
        log("apps connected doc=" + job.sourceDocument);
        log("vectors=" + vectors.length + " actions=" + actions.length);

        // Bounds of the last pasted vector: a paste of exactly that size is the previous object again.
        var prevBounds = null;
        function vectorStep(vector, index) {
            var pastedThis = false;
            // Third try: same copy, longer wait before InDesign takes the clipboard.
            var methods = ["menu", "api", "api"];
            var waits = [700, 700, 2000];
            for (var m = 0; m < methods.length; m++) {
                var method = methods[m];
                var groups = [];
                var rawGroups = vector.groups;
                if (typeof rawGroups === "string") rawGroups = [rawGroups];
                for (var g = 0; rawGroups && g < rawGroups.length; g++) if (rawGroups[g]) groups.push(rawGroups[g]);
                var req = {
                    id: String(vector.id),
                    opaqueGradient: !!vector.opaqueGradient,
                    stripEffect: !!vector.stripEffect,
                    sourceDocument: String(job.sourceDocument),
                    sessionId: String(job.sessionId),
                    sourceUuid: vector.sourceUuid === undefined || vector.sourceUuid === null ? "" : String(vector.sourceUuid),
                    sourcePageItemIndex: parseInt(vector.sourcePageItemIndex, 10) || 0,
                    bounds: vector.bounds,
                    visibleBounds: vector.visibleBounds,
                    rotation: vector.rotation,
                    opacity: vector.opacity,
                    blendMode: vector.blendMode,
                    name: vector.name === undefined || vector.name === null ? "" : String(vector.name),
                    groups: groups,
                    copyMethod: method,
                    prevBounds: prevBounds
                };
                writeText(reqPath, JSON.stringify(req, null, 2), false);
                var cleared = clearClipboard();
                var clipCount = clipboardCount();
                activate(ILLUSTRATOR_ID, "Illustrator");
                sleepMs(300);
                log("copy " + index + "/" + vectors.length + " " + vector.sourceType + " " + method);
                var copyResult;
                try {
                    copyResult = evalInIllustrator(copyPath);
                } catch (eCopy) {
                    copyResult = "FAIL " + eCopy.message;
                }
                log("copy result " + copyResult);
                if (String(copyResult).indexOf("OK") !== 0) {
                    log("skip paste, copy failed");
                    break;
                }
                sleepMs(waits[m]);
                activate(INDESIGN_ID, "InDesign");
                if (!waitClipboardChange(clipCount, 3000)) {
                    log("clipboard empty after copy (cleared=" + cleared + "), skip paste");
                    continue;
                }
                log("paste " + index);
                var pasteResult;
                try {
                    pasteResult = evalInInDesign(pastePath);
                } catch (ePaste) {
                    pasteResult = "FAIL " + ePaste.message;
                }
                log("paste result " + pasteResult);
                if (String(pasteResult).indexOf("OK") === 0) {
                    pastedThis = true;
                    prevBounds = vector.bounds || null;
                    break;
                }
            }
            if (!pastedThis) log("vector " + index + " not pasted");
        }

        function actionStep(actionPath, step) {
            if (!actionPath) return;
            log("action " + step + "/" + actions.length + " " + actionPath);
            try {
                var result = evalInInDesign(String(actionPath));
                log("action result " + (result === "" ? "<null>" : result));
            } catch (eAction) {
                log("action failed " + eAction.message);
            }
        }

        // One queue, bottom to top, as stacked in Illustrator: every new object lands on top in InDesign.
        var steps = job.steps || [];
        if (!steps.length) {
            for (var n = 0; n < vectors.length; n++) steps.push({ kind: "vector", index: n });
            for (n = 0; n < actions.length; n++) steps.push({ kind: "action", index: n });
            log("queue has no steps, old order: vectors first");
        }
        var vectorNo = 0;
        var actionNo = 0;
        for (var s = 0; s < steps.length; s++) {
            var queued = steps[s];
            if (queued.kind === "vector") {
                vectorNo++;
                vectorStep(vectors[parseInt(queued.index, 10)], vectorNo);
            } else if (queued.kind === "action") {
                actionNo++;
                actionStep(actions[parseInt(queued.index, 10)], actionNo);
            }
        }

        var docLiteral = JSON.stringify(String(job.sourceDocument)).slice(1, -1);
        var cleanupPath = sessionDir + "/mac-ai-cleanup.jsx";
        writeText(cleanupPath, cleanupScript.split("__DOC__").join(docLiteral), true);
        try {
            log("cleanup " + evalInIllustrator(cleanupPath));
        } catch (eCleanup) {
            log("cleanup failed " + eCleanup.message);
        }

        if (job.referenceJpeg) {
            // $refCode in the .ps1 is a PowerShell "..." here-string: fill in its three variables.
            var refCode = refScript
                .split("$($job.sessionId)").join(String(job.sessionId).replace(/\\/g, "\\\\").replace(/'/g, "\\'"))
                .split("$refPath").join(String(job.referenceJpeg).replace(/\\/g, "\\\\").replace(/'/g, "\\'"))
                .split("$logJs").join((sessionDir + "/indesign.log").replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
            var refPath = sessionDir + "/mac-id-reference.jsx";
            writeText(refPath, refCode, true);
            try {
                log("reference " + evalInInDesign(refPath));
            } catch (eRef) {
                log("reference failed " + eRef.message);
            }
        }
        restorePrefs();
        log("done");
        return "done";
    } catch (e) {
        log("ERROR " + (e && e.message ? e.message : String(e)));
        restorePrefs();
        throw e;
    }
}
