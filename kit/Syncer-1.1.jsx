#target "indesign"

// Syncer-1.1.jsx
// Синкер: картинки в Links + шрифты в Document fonts рядом с INDD.
// Relink картинкам; шрифтам relink не нужен — InDesign берёт по имени.
// 1.1: встроенный QR не ошибка; шрифты из Windows Fonts копирует запасным путём;
// один variable-файл не пытается копировать по разу на каждое начертание.

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

    function syncLinks() {
        var linksFolder = new Folder(docFolder.fsName + "/Links");
        if (!ensureFolder(linksFolder)) {
            linkErrors.push("не удалось создать папку Links");
            return;
        }

        var usedFiles = {};
        var allLinks = doc.links;
        var i;

        for (i = 0; i < allLinks.length; i++) {
            var link = allLinks[i];
            var linkName = decodeURI(link.name);
            usedFiles[linkName.toLowerCase()] = linkName;

            if (isEmbeddedLink(link)) {
                continue;
            }

            try {
                if (link.status === LinkStatus.LINK_MISSING || link.status === LinkStatus.LINK_INACCESSIBLE) {
                    linkMissing.push(linkName);
                    continue;
                }
            } catch (eSt) {}

            var currentPath = "";
            try {
                currentPath = normalizePath(link.filePath);
            } catch (ePath) {
                linkErrors.push(linkName + " — нет пути");
                continue;
            }

            var correctPath = normalizePath(linksFolder.fsName + "/" + link.name);
            if (currentPath === correctPath) {
                continue;
            }

            try {
                var existingFile = new File(linksFolder.fsName + "/" + link.name);
                if (existingFile.exists && normalizePath(existingFile.fsName) !== currentPath) {
                    existingFile.remove();
                }
                link.copyLink(linksFolder.fsName);
                var newFile = new File(linksFolder.fsName + "/" + link.name);
                if (newFile.exists) {
                    link.relink(newFile);
                    link.update();
                    linkCopied++;
                } else {
                    linkErrors.push(linkName + " — не скопировался");
                }
            } catch (eCopy) {
                if (errorLooksEmbedded(eCopy)) {
                    continue;
                }
                linkErrors.push(linkName + " — " + eCopy);
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
                }
            } catch (eRm) {}
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
                continue;
            }
            if (isComposite(font)) {
                fontSkipped.push(label + " — составной шрифт, файла нет");
                fontCanDelete = false;
                continue;
            }

            var src = getFontFile(font);
            if (!src) {
                fontSkipped.push(label + " — нет пути к файлу");
                fontCanDelete = false;
                continue;
            }

            var srcPath = src.fsName;
            if (isCloudFontPath(srcPath)) {
                fontSkipped.push(label + " — Adobe Fonts нельзя положить в Document fonts");
                fontCanDelete = false;
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
                continue;
            }

            var destFile = new File(fontsFolder.fsName + "/" + baseName);
            if (fileSizeOf(destFile) > 0) {
                continue;
            }

            try {
                var copied = copyFileRobust(src, destFile.fsName);
                if (!copied || fileSizeOf(destFile) === 0) {
                    fontSkipped.push(baseName + " — Windows не отдал файл из Fonts");
                    fontCanDelete = false;
                    continue;
                }
                fontCopied++;
                fontCopiedNames.push(baseName);
            } catch (eCopy) {
                fontSkipped.push(baseName + " — " + eCopy);
                fontCanDelete = false;
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
                    } else {
                        lockedPaths.push(item.fsName);
                    }
                } catch (eRm) {
                    lockedPaths.push(item.fsName);
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
                } else if (lockedFile.exists) {
                    stillLocked.push(lockedPaths[p]);
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

    syncLinks();
    saveIfDirty();
    syncFonts();

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
        lines.push("  уже в порядке");
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
        lines.push("  уже в порядке");
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
        lines.push("✓ Всё ок");
    }

    alert(lines.join("\n"));
})();
