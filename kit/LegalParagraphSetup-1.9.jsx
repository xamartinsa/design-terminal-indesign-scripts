// LegalParagraphSetup-1.9.jsx
// Selected legal text frame (uniform paragraph style only).
// Local overrides only (no new paragraph style):
// - Russian + hyphenation + justification
// - local GREP Styles (No Break) for short words + common prepositions/conjunctions
// - No Break for Latin websites (dodo.ru) and Latin letter runs (no mid-word URL breaks)
// - quote cleanup → Russian guillemets «»
// - spaced hyphen/en-dash " - " / " – " → em dash (not 10–12)
// - strip a single trailing period at end of frame

(function () {
    var SCRIPT_VERSION = "1.9";
    var NO_BREAK_CHAR_STYLE_NAME = "No Break";

    // Base patterns (same idea as BasicParagraphSetup) + longer RU prepositions/conjunctions.
    // Word list kept as \<(?:...)\s so No Break covers "word + following space".
    //
    // Website / Latin (1.9):
    // - [A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+  → whole token like DODOPIZZA.RU / www.dodo.ru
    // - [A-Za-z]{2,}                     → Latin runs (InDesign may break Latin mid-word under RU)
    // - .\.[\\l\\u]                      → letter/digit + "." + letter (keeps *.ru glue; Unicode letters)
    // Latin-only for full domains so we don't glue Cyrillic "г.Саратов" as one unbreakable blob.
    var GREP_EXPRESSION =
        "[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)+" +
        "|[A-Za-z]{2,}" +
        "|.\\.[\\l\\u]" +
        "|\\<(?:для|или|при|над|под|без|про|через|чтобы|также|если|когда|после|перед|между|около|вместо|среди|кроме|возле|вдоль|против|ради|сквозь|согласно|вокруг|насчёт|насчет)\\s" +
        "|\\<[\\l\\u][\\l\\u]\\s" +
        "|\\<[\\l\\u]\\s" +
        "|\\s—" +
        "|\\<[\\l\\u]\\.\\s";

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;

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

    function paragraphHasVisibleText(paragraph) {
        try {
            var cleaned = String(paragraph.contents)
                .replace(/[\r\n\u0003\u0019]/g, "")
                .replace(/\s+/g, "");
            return cleaned.length > 0;
        } catch (e) {
            return false;
        }
    }

    function findRussianLanguage() {
        var names = ["Russian", "Русский"];
        for (var i = 0; i < names.length; i++) {
            try {
                var lang = app.languagesWithVendors.itemByName(names[i]);
                if (lang.isValid) {
                    return lang;
                }
            } catch (e) {}
        }
        return null;
    }

    function ensureNoBreakCharStyle() {
        var charStyle = doc.characterStyles.itemByName(NO_BREAK_CHAR_STYLE_NAME);
        if (!charStyle.isValid) {
            charStyle = doc.characterStyles.add({ name: NO_BREAK_CHAR_STYLE_NAME });
        }
        charStyle.noBreak = true;
        return charStyle;
    }

    function ensureLocalGrepStyle(paragraph, charStyle) {
        if (!(paragraph.nestedGrepStyles && typeof paragraph.nestedGrepStyles.add === "function")) {
            throw new Error("nestedGrepStyles unavailable on paragraph");
        }

        // Remove older LegalParagraphSetup GREP variants so we don't stack duplicates
        for (var i = paragraph.nestedGrepStyles.length - 1; i >= 0; i--) {
            try {
                var existing = paragraph.nestedGrepStyles[i];
                if (
                    existing.appliedCharacterStyle.id === charStyle.id &&
                    existing.grepExpression !== GREP_EXPRESSION &&
                    (
                        existing.grepExpression.indexOf("\\<[\\l\\u]\\s") !== -1 ||
                        existing.grepExpression.indexOf("для|или|при") !== -1 ||
                        existing.grepExpression.indexOf("[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)+") !== -1 ||
                        existing.grepExpression.indexOf("[A-Za-z]{2,}") !== -1
                    )
                ) {
                    existing.remove();
                }
            } catch (eRem) {}
        }

        for (var j = 0; j < paragraph.nestedGrepStyles.length; j++) {
            if (
                paragraph.nestedGrepStyles[j].grepExpression === GREP_EXPRESSION &&
                paragraph.nestedGrepStyles[j].appliedCharacterStyle.id === charStyle.id
            ) {
                return false;
            }
        }

        paragraph.nestedGrepStyles.add({
            appliedCharacterStyle: charStyle,
            grepExpression: GREP_EXPRESSION
        });
        return true;
    }

    function clearFindChange() {
        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findTextPreferences = NothingEnum.NOTHING;
        app.changeTextPreferences = NothingEnum.NOTHING;
    }

    // Convert paired "..." / “...” / „...” to «...» in place (keep formatting).
    // Skip ranges inside [...] variables.
    function fixQuotesInFrame(textFrame) {
        var text = textFrame.texts[0];
        var contents = String(text.contents);
        var chars = [];
        var i;

        for (i = 0; i < contents.length; i++) {
            chars.push(contents.charAt(i));
        }

        function inBrackets(index) {
            var depth = 0;
            for (var k = 0; k <= index; k++) {
                if (chars[k] === "[") {
                    depth++;
                } else if (chars[k] === "]") {
                    depth = Math.max(0, depth - 1);
                }
            }
            return depth > 0;
        }

        function isOpenCandidate(ch) {
            return ch === '"' || ch === "\u201C" || ch === "\u201E";
        }

        function isCloseCandidate(ch) {
            return ch === '"' || ch === "\u201D" || ch === "\u201F" || ch === "\u201C";
        }

        var replacements = [];
        var openIdx = -1;
        for (i = 0; i < chars.length; i++) {
            if (inBrackets(i)) {
                continue;
            }
            var ch = chars[i];
            if (openIdx === -1) {
                if (isOpenCandidate(ch)) {
                    openIdx = i;
                }
            } else if (isCloseCandidate(ch) && i > openIdx) {
                replacements.push({ index: openIdx, value: "\u00AB" });
                replacements.push({ index: i, value: "\u00BB" });
                openIdx = -1;
            }
        }

        if (replacements.length === 0) {
            return false;
        }

        for (i = 0; i < replacements.length; i++) {
            try {
                text.characters[replacements[i].index].contents = replacements[i].value;
            } catch (eChar) {}
        }
        return true;
    }

    // Spaced dash -> em dash: " - " or " – " (en-dash).
    // Skip [...] variables. Do NOT touch unspaced ranges like 10–12.
    function fixSpacedHyphenToEmDash(textFrame) {
        var text = textFrame.texts[0];
        var contents = String(text.contents);
        var dashIndexes = [];
        var depth = 0;
        var i;

        for (i = 0; i < contents.length - 2; i++) {
            var ch = contents.charAt(i);
            if (ch === "[") {
                depth++;
            } else if (ch === "]") {
                depth = Math.max(0, depth - 1);
            }
            if (depth > 0) {
                continue;
            }
            if (ch === " ") {
                var mid = contents.charAt(i + 1);
                // hyphen-minus or en-dash only when both sides are regular spaces
                if ((mid === "-" || mid === "\u2013") && contents.charAt(i + 2) === " ") {
                    dashIndexes.push(i + 1);
                }
            }
        }

        if (dashIndexes.length === 0) {
            return false;
        }

        for (i = dashIndexes.length - 1; i >= 0; i--) {
            try {
                text.characters[dashIndexes[i]].contents = "\u2014";
            } catch (eDash) {}
        }
        return true;
    }

    // Remove one trailing period at the very end of the frame (after spaces/returns),
    // but not if it looks like an abbreviation (letter + period) without much before —
    // only strip when previous non-space char is a letter/digit and this is end punctuation.
    function stripTrailingPeriod(textFrame) {
        var text = textFrame.texts[0];
        var contents = String(text.contents);
        var i = contents.length - 1;

        while (i >= 0 && /[\s\r\n\u0003\u0019]/.test(contents.charAt(i))) {
            i--;
        }
        if (i < 0 || contents.charAt(i) !== ".") {
            return false;
        }

        // Don't strip "г." / "стр." style if the only content ends with single-letter abbr —
        // require at least some sentence body: char before '.' should not be start of tiny token only.
        // Safer rule: strip '.' only if preceded by a letter and that letter is part of a word
        // longer than 1 char (so "г." stays, "наличие." goes).
        var before = i - 1;
        while (before >= 0 && /[\s\r\n]/.test(contents.charAt(before))) {
            before--;
        }
        if (before < 0) {
            return false;
        }

        var prev = contents.charAt(before);
        if (!/[0-9A-Za-zА-Яа-яЁё]/.test(prev)) {
            return false;
        }

        // Walk back the word before the period
        var wordStart = before;
        while (wordStart > 0 && /[0-9A-Za-zА-Яа-яЁё]/.test(contents.charAt(wordStart - 1))) {
            wordStart--;
        }
        var wordLen = before - wordStart + 1;
        if (wordLen <= 1) {
            // likely abbreviation like "г."
            return false;
        }

        text.characters[i].contents = "";
        return true;
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

    var sourceStyle = null;
    var targetParagraphs = [];

    try {
        var paragraphs = textFrame.paragraphs.everyItem().getElements();
        for (var p = 0; p < paragraphs.length; p++) {
            if (!paragraphHasVisibleText(paragraphs[p])) {
                continue;
            }
            var applied = paragraphs[p].appliedParagraphStyle;
            if (!(applied instanceof ParagraphStyle)) {
                alert("Mixed / invalid paragraph styles.");
                return;
            }
            if (sourceStyle === null) {
                sourceStyle = applied;
            } else if (applied.id !== sourceStyle.id) {
                alert("Mixed paragraph styles — abort.");
                return;
            }
            targetParagraphs.push(paragraphs[p]);
        }
    } catch (eCheck) {
        alert("Could not check styles.");
        return;
    }

    if (targetParagraphs.length === 0 || !sourceStyle) {
        alert("No text in frame.");
        return;
    }

    var russianLanguage = findRussianLanguage();
    if (!russianLanguage) {
        alert("Russian language not found.");
        return;
    }

    try {
        // Text cleanup first (quotes / trailing period), then typography + GREP
        clearFindChange();
        fixQuotesInFrame(textFrame);
        fixSpacedHyphenToEmDash(textFrame);
        stripTrailingPeriod(textFrame);

        // Re-collect paragraphs after content edits
        targetParagraphs = [];
        paragraphs = textFrame.paragraphs.everyItem().getElements();
        for (p = 0; p < paragraphs.length; p++) {
            if (paragraphHasVisibleText(paragraphs[p])) {
                targetParagraphs.push(paragraphs[p]);
            }
        }

        var charStyle = ensureNoBreakCharStyle();

        for (var i = 0; i < targetParagraphs.length; i++) {
            var para = targetParagraphs[i];
            para.appliedLanguage = russianLanguage;
            para.hyphenation = true;
            para.hyphenateWordsLongerThan = 6;
            para.hyphenateAfterFirst = 3;
            para.hyphenateBeforeLast = 3;
            para.minimumWordSpacing = 90;
            para.desiredWordSpacing = 100;
            para.maximumWordSpacing = 110;
            para.minimumLetterSpacing = -10;
            para.desiredLetterSpacing = 0;
            para.maximumLetterSpacing = 10;
            para.minimumGlyphScaling = 90;
            para.desiredGlyphScaling = 100;
            para.maximumGlyphScaling = 110;

            ensureLocalGrepStyle(para, charStyle);
        }

        try {
            textFrame.texts[0].appliedLanguage = russianLanguage;
        } catch (eLangText) {}
    } catch (eSetup) {
        clearFindChange();
        alert("Setup failed: " + eSetup.message);
        return;
    }

    clearFindChange();
    alert("LegalParagraphSetup " + SCRIPT_VERSION + " — done.");
})();
