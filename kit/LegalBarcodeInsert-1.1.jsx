#target "indesign"

// LegalBarcodeInsert-1.1.jsx
// Selected legal text frame: insert or normalize *[terminal.renderCode]* barcode.
// Canon (P530/P531 slices): space in legal font, then barcode run, usually at the end.
// Barcode run: Tall120, scale 100, No Break, no spaces inside.
// UI strings are \uXXXX: Windows InDesign reads JSX as ANSI (CP1251), not UTF-8.

(function () {
    var SCRIPT_VERSION = "1.1";
    var BARCODE_TEXT = "*[terminal.renderCode]*";
    var FONT_NAMES = [
        "Terminal Barcode 39 Tall120",
        "Terminal Barcode 39"
    ];
    // Visible UI — ASCII + \uXXXX only (no raw UTF-8 in string literals).
    var UI = {
        noFont:
            "\u041d\u0435\u0442 \u0448\u0440\u0438\u0444\u0442\u0430 Terminal Barcode 39 Tall120.\n" +
            "\u041f\u043e\u043b\u043e\u0436\u0438 TerminalBarcode39-Tall120-Regular.ttf \u0432 Document fonts \u0438 \u043f\u0435\u0440\u0435\u043e\u0442\u043a\u0440\u043e\u0439 \u0444\u0430\u0439\u043b.",
        alreadyPrefix: " \u2014 \u0431\u0430\u0440\u043a\u043e\u0434 \u0443\u0436\u0435 \u0431\u044b\u043b (",
        alreadySuffix: "). \u041f\u043e\u043f\u0440\u0430\u0432\u0438\u043b \u0448\u0440\u0438\u0444\u0442 / scale / No Break.",
        dialogBody:
            "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c *[terminal.renderCode]* (Tall120, No Break).\n" +
            "\u041f\u0440\u043e\u0431\u0435\u043b \u0440\u044f\u0434\u043e\u043c \u2014 \u0448\u0440\u0438\u0444\u0442 \u043b\u0438\u0433\u0430\u043b\u0430.",
        toStart: "\u0412 \u043d\u0430\u0447\u0430\u043b\u043e",
        toEnd: "\u0412 \u043a\u043e\u043d\u0435\u0446",
        cancel: "\u041e\u0442\u043c\u0435\u043d\u0430",
        insertedPrefix: " \u2014 \u0432\u0441\u0442\u0430\u0432\u0438\u043b \u0432 ",
        startWord: "\u043d\u0430\u0447\u0430\u043b\u043e",
        endWord: "\u043a\u043e\u043d\u0435\u0446"
    };

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
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

    function findBarcodeFont() {
        var i;
        for (i = 0; i < FONT_NAMES.length; i++) {
            try {
                var f = app.fonts.itemByName(FONT_NAMES[i]);
                if (f.isValid) {
                    return FONT_NAMES[i];
                }
            } catch (e1) {}
            try {
                var f2 = app.fonts.item(FONT_NAMES[i]);
                if (f2.isValid) {
                    return FONT_NAMES[i];
                }
            } catch (e2) {}
        }
        return null;
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
                tx.appliedFont = fontName;
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

    function insertBarcode(textFrame, atStart, fontName) {
        var text = textFrame.texts[0];
        var contents = String(text.contents);
        var barcodeLen = BARCODE_TEXT.length;
        var start;

        if (atStart) {
            var needSpaceAfter = contents.length > 0 && !/^[\s\r\n]/.test(contents.charAt(0));
            var chunk = BARCODE_TEXT + (needSpaceAfter ? " " : "");
            text.insertionPoints[0].contents = chunk;
            start = 0;
        } else {
            var last = lastVisibleIndex(contents);
            var ip = last + 1;
            var needSpaceBefore = last >= 0 && contents.charAt(last) !== " " && contents.charAt(last) !== "\u00A0";
            var prefix = needSpaceBefore ? " " : "";
            text.insertionPoints[ip].contents = prefix + BARCODE_TEXT;
            start = ip + prefix.length;
        }

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

    var fontName = findBarcodeFont();
    if (!fontName) {
        alert(UI.noFont);
        return;
    }

    var existing = findExisting(textFrame);
    if (existing.length > 0) {
        var i;
        for (i = 0; i < existing.length; i++) {
            try {
                var s = String(existing[i].contents);
                var stripped = s.replace(/^\s+/, "").replace(/\s+$/, "");
                if (stripped !== s) {
                    existing[i].contents = stripped;
                }
            } catch (eContents) {}
            applyBarcodeFormat(existing[i], fontName);
        }
        alert(
            "LegalBarcodeInsert " + SCRIPT_VERSION +
            UI.alreadyPrefix + existing.length + UI.alreadySuffix
        );
        return;
    }

    var win = new Window("dialog", "Legal barcode " + SCRIPT_VERSION);
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.add(
        "statictext",
        undefined,
        UI.dialogBody,
        { multiline: true }
    );
    var buttons = win.add("group");
    buttons.alignment = "right";
    var btnStart = buttons.add("button", undefined, UI.toStart);
    var btnEnd = buttons.add("button", undefined, UI.toEnd);
    var btnCancel = buttons.add("button", undefined, UI.cancel);
    var choice = null;
    btnStart.onClick = function () {
        choice = "start";
        win.close(1);
    };
    btnEnd.onClick = function () {
        choice = "end";
        win.close(1);
    };
    btnCancel.onClick = function () {
        win.close(0);
    };

    if (win.show() !== 1 || !choice) {
        return;
    }

    insertBarcode(textFrame, choice === "start", fontName);
    alert(
        "LegalBarcodeInsert " + SCRIPT_VERSION +
        UI.insertedPrefix +
        (choice === "start" ? UI.startWord : UI.endWord) +
        "."
    );
})();
