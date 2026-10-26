#target "indesign"

// Syncer-1.2.jsx
// Синкер: картинки в Links + шрифты в Document fonts рядом с INDD.
// Relink картинкам; шрифтам relink не нужен — InDesign берёт по имени.
// 1.1: встроенный QR не ошибка; шрифты из Windows Fonts копирует запасным путём;
// один variable-файл не пытается копировать по разу на каждое начертание.
// 1.2: журнал прогона (каждый линк from → to, удаления, одинаковые имена).
// Пишет рядом с INDD «имя.syncer.log» и в %LOCALAPPDATA%\DesignTerminal\syncer.log
// (Mac: ~/Library/Logs/DesignTerminal/syncer.log). Файлы *.log в Links не удаляет.

(function () {
    if (app.documents.length === 0) {
        alert("Нет открытых документов.");
        return;
    }

    var doc = app.activeDocument;
    var docFile;
    try {
        if (!doc.saved) {
            alert("Сначала сохрани документ.");
            return;
        }
        docFile = doc.fullName;
    } catch (eSaved) {
        alert("Сначала сохрани документ.");
        return;
    }

    var docFolder = docFile.parent;
    var runLog = [];

    function note(line) {
        runLog.push(String(line));
    }

    function stamp() {
        var d = new Date();
        function z(n) { return (n < 10 ? "0" : "") + n; }
        return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) +
            " " + z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds());
    }

    function linkStatusName(link) {
        try {
            if (link.status === LinkStatus.LINK_EMBEDDED) return "embedded";
            if (link.status === LinkStatus.LINK_MISSING) return "missing";
            if (link.status === LinkStatus.LINK_INACCESSIBLE) return "inaccessible";
            if (link.status === LinkStatus.LINK_OUT_OF_DATE) return "out-of-date";
            if (link.status === LinkStatus.NORMAL) return "normal";
        } catch (eStName) {}
        return "unknown";
    }

    function logsFolder() {
        var dir = null;
        try {
            var local = $.getenv("LOCALAPPDATA");
            if (local) dir = new Folder(local + "/DesignTerminal");
        } catch (eLocal) {}
        if (!dir) {
            try {
                var home = $.getenv("HOME");
                if (!home) home = $.getenv("USERPROFILE");
                if (home) dir = new Folder(home + "/Library/Logs/DesignTerminal");
            } catch (eHome) {}
        }
        if (!dir) return null;
        try {
            if (!dir.exists) dir.create();
        } catch (eMk) {}
        try {
            if (dir.exists) return dir;
        } catch (eEx) {}
        return null;
    }

    function appendTextFile(file, text) {
        var existed = false;
        try { existed = file.exists && file.length > 0; } catch (eEx) {}
        file.encoding = "UTF-8";
        if (!file.open("a")) return false;
        try {
            if (!existed) file.write("\uFEFF");
            file.write(text);
        } finally {
            try { file.close(); } catch (eCl) {}
        }
        return true;
    }

    function flushRunLog() {
        if (!runLog.length) return;
        var text = runLog.join("\r\n") + "\r\n\r\n";
        var targets = [];
        try {
            var base = decodeURI(docFile.name).replace(/\.indd$/i, "");
            targets.push(new File(docFolder.fsName + "/" + base + ".syncer.log"));
        } catch (eDocLog) {}
        try {
            var dir = logsFolder();
            if (dir) targets.push(new File(dir.fsName + "/syncer.log"));
        } catch (eDirLog) {}
        var t;
        for (t = 0; t < targets.length; t++) {
            appendTextFile(targets[t], text);
        }
    }

    function normalizePath(path) {
        return decodeURI(String(path)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    }

    function fileNameOf(fileObj) {
        return decodeURI(fileObj.name);
    }

    function fileSizeOf(fileObj) {
        try {
            if (fileObj && fileObj.exists) {
                return fileObj.length;
            }
        } catch (eLen) {}
        return 0;
    }

    function shouldSkipCleanup(name) {
        if (name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini") {
            return true;
        }
        if (name.indexOf("._") === 0) {
            return true;
        }
        if (name.indexOf("AdobeFnt") === 0) {
            return true;
        }
        if (name.length >= 4 && name.substring(name.length - 4).toLowerCase() === ".log") {
            return true;
        }
        return false;
    }

    function ensureFolder(folder) {
        if (folder.exists) {
            return true;
        }
        folder.create();
        return folder.exists;
    }

    function isInsideFolder(filePath, folderPath) {
        var f = normalizePath(filePath);
        var d = normalizePath(folderPath);
        return f === d || f.indexOf(d + "/") === 0;
    }

    function saveIfDirty() {
        try {
            if (doc && doc.isValid && doc.modified) {
                doc.save();
            }
        } catch (eSave) {}
    }

    function isEmbeddedLink(link) {
        try {
            if (link.status === LinkStatus.LINK_EMBEDDED) {
                return true;
            }
        } catch (eSt) {}
        return false;
    }

    function errorLooksEmbedded(err) {
        var msg = String(err).toLowerCase();
        return msg.indexOf("embed") >= 0;
    }

    function tryNativeCopy(src, destPath) {
        var dest = new File(destPath);
        try {
            if (src.copy(destPath) && fileSizeOf(dest) > 0) {
                return true;
            }
        } catch (eCopy) {}
        return false;
    }

    function tryBinaryCopy(src, destPath) {
        var dest = new File(destPath);
        try {
            src.encoding = "BINARY";
            if (!src.open("r")) {
                return false;
            }
            var data = src.read();
            src.close();
            if (!data || data.length === 0) {
                return false;
            }
            dest.encoding = "BINARY";
            if (!dest.open("w")) {
                return false;
            }
            dest.write(data);
            dest.close();
            return fileSizeOf(dest) > 0;
        } catch (eBin) {
            try { src.close(); } catch (eC1) {}
            try { dest.close(); } catch (eC2) {}
            return false;
        }
    }

    function tryCmdCopy(src, destPath) {
        try {
            var dest = new File(destPath);
            var sh = new ActiveXObject("WScript.Shell");
            var cmd = "cmd.exe /c copy /Y \"" + src.fsName + "\" \"" + dest.fsName + "\"";
            sh.Run(cmd, 0, true);
            return fileSizeOf(dest) > 0;
        } catch (eCmd) {
            return false;
        }
    }

    function copyOneFile(src, destPath) {
        var dest = new File(destPath);
        try {
            if (dest.exists && fileSizeOf(dest) === 0) {
                dest.remove();
            }
        } catch (eZero) {}
        if (tryNativeCopy(src, destPath)) {
            return true;
        }
        if (tryBinaryCopy(src, destPath)) {
            return true;
        }
        if (tryCmdCopy(src, destPath)) {
            return true;
        }
        return false;
    }

    function fontFileCandidates(src) {
        var list = [src];
        var seen = {};
        seen[normalizePath(src.fsName)] = true;
        var name = fileNameOf(src);
        var extraPaths = [];
        try {
            extraPaths.push($.getenv("LOCALAPPDATA") + "/Microsoft/Windows/Fonts/" + name);
        } catch (eUser) {}
        try {
            extraPaths.push($.getenv("WINDIR") + "/Fonts/" + name);
        } catch (eWin) {}
        var i;
        for (i = 0; i < extraPaths.length; i++) {
            if (!extraPaths[i]) {
                continue;
            }
            var extra = new File(extraPaths[i]);
            try {
                if (!extra.exists) {
                    continue;
                }
                var key = normalizePath(extra.fsName);
                if (seen[key]) {
                    continue;
                }
                seen[key] = true;
                list.push(extra);
            } catch (eEx) {}
        }
        return list;
    }

    function copyFileRobust(src, destPath) {
        var candidates = fontFileCandidates(src);
        var i;
        for (i = 0; i < candidates.length; i++) {
            if (copyOneFile(candidates[i], destPath)) {
                return true;
            }
        }
        return false;
    }

    var linkCopied = 0;
    var linkRemoved = 0;
    var linkErrors = [];
    var linkMissing = [];

    function noteLinkCollisions() {
        var groups = {};
        var order = [];
        var i;
        for (i = 0; i < doc.links.length; i++) {
            var link = doc.links[i];
            if (isEmbeddedLink(link)) continue;
            var name = "";
            try { name = decodeURI(link.name); } catch (eN) { name = ""; }
            if (!name) continue;
            var key = name.toLowerCase();
            var path = "";
            try { path = String(link.filePath); } catch (eP) { path = "(no path)"; }
            if (!groups[key]) {
                groups[key] = [];
                order.push(key);
            }
            groups[key].push(name + " | " + path);
        }
        for (i = 0; i < order.length; i++) {
            var list = groups[order[i]];
            if (list.length < 2) continue;
            note("COLLISION same name x" + list.length);
            var j;
            for (j = 0; j < list.length; j++) note("  " + list[j]);
        }
    }

    function noteLinksAfter() {
        note("after");
        var i;
        try {
            for (i = 0; i < doc.links.length; i++) {
                var link = doc.links[i];
                var name = "";
                try { name = decodeURI(link.name); } catch (eN) { name = "?"; }
                var path = "";
                try { path = String(link.filePath); } catch (eP) { path = linkStatusName(link); }
                note("  " + name + " -> " + path);
            }
        } catch (eAfter) {
            note("after failed " + eAfter);
        }
    }

    function syncLinks() {
        var linksFolder = new Folder(docFolder.fsName + "/Links");
        if (!ensureFolder(linksFolder)) {
            linkErrors.push("не удалось создать папку Links");
            note("ERROR Links folder");
            return;
        }

        noteLinkCollisions();

        var usedFiles = {};
        var allLinks = doc.links;
        var i;

        for (i = 0; i < allLinks.length; i++) {
            var link = allLinks[i];
            var linkName = decodeURI(link.name);
            usedFiles[linkName.toLowerCase()] = linkName;
            note("link " + linkName + " [" + linkStatusName(link) + "]");

            if (isEmbeddedLink(link)) {
                note("  action embedded");
                continue;
            }

            try {
                if (link.status === LinkStatus.LINK_MISSING || link.status === LinkStatus.LINK_INACCESSIBLE) {
                    linkMissing.push(linkName);
                    note("  action missing");
                    continue;
                }
            } catch (eSt) {}

            var currentPath = "";
            try {
                currentPath = normalizePath(link.filePath);
            } catch (ePath) {
                linkErrors.push(linkName + " — нет пути");
                note("  action no-path");
                continue;
            }
            note("  from " + currentPath);

            var correctPath = normalizePath(linksFolder.fsName + "/" + link.name);
            if (currentPath === correctPath) {
                note("  action already");
                continue;
            }

            try {
                var existingFile = new File(linksFolder.fsName + "/" + link.name);
                if (existingFile.exists && normalizePath(existingFile.fsName) !== currentPath) {
                    note("  removed-dest " + existingFile.fsName);
                    existingFile.remove();
                }
                link.copyLink(linksFolder.fsName);
                var newFile = new File(linksFolder.fsName + "/" + link.name);
                if (newFile.exists) {
                    link.relink(newFile);
                    link.update();
                    linkCopied++;
                    note("  action copied");
                    note("  to " + newFile.fsName);
                } else {
                    linkErrors.push(linkName + " — не скопировался");
                    note("  action copy-failed");
                }
            } catch (eCopy) {
                if (errorLooksEmbedded(eCopy)) {
                    note("  action embedded");
                    continue;
                }
                linkErrors.push(linkName + " — " + eCopy);
                note("  action error " + eCopy);
            }
        }

        var existing = linksFolder.getFiles();
        var n;
        for (n = 0; n < existing.length; n++) {
            var item = existing[n];
            if (!(item instanceof File)) {
                continue;
            }
            var name = fileNameOf(item);
            if (shouldSkipCleanup(name)) {
                continue;
            }
            if (usedFiles[name.toLowerCase()]) {
                continue;
            }
            try {
                if (item.remove()) {
                    linkRemoved++;
                    note("deleted " + item.fsName);
                } else {
                    note("delete-failed " + item.fsName);
                }
            } catch (eRm) {
                note("delete-failed " + item.fsName + " " + eRm);
            }
        }
    }

    function getFontFile(font) {
        var loc;
        try {
            loc = font.location;
        } catch (eLoc) {
            return null;
        }
        if (loc == null) {
            return null;
        }
        try {
            if (loc === NothingEnum.NOTHING) {
                return null;
            }
        } catch (eNothing) {}
        var f;
        try {
            if (loc instanceof File) {
                f = loc;
            } else {
                f = new File(String(loc));
            }
        } catch (eFile) {
            return null;
        }
        try {
            if (f.exists) {
                return f;
            }
        } catch (eExists) {}
        return null;
    }

    function isCloudFontPath(path) {
        var p = normalizePath(path);
        return p.indexOf("/coresync/") >= 0 ||
            p.indexOf("/livetype/") >= 0 ||
            p.indexOf("/adobe fonts/") >= 0 ||
            p.indexOf("/adobefonts/") >= 0 ||
            p.indexOf("/typekit/") >= 0;
    }

    function fontLabel(font) {
        try {
            return String(font.name);
        } catch (eName) {
            try {
                return String(font.fontFamily) + " " + String(font.fontStyleName);
            } catch (eFam) {
                return "(unknown)";
            }
        }
    }

    function isMissingStatus(font) {
        try {
            return font.status === FontStatus.SUBSTITUTED ||
                font.status === FontStatus.NOT_AVAILABLE;
        } catch (eSt) {
            return false;
        }
    }

    function isComposite(font) {
        try {
            return font.fontType === FontTypes.ATC;
        } catch (eType) {
            return false;
        }
    }

    var fontCopied = 0;
    var fontCopiedNames = [];
    var fontRemoved = 0;
    var fontRemovedNames = [];
    var fontSkipped = [];
    var fontMissing = [];
    var fontCanDelete = true;
    var stillLocked = [];

    function syncFonts() {
        var fontsFolder = new Folder(docFolder.fsName + "/Document fonts");
        if (!ensureFolder(fontsFolder)) {
            fontSkipped.push("не удалось создать папку Document fonts");
            fontCanDelete = false;
            note("ERROR Document fonts folder");
            return;
        }

        var usedFiles = {};
        var seenFontFiles = {};
        var i;

        for (i = 0; i < doc.fonts.length; i++) {
            var font = doc.fonts[i];
            var label = fontLabel(font);

            if (isMissingStatus(font)) {
                fontMissing.push(label);
                fontCanDelete = false;
                note("font missing " + label);
                continue;
            }
            if (isComposite(font)) {
                fontSkipped.push(label + " — составной шрифт, файла нет");
                fontCanDelete = false;
                note("font composite " + label);
                continue;
            }

            var src = getFontFile(font);
            if (!src) {
                fontSkipped.push(label + " — нет пути к файлу");
                fontCanDelete = false;
                note("font no-path " + label);
                continue;
            }

            var srcPath = src.fsName;
            if (isCloudFontPath(srcPath)) {
                fontSkipped.push(label + " — Adobe Fonts нельзя положить в Document fonts");
                fontCanDelete = false;
                note("font adobe-fonts " + label);
                continue;
            }

            var baseName = fileNameOf(src);
            var fileKey = baseName.toLowerCase();
            usedFiles[fileKey] = baseName;

            if (seenFontFiles[fileKey]) {
                continue;
            }
            seenFontFiles[fileKey] = true;

            if (isInsideFolder(srcPath, fontsFolder.fsName)) {
                note("font already " + baseName);
                continue;
            }

            var destFile = new File(fontsFolder.fsName + "/" + baseName);
            if (fileSizeOf(destFile) > 0) {
                note("font dest-exists " + baseName);
                continue;
            }

            try {
                var copied = copyFileRobust(src, destFile.fsName);
                if (!copied || fileSizeOf(destFile) === 0) {
                    fontSkipped.push(baseName + " — Windows не отдал файл из Fonts");
                    fontCanDelete = false;
                    note("font copy-failed " + baseName + " from " + src.fsName);
                    continue;
                }
                fontCopied++;
                fontCopiedNames.push(baseName);
                note("font copied " + src.fsName + " -> " + destFile.fsName);
            } catch (eCopy) {
                fontSkipped.push(baseName + " — " + eCopy);
                fontCanDelete = false;
                note("font error " + baseName + " " + eCopy);
            }
        }

        var lockedPaths = [];

        function tryRemoveUnused() {
            if (!fontCanDelete || !fontsFolder.exists) {
                return;
            }
            var existing = fontsFolder.getFiles();
            var n;
            for (n = 0; n < existing.length; n++) {
                var item = existing[n];
                if (!(item instanceof File)) {
                    continue;
                }
                var name = fileNameOf(item);
                if (shouldSkipCleanup(name)) {
                    continue;
                }
                if (usedFiles[name.toLowerCase()]) {
                    continue;
                }
                try {
                    if (item.remove()) {
                        fontRemoved++;
                        fontRemovedNames.push(name);
                        note("font deleted " + item.fsName);
                    } else {
                        lockedPaths.push(item.fsName);
                        note("font delete-locked " + item.fsName);
                    }
                } catch (eRm) {
                    lockedPaths.push(item.fsName);
                    note("font delete-locked " + item.fsName);
                }
            }
        }

        tryRemoveUnused();

        if (lockedPaths.length === 0) {
            return;
        }

        try {
            saveIfDirty();
            doc.close(SaveOptions.YES);
            doc = null;
        } catch (eClose) {
            stillLocked = lockedPaths;
            return;
        }

        var p;
        for (p = 0; p < lockedPaths.length; p++) {
            var lockedFile = new File(lockedPaths[p]);
            try {
                if (lockedFile.exists && lockedFile.remove()) {
                    fontRemoved++;
                    fontRemovedNames.push(fileNameOf(lockedFile));
                    note("font deleted " + lockedFile.fsName);
                } else if (lockedFile.exists) {
                    stillLocked.push(lockedPaths[p]);
                    note("font delete-locked " + lockedPaths[p]);
                }
            } catch (eRm2) {
                stillLocked.push(lockedPaths[p]);
            }
        }

        try {
            app.open(docFile);
        } catch (eOpen) {
            fontSkipped.push("не удалось заново открыть документ после удаления шрифтов");
        }
    }

    note("---- " + stamp() + " Syncer 1.2 ----");
    note("doc " + docFile.fsName);
    try {
        syncLinks();
        noteLinksAfter();
        saveIfDirty();
        syncFonts();
    } catch (eRun) {
        note("ERROR " + eRun);
    }
    flushRunLog();

    var hasProblems =
        linkErrors.length > 0 ||
        linkMissing.length > 0 ||
        fontMissing.length > 0 ||
        fontSkipped.length > 0 ||
        stillLocked.length > 0 ||
        !fontCanDelete;

    var lines = [];
    lines.push("Links");
    if (linkCopied > 0) {
        lines.push("  скопировано: " + linkCopied);
    }
    if (linkRemoved > 0) {
        lines.push("  удалено лишних: " + linkRemoved);
    }
    if (linkCopied === 0 && linkRemoved === 0 && linkErrors.length === 0 && linkMissing.length === 0) {
        lines.push("✓ Ok");
    }
    if (linkMissing.length > 0) {
        lines.push("  слетели: " + linkMissing.join(", "));
    }
    if (linkErrors.length > 0) {
        var le;
        for (le = 0; le < linkErrors.length && le < 8; le++) {
            lines.push("  " + linkErrors[le]);
        }
        if (linkErrors.length > 8) {
            lines.push("  … ещё " + (linkErrors.length - 8));
        }
    }

    lines.push("");
    lines.push("Document fonts");
    if (fontCopied > 0) {
        lines.push("  скопировано: " + fontCopied);
        if (fontCopiedNames.length <= 8) {
            lines.push("  " + fontCopiedNames.join(", "));
        }
    }
    if (fontRemoved > 0) {
        lines.push("  удалено лишних: " + fontRemoved);
        if (fontRemovedNames.length <= 8) {
            lines.push("  " + fontRemovedNames.join(", "));
        }
    }
    if (fontCopied === 0 && fontRemoved === 0 && fontMissing.length === 0 && fontSkipped.length === 0) {
        lines.push("✓ Ok");
    }
    if (fontMissing.length > 0) {
        lines.push("  нет в системе (не копировал, папку не чистил):");
        lines.push("  " + fontMissing.join(", "));
    }
    if (fontSkipped.length > 0) {
        var s;
        for (s = 0; s < fontSkipped.length && s < 10; s++) {
            lines.push("  " + fontSkipped[s]);
        }
        if (fontSkipped.length > 10) {
            lines.push("  … ещё " + (fontSkipped.length - 10));
        }
    }
    if (!fontCanDelete && fontRemoved === 0 && fontMissing.length + fontSkipped.length > 0) {
        lines.push("  папку не чистил, пока эти файлы не лягут в Document fonts.");
    }
    if (stillLocked.length > 0) {
        lines.push("  не удалилось (файл занят): " + stillLocked.length);
    }

    lines.push("");
    if (hasProblems) {
        lines.push("Готово, но есть замечания.");
    } else {
        lines.push("✓ Ok");
    }

    alert(lines.join("\n"));
})();
