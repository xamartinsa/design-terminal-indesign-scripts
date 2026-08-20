#target "indesign"

// FontSyncer-1.0.jsx
// Как ImageLinkSyncer, но для шрифтов: копирует используемые в Document fonts,
// удаляет лишние файлы из этой папки.
// Relink шрифтам не нужен — InDesign берёт их по имени; папка нужна пакету/ферме.

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
    var fontsFolder = new Folder(docFolder.fsName + "/Document fonts");
    if (!fontsFolder.exists) {
        fontsFolder.create();
        if (!fontsFolder.exists) {
            alert("Не удалось создать папку Document fonts:\n" + docFolder.fsName);
            return;
        }
    }

    function normalizePath(path) {
        return decodeURI(String(path)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    }

    function fileNameOf(fileObj) {
        return decodeURI(fileObj.name);
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

    function isInsideFolder(filePath, folderPath) {
        var f = normalizePath(filePath);
        var d = normalizePath(folderPath);
        return f === d || f.indexOf(d + "/") === 0;
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

    var usedFiles = {};
    var copiedCount = 0;
    var copiedNames = [];
    var skipped = [];
    var missing = [];
    var canDelete = true;
    var i;

    for (i = 0; i < doc.fonts.length; i++) {
        var font = doc.fonts[i];
        var label = fontLabel(font);

        if (isMissingStatus(font)) {
            missing.push(label);
            canDelete = false;
            continue;
        }
        if (isComposite(font)) {
            skipped.push(label + " — составной шрифт, файла нет");
            canDelete = false;
            continue;
        }

        var src = getFontFile(font);
        if (!src) {
            skipped.push(label + " — нет пути к файлу");
            canDelete = false;
            continue;
        }

        var srcPath = src.fsName;
        if (isCloudFontPath(srcPath)) {
            skipped.push(label + " — Adobe Fonts нельзя положить в Document fonts");
            canDelete = false;
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
                var destNorm = normalizePath(destFile.fsName);
                var srcNorm = normalizePath(srcPath);
                if (destNorm === srcNorm) {
                    continue;
                }
                destFile.remove();
            }
            var copied = src.copy(destFile.fsName);
            if (!copied || !destFile.exists) {
                skipped.push(label + " — не скопировался (" + baseName + ")");
                canDelete = false;
                continue;
            }
            copiedCount++;
            copiedNames.push(baseName);
        } catch (eCopy) {
            skipped.push(label + " — " + eCopy);
            canDelete = false;
        }
    }

    var removedCount = 0;
    var removedNames = [];
    var lockedPaths = [];
    var stillLocked = [];

    function tryRemoveUnused() {
        if (!canDelete || !fontsFolder.exists) {
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
                    removedCount++;
                    removedNames.push(name);
                } else {
                    lockedPaths.push(item.fsName);
                }
            } catch (eRm) {
                lockedPaths.push(item.fsName);
            }
        }
    }

    tryRemoveUnused();

    if (lockedPaths.length > 0) {
        try {
            if (doc.modified) {
                doc.save();
            }
            doc.close(SaveOptions.YES);
            doc = null;
        } catch (eClose) {
            stillLocked = lockedPaths;
            lockedPaths = [];
        }

        var p;
        for (p = 0; p < lockedPaths.length; p++) {
            var lockedFile = new File(lockedPaths[p]);
            try {
                if (lockedFile.exists && lockedFile.remove()) {
                    removedCount++;
                    removedNames.push(fileNameOf(lockedFile));
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
            skipped.push("не удалось заново открыть документ после удаления");
        }
    }

    var lines = [];
    if (copiedCount > 0) {
        lines.push("Скопировано шрифтов: " + copiedCount);
        if (copiedNames.length <= 8) {
            lines.push("  " + copiedNames.join(", "));
        }
    }
    if (removedCount > 0) {
        lines.push("Удалено неиспользуемых: " + removedCount);
        if (removedNames.length <= 8) {
            lines.push("  " + removedNames.join(", "));
        }
    }
    if (missing.length > 0) {
        lines.push("Не хватает в системе (не копировал, папку не чистил):");
        lines.push("  " + missing.join(", "));
    }
    if (skipped.length > 0) {
        lines.push("Пропущено:");
        var s;
        for (s = 0; s < skipped.length && s < 10; s++) {
            lines.push("  " + skipped[s]);
        }
        if (skipped.length > 10) {
            lines.push("  … ещё " + (skipped.length - 10));
        }
    }
    if (!canDelete && removedCount === 0) {
        lines.push("Удаление не делал: сначала доложи недостающие файлы.");
    }
    if (stillLocked.length > 0) {
        lines.push("Не удалилось (файл занят): " + stillLocked.length);
    }
    if (lines.length === 0) {
        lines.push("Все шрифты уже в порядке.");
    }

    alert(lines.join("\n"));
})();
