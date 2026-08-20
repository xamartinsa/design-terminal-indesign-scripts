#target "indesign"

// LegalBarcodeInsert-1.3.jsx
// Selected legal text frame: insert *[terminal.renderCode]* at the END.
// Always copies TerminalBarcode39-Tall120-Regular.ttf into Document fonts
// (sidecar next to this .jsx, shipped in the kit).
// Canon: after the legal, Tall120, scale 100, No Break. No Regular fallback.
// UI strings are \uXXXX: Windows InDesign reads JSX as ANSI (CP1251), not UTF-8.

(function () {
    var SCRIPT_VERSION = "1.3";
    var BARCODE_TEXT = "*[terminal.renderCode]*";
    var FONT_FAMILY = "Terminal Barcode 39 Tall120";
    var FONT_FILE_NAME = "TerminalBarcode39-Tall120-Regular.ttf";
    var UI = {
        needSave:
            "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0438 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442 (.indd).\n" +
            "\u0428\u0440\u0438\u0444\u0442 \u043a\u043b\u0430\u0434\u0451\u0442\u0441\u044f \u0432 Document fonts \u0440\u044f\u0434\u043e\u043c \u0441 \u0444\u0430\u0439\u043b\u043e\u043c.",
        noSidecar:
            "\u0420\u044f\u0434\u043e\u043c \u0441\u043e \u0441\u043a\u0440\u0438\u043f\u0442\u043e\u043c \u043d\u0435\u0442 " + FONT_FILE_NAME + ".\n" +
            "\u0417\u0430\u043f\u0443\u0441\u0442\u0438 Update-DT-Scripts \u0438 \u0431\u0435\u0440\u0438 LegalBarcodeInsert \u0438\u0437 Design Terminal Git.",
        copiedReopen:
            "\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043b Tall120 \u0432 Document fonts.\n" +
            "\u0417\u0430\u043a\u0440\u043e\u0439 \u0444\u0430\u0439\u043b \u0438 \u043e\u0442\u043a\u0440\u043e\u0439 \u0441\u043d\u043e\u0432\u0430, \u043f\u043e\u0442\u043e\u043c \u0437\u0430\u043f\u0443\u0441\u0442\u0438 \u0441\u043a\u0440\u0438\u043f\u0442 \u0435\u0449\u0451 \u0440\u0430\u0437.",
        noFont:
            "\u041d\u0435\u0442 \u0448\u0440\u0438\u0444\u0442\u0430 Terminal Barcode 39 Tall120.\n" +
            "\u041f\u043e\u043b\u043e\u0436\u0438 " + FONT_FILE_NAME + " \u0432 Document fonts \u0438 \u043f\u0435\u0440\u0435\u043e\u0442\u043a\u0440\u043e\u0439 \u0444\u0430\u0439\u043b.",
        alreadyOk:
            " \u2014 \u0431\u0430\u0440\u043a\u043e\u0434 \u0443\u0436\u0435 \u0432 \u043a\u043e\u043d\u0446\u0435. \u041f\u043e\u043f\u0440\u0430\u0432\u0438\u043b \u0448\u0440\u0438\u0444\u0442 / scale / No Break.",
        moved:
            " \u2014 \u043f\u0435\u0440\u0435\u043d\u0451\u0441 \u0432 \u043a\u043e\u043d\u0435\u0446 (Tall120, No Break).",
        inserted:
            " \u2014 \u0432\u0441\u0442\u0430\u0432\u0438\u043b \u0432 \u043a\u043e\u043d\u0435\u0446 (Tall120, No Break)."
    };

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    function scriptFolder() {
        try {
            return File($.fileName).parent;
        } catch (e) {
            return null;
        }
    }

    function fontIsInstalled() {
        var names = [FONT_FAMILY, FONT_FAMILY + "\tRegular"];
        var i;
        for (i = 0; i < names.length; i++) {
            try {
                var f = app.fonts.itemByName(names[i]);
                if (f.isValid && f.status === FontStatus.INSTALLED) {
                    return names[i];
                }
            } catch (e1) {}
        }
        return null;
    }

    function ensureTall120File() {
        var doc = app.activeDocument;
        var saved = false;
        try {
            saved = doc.saved;
        } catch (eSaved) {
            saved = false;
        }
        if (!saved) {
            alert(UI.needSave);
            return false;
        }

        var folder = scriptFolder();
        if (!folder) {
            alert(UI.noSidecar);
            return false;
        }
        var src = new File(folder.fsName + "/" + FONT_FILE_NAME);
        if (!src.exists) {
            alert(UI.noSidecar);
            return false;
        }

        var destFolder;
        try {
            destFolder = new Folder(doc.filePath.fsName + "/Document fonts");
        } catch (ePath) {
            alert(UI.needSave);
            return false;
        }
        if (!destFolder.exists) {
            destFolder.create();
        }
        var dest = new File(destFolder.fsName + "/" + FONT_FILE_NAME);
        try {
            if (dest.exists) {
                dest.remove();
            }
        } catch (eRm) {}
        src.copy(dest);
        try {
            app.fonts.length;
        } catch (eLen) {}
        if (!dest.exists) {
            alert(UI.noFont);
            return false;
        }
        return true;
    }

    function resolveTextFrame(selectionItem) {
        if (!selectionItem) {
            return null;
        }
        try {
            if (selectionItem instanceof TextFrame) {
                return selectionItem;
            }
        } catch (e1) {}
        try {
            if (selectionItem.constructor && selectionItem.constructor.name === "TextFrame") {
                return selectionItem;
            }
        } catch (e2) {}
        try {
            if (selectionItem.parentTextFrames && selectionItem.parentTextFrames.length > 0) {
                return selectionItem.parentTextFrames[0];
            }
        } catch (e3) {}
        try {
            if (selectionItem.textFrames && selectionItem.textFrames.length === 1) {
                return selectionItem.textFrames[0];
            }
        } catch (e4) {}
        return null;
    }

    function clearFind() {
        app.findTextPreferences = NothingEnum.nothing;
        app.changeTextPreferences = NothingEnum.nothing;
        app.findGrepPreferences = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
    }

    function applyBarcodeFormat(tx, fontName) {
        try {
            tx.verticalScale = 100;
        } catch (eScale) {}
        try {
            tx.horizontalScale = 100;
        } catch (eH) {}
        try {
            tx.noBreak = true;
        } catch (eNb) {}
        try {
            tx.appliedFont = app.fonts.item(fontName);
            try {
                tx.fontStyle = "Regular";
            } catch (eSt) {}
        } catch (eFont) {
            try {
                tx.appliedFont = FONT_FAMILY;
            } catch (eFont2) {}
        }
    }

    function findExisting(textFrame) {
        clearFind();
        app.findGrepPreferences.findWhat = "\\*?\\[terminal\\.renderCode\\]\\*?";
        var found = [];
        try {
            found = textFrame.parentStory.findGrep();
        } catch (eFind) {
            found = [];
        }
        clearFind();
        return found;
    }

    function lastVisibleIndex(contents) {
        var i = contents.length - 1;
        while (i >= 0 && /[\s\r\n\u0003\u0019]/.test(contents.charAt(i))) {
            i--;
        }
        return i;
    }

    function isSpaceChar(ch) {
        return ch === " " || ch === "\u00A0";
    }

    function barcodeIsAtEnd(foundItem, lastVisible) {
        try {
            var endIdx = foundItem.index + foundItem.characters.length - 1;
            return endIdx >= lastVisible;
        } catch (e) {
            return false;
        }
    }

    function removeBarcodeRuns(textFrame) {
        var found = findExisting(textFrame);
        var i;
        for (i = found.length - 1; i >= 0; i--) {
            try {
                var story = found[i].parentStory;
                var startIdx = found[i].index;
                var endIdx = startIdx + found[i].characters.length - 1;
                try {
                    if (endIdx + 1 < story.characters.length && isSpaceChar(story.characters[endIdx + 1].contents)) {
                        endIdx += 1;
                    }
                } catch (eA) {}
                try {
                    if (startIdx > 0 && isSpaceChar(story.characters[startIdx - 1].contents)) {
                        startIdx -= 1;
                    }
                } catch (eB) {}
                story.characters.itemByRange(startIdx, endIdx).contents = "";
            } catch (eDel) {}
        }
    }

    function insertBarcodeAtEnd(textFrame, fontName) {
        var text = textFrame.texts[0];
        var contents = String(text.contents);
        var barcodeLen = BARCODE_TEXT.length;
        var last = lastVisibleIndex(contents);
        var ip = last + 1;
        var needSpaceBefore = last >= 0 && contents.charAt(last) !== " " && contents.charAt(last) !== "\u00A0";
        var prefix = needSpaceBefore ? " " : "";
        text.insertionPoints[ip].contents = prefix + BARCODE_TEXT;
        var start = ip + prefix.length;
        applyBarcodeFormat(text.characters.itemByRange(start, start + barcodeLen - 1), fontName);
    }

    if (app.selection.length === 0) {
        alert("Select a legal text frame.");
        return;
    }

    var textFrame = resolveTextFrame(app.selection[0]);
    if (!textFrame) {
        alert("Select a text frame.");
        return;
    }

    var hadFont = !!fontIsInstalled();
    if (!ensureTall120File()) {
        return;
    }
    var fontName = fontIsInstalled();
    if (!fontName) {
        alert(hadFont ? UI.noFont : UI.copiedReopen);
        return;
    }

    var existing = findExisting(textFrame);
    var contents = String(textFrame.texts[0].contents);
    var last = lastVisibleIndex(contents);
    var alreadyAtEnd = existing.length === 1 && barcodeIsAtEnd(existing[0], last);

    if (alreadyAtEnd) {
        try {
            var s = String(existing[0].contents);
            var stripped = s.replace(/^\s+/, "").replace(/\s+$/, "");
            if (stripped !== s) {
                existing[0].contents = stripped;
            }
        } catch (eContents) {}
        applyBarcodeFormat(existing[0], fontName);
        alert("LegalBarcodeInsert " + SCRIPT_VERSION + UI.alreadyOk);
        return;
    }

    if (existing.length > 0) {
        removeBarcodeRuns(textFrame);
        insertBarcodeAtEnd(textFrame, fontName);
        alert("LegalBarcodeInsert " + SCRIPT_VERSION + UI.moved);
        return;
    }

    insertBarcodeAtEnd(textFrame, fontName);
    alert("LegalBarcodeInsert " + SCRIPT_VERSION + UI.inserted);
})();
