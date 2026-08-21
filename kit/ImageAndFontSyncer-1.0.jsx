#target "indesign"

// ImageAndFontSyncer-1.0.jsx
// Синкер: картинки в Links + шрифты в Document fonts рядом с INDD.
// Relink картинкам; шрифтам relink не нужен — InDesign берёт по имени.

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
            usedFiles[baseName.toLowerCase()] = baseName;

            if (isInsideFolder(srcPath, fontsFolder.fsName)) {
                continue;
            }

            var destFile = new File(fontsFolder.fsName + "/" + baseName);
            try {
                if (destFile.exists) {
                    if (normalizePath(destFile.fsName) === normalizePath(srcPath)) {
                        continue;
                    }
                    destFile.remove();
                }
                var copied = src.copy(destFile.fsName);
                if (!copied || !destFile.exists) {
                    fontSkipped.push(label + " — не скопировался (" + baseName + ")");
                    fontCanDelete = false;
                    continue;
                }
                fontCopied++;
                fontCopiedNames.push(baseName);
            } catch (eCopy) {
                fontSkipped.push(label + " — " + eCopy);
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
        lines.push("  удаление не делал: сначала доложи недостающие файлы.");
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
