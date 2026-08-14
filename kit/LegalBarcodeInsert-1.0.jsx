#target "indesign"

// LegalBarcodeInsert-1.0.jsx
// Selected legal text frame: insert or normalize *[terminal.renderCode]* barcode.
// Canon (P530/P531 slices): space in legal font, then barcode run, usually at the end.
// Barcode run: Tall120, scale 100, No Break, no spaces inside.

(function () {
    var SCRIPT_VERSION = "1.0";
    var BARCODE_TEXT = "*[terminal.renderCode]*";
    var FONT_NAMES = [
        "Terminal Barcode 39 Tall120",
        "Terminal Barcode 39"
    ];

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
        alert(
            "Нет шрифта Terminal Barcode 39 Tall120.\n" +
            "Положи TerminalBarcode39-Tall120-Regular.ttf в Document fonts и переоткрой файл."
        );
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
            " — баркод уже был (" + existing.length + "). Поправил шрифт / scale / No Break."
        );
        return;
    }

    var win = new Window("dialog", "Legal barcode " + SCRIPT_VERSION);
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.add(
        "statictext",
        undefined,
        "Вставить *[terminal.renderCode]* (Tall120, No Break).\nПробел рядом — шрифт лигала.",
        { multiline: true }
    );
    var buttons = win.add("group");
    buttons.alignment = "right";
    var btnStart = buttons.add("button", undefined, "В начало");
    var btnEnd = buttons.add("button", undefined, "В конец");
    var btnCancel = buttons.add("button", undefined, "Отмена");
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
    alert("LegalBarcodeInsert " + SCRIPT_VERSION + " — вставил в " + (choice === "start" ? "начало" : "конец") + ".");
})();
