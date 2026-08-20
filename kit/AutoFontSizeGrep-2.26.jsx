// AutoFontSizeGrep-2.26.jsx
// Локальные GREP на выбранный абзац. Символы: ^.{N,}
// Без памяти на фрейме.
// 2.26:
//  - «Обновить» внизу, крупная (превью/мигание не трогаем).
//  - После Создать: удалять только неиспользуемые AFG (не трогая занятые
//    другими фреймами). Полный purge по-прежнему запрещён.
// 2.25:
//  - НЕ clearOverrides по абзацу (сносил шрифт/трекинг).
//  - НЕ purge AFG-стилей на весь документ (другие фреймы теряли лицо).
//  - Снос только length-GREP на ЭТОМ абзаце; оверрайд только pointSize/leading,
//    шрифт сохраняем.
// Лог: ~/Desktop/AutoFontSizeGrep.log
// [None] на символах обязателен.
// Владение: label dt.sandbox.autofontsize.grep = owned

(function () {
    var SCRIPT_NAME = "Auto Font Size GREP 2.26";
    var TAG_KEY = "dt.sandbox.autofontsize.grep";
    var TAG_VALUE = "owned";
    var SETTINGS_KEY = "dt.sandbox.autofontsize.grep.settings";
    var LEGACY_TAG_KEY = "AutoFontSizeGrep";
    var LEGACY_STYLE_PREFIX = "Auto/Adaptive Size ";
    var CHAR_STYLE_BASE = "AFG";
    var EPSILON = 0.001;
    var CHAR_STEP_RATIO = 0.2;
    var MIN_PERCENT_FLOOR = 5;
    var MIN_PERCENT_CEIL = 95;
    var MIN_STEPS = 2;
    var MAX_STEPS = 8;
    var DEFAULT_STEPS = 4;
    // Доля «потерянного» масштаба кегля, которую интерлиньяж сохраняет.
    // 0 = как кегль; 1 = интерлиньяж не уменьшается. ~0.3 = чуть мягче.
    var LEADING_SOFTEN = 0.3;
    var LOG_PATH = Folder.desktop.fsName + "/AutoFontSizeGrep.log";

    function log(msg) {
        try {
            var f = new File(LOG_PATH);
            f.encoding = "UTF-8";
            f.open("a");
            f.writeln(
                new Date().toString() + " | " + String(msg)
            );
            f.close();
        } catch (eLog) {}
    }

    function logObj(label, obj) {
        try {
            var parts = [];
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    parts.push(k + "=" + obj[k]);
                }
            }
            log(label + " { " + parts.join(", ") + " }");
        } catch (eObj) {
            log(label + " (unprintable)");
        }
    }

    function charStep(charCount) {
        var step = Math.round(Number(charCount) * CHAR_STEP_RATIO);
        if (isNaN(step) || step < 1) {
            return 1;
        }
        return step;
    }

    // 100% = уже настроенный большой кегль.
    // Чем длиннее «После» относительно «До» и чем больше шагов — тем ниже пол.
    function minPercentFor(state) {
        var until = Math.max(Number(state.untilCount), 1);
        var last = Math.max(Number(state.lastThreshold), until + 1);
        var growth = last / until;
        var steps = state.stepCount;

        // Обратно длине: текст ×2 → около 50%.
        var byLength = Math.round(100 / growth);
        // Заметный суммарный дроп по числу ступеней (~10% на шаг).
        var bySteps = 100 - steps * 10;

        var minP = Math.min(byLength, bySteps);
        if (minP < MIN_PERCENT_FLOOR) {
            minP = MIN_PERCENT_FLOOR;
        }
        if (minP > MIN_PERCENT_CEIL) {
            minP = MIN_PERCENT_CEIL;
        }
        return minP;
    }

    function percentsForCount(stepCount, maxPercent, minPercent) {
        var out = [];
        for (var i = 0; i < stepCount; i++) {
            out.push(
                Math.round(
                    maxPercent - (maxPercent - minPercent) * (i + 1) / stepCount
                )
            );
        }
        return out;
    }

    function buildThresholds(firstThreshold, lastThreshold, stepCount) {
        var n = stepCount;
        if (n < 2) {
            return [firstThreshold];
        }
        var out = [];
        for (var i = 0; i < n; i++) {
            out.push(
                Math.round(
                    firstThreshold +
                        (lastThreshold - firstThreshold) * i / (n - 1)
                )
            );
        }
        out[0] = firstThreshold;
        out[n - 1] = lastThreshold;
        for (var j = 1; j < n; j++) {
            if (out[j] <= out[j - 1]) {
                out[j] = out[j - 1] + 1;
            }
        }
        return out;
    }

    function defaultDialogState(info) {
        var step = charStep(info.charCount);
        var untilCount = info.charCount;
        var state = {
            untilCount: untilCount,
            lastThreshold: untilCount + DEFAULT_STEPS * step,
            stepCount: DEFAULT_STEPS,
            maxPercent: 100,
            minPercent: 60,
            refCharCount: info.charCount,
            basePointSize: info.pointSize,
            baseLeading: info.leading
        };
        state.minPercent = minPercentFor(state);
        return state;
    }

    function refCharCountOf(state, info) {
        var ref = Number(state.refCharCount);
        if (!isNaN(ref) && ref > 0) {
            return ref;
        }
        var until = Number(state.untilCount);
        if (!isNaN(until) && until > 0) {
            return until;
        }
        return info.charCount;
    }

    function clearSavedSettings(textFrame) {
        try {
            textFrame.insertLabel(SETTINGS_KEY, "");
        } catch (e) {}
    }

    function saveSettings(textFrame, state, info) {
        // 2.23: память отключена — только чистим старый label.
        clearSavedSettings(textFrame);
    }

    function loadSettings(textFrame) {
        return null;
    }

    function paragraphHasOurGrep(paragraph) {
        if (!paragraph || !paragraph.nestedGrepStyles) {
            return false;
        }
        for (var i = 0; i < paragraph.nestedGrepStyles.length; i++) {
            try {
                var characterStyle = paragraph.nestedGrepStyles[i].appliedCharacterStyle;
                if (characterStyle && styleIsOurs(characterStyle)) {
                    return true;
                }
            } catch (e) {}
        }
        return false;
    }

    // Если на абзаце уже наши GREP — восстановить пороги из выражений.
    function loadSettingsFromParagraph(paragraph, info) {
        if (!paragraph || !paragraph.nestedGrepStyles) {
            return null;
        }
        var thresholds = [];
        var baseSize = null;
        var baseLead = null;
        var smallestPercent = null;
        for (var i = 0; i < paragraph.nestedGrepStyles.length; i++) {
            try {
                var grepStyle = paragraph.nestedGrepStyles[i];
                var characterStyle = grepStyle.appliedCharacterStyle;
                if (!characterStyle || !styleIsOurs(characterStyle)) {
                    continue;
                }
                var match = String(grepStyle.grepExpression).match(
                    /^\^\.\{(\d+),/
                );
                if (!match) {
                    continue;
                }
                var threshold = Number(match[1]);
                var styleSize = Number(characterStyle.pointSize);
                var styleLead = Number(characterStyle.leading);
                if (threshold === 1) {
                    baseSize = styleSize;
                    if (!isNaN(styleLead) && styleLead > 0) {
                        baseLead = styleLead;
                    }
                    continue;
                }
                thresholds.push(threshold);
                if (!isNaN(styleSize) && baseSize && baseSize > 0) {
                    var pct = Math.round(styleSize / baseSize * 100);
                    if (smallestPercent === null || pct < smallestPercent) {
                        smallestPercent = pct;
                    }
                }
            } catch (e) {}
        }
        if (thresholds.length < MIN_STEPS) {
            return null;
        }
        thresholds.sort(function (a, b) {
            return a - b;
        });
        var first = thresholds[0];
        var last = thresholds[thresholds.length - 1];
        // Не завязываться на текущую длину текста — только на пороги GREP.
        var step = Math.max(1, Math.round((last - first) / Math.max(thresholds.length - 1, 1)));
        var untilCount = Math.max(0, first - step);
        if (baseSize && !isNaN(baseSize) && baseSize > 0) {
            info.pointSize = baseSize;
            if (baseLead && !isNaN(baseLead) && baseLead > 0) {
                info.leading = baseLead;
            }
        }
        return {
            untilCount: untilCount,
            lastThreshold: last,
            stepCount: thresholds.length,
            maxPercent: 100,
            minPercent: smallestPercent || 60,
            refCharCount: untilCount > 0 ? untilCount : first,
            basePointSize: info.pointSize,
            baseLeading: info.leading
        };
    }

    function applyDesignBaseToInfo(info, state) {
        // 2.23: не подменяем живой кегль сохранённым.
    }

    function initialDialogState(info, textFrame) {
        // Всегда от текущего текста. Без label / без разбора старых GREP.
        clearSavedSettings(textFrame);
        return defaultDialogState(info);
    }

    // (сброс «От текста» удалён в 2.23 — память не используем)
    function resetStateFromCurrentText(info, prevState) {
        return defaultDialogState(info);
    }

    function resyncInfoFromLiveText(doc, info, textFrame, previewState) {
        return false;
    }

    // Кегль: линейно. Интерлиньяж: медленнее (часть дропа сохраняется).
    function leadingPercentFor(sizePercent) {
        var r = Number(sizePercent) / 100;
        if (isNaN(r) || r <= 0) {
            return sizePercent;
        }
        if (r >= 1) {
            return 100;
        }
        return (r + (1 - r) * LEADING_SOFTEN) * 100;
    }

    function sizeAtPercent(info, percent) {
        return roundPt(info.pointSize * percent / 100);
    }

    function leadingAtPercent(info, percent) {
        return roundPt(info.leading * leadingPercentFor(percent) / 100);
    }

    function ptLabel(info, percent) {
        return formatNumber(sizeAtPercent(info, percent));
    }

    // Первый порог уменьшения — сразу после «До», шаг от эталонной длины.
    function firstThresholdFromUntil(untilCount, refCharCount) {
        var step = charStep(refCharCount);
        return untilCount + step;
    }

    function fail(message) {
        log("FAIL: " + message);
        alert(SCRIPT_NAME + "\n\n" + message);
    }

    function getNoneCharacterStyle(doc) {
        try {
            var none = doc.characterStyles.item("[None]");
            if (none.isValid) {
                return none;
            }
        } catch (e) {}
        try {
            if (doc.characterStyles.length > 0) {
                return doc.characterStyles[0];
            }
        } catch (e2) {}
        return null;
    }

    function isNoneCharacterStyle(style) {
        if (!style) {
            return true;
        }
        try {
            if (!style.isValid) {
                return true;
            }
        } catch (e) {
            return true;
        }
        var name = String(style.name);
        return name === "[None]" || name === "";
    }

    // Чужой стиль символов перекрывает nested GREP. Наши AFG — ок (результат GREP).
    function isBlockingCharacterStyle(style) {
        if (isNoneCharacterStyle(style)) {
            return false;
        }
        if (styleIsOurs(style)) {
            return false;
        }
        return true;
    }

    function findBlockingCharacterStyle(paragraph) {
        if (!paragraph) {
            return null;
        }
        try {
            if (isBlockingCharacterStyle(paragraph.appliedCharacterStyle)) {
                return String(paragraph.appliedCharacterStyle.name);
            }
        } catch (ePara) {}
        try {
            var chars = paragraph.characters;
            for (var i = 0; i < chars.length; i++) {
                if (!isVisibleCharacter(chars[i])) {
                    continue;
                }
                var style = chars[i].appliedCharacterStyle;
                if (isBlockingCharacterStyle(style)) {
                    return String(style.name);
                }
            }
        } catch (eChars) {}
        return null;
    }

    function forceNoneCharacterStyle(paragraph, doc) {
        var none = getNoneCharacterStyle(doc);
        if (!none) {
            return false;
        }
        try {
            paragraph.appliedCharacterStyle = none;
        } catch (ePara) {}
        try {
            var chars = paragraph.characters;
            for (var i = 0; i < chars.length; i++) {
                if (!isVisibleCharacter(chars[i])) {
                    continue;
                }
                chars[i].appliedCharacterStyle = none;
            }
        } catch (eChars) {}
        return true;
    }

    function blockingStyleMessage(styleName) {
        return (
            "На тексте стоит стиль символов «" + styleName + "».\n" +
            "Нужен [None] — иначе он перекрывает GREP-ступени.\n\n" +
            "Снимите стиль символов (оставьте [None]) и запустите снова."
        );
    }

    function resolveTextFrame(item) {
        if (!item) {
            return null;
        }
        try {
            if (item instanceof TextFrame) {
                return item;
            }
        } catch (e1) {}
        try {
            if (item.parentTextFrames && item.parentTextFrames.length > 0) {
                return item.parentTextFrames[0];
            }
        } catch (e2) {}
        return null;
    }

    function isVisibleCharacter(character) {
        var value;
        try {
            value = String(character.contents);
        } catch (e) {
            return false;
        }
        return value !== "\r" && value !== "\n" &&
            value !== "\u0003" && value !== "\u0019";
    }

    function usableLeading(value) {
        var number = Number(value);
        if (isNaN(number) || number <= 0 || number > 5000) {
            return null;
        }
        return number;
    }

    function getTextInfo(textFrame) {
        var paragraphs = textFrame.paragraphs;
        var paragraph = null;
        var visibleParagraphs = 0;

        for (var i = 0; i < paragraphs.length; i++) {
            var chars = paragraphs[i].characters;
            var hasText = false;
            for (var j = 0; j < chars.length; j++) {
                if (isVisibleCharacter(chars[j])) {
                    hasText = true;
                    break;
                }
            }
            if (hasText) {
                paragraph = paragraphs[i];
                visibleParagraphs++;
            }
        }

        if (visibleParagraphs !== 1 || !paragraph) {
            return null;
        }

        var contents = "";
        var pointSize = null;
        var maxPointSize = null;
        var leading = null;
        var maxLeading = null;
        var leadingWasAuto = false;
        var mixedPointSizes = false;
        var mixedLeading = false;
        var ours = paragraphHasOurGrep(paragraph);
        var paragraphChars = paragraph.characters;

        for (var k = 0; k < paragraphChars.length; k++) {
            var character = paragraphChars[k];
            if (!isVisibleCharacter(character)) {
                continue;
            }

            contents += String(character.contents);

            var currentSize = Number(character.pointSize);
            if (isNaN(currentSize) || currentSize <= 0) {
                return { invalidFormatting: true };
            }
            if (pointSize === null) {
                pointSize = currentSize;
                maxPointSize = currentSize;
            } else {
                if (currentSize > maxPointSize) {
                    maxPointSize = currentSize;
                }
                if (Math.abs(pointSize - currentSize) > EPSILON) {
                    mixedPointSizes = true;
                }
            }

            var currentLeading = usableLeading(character.leading);
            if (currentLeading === null) {
                leadingWasAuto = true;
            } else if (leading === null) {
                leading = currentLeading;
                maxLeading = currentLeading;
            } else {
                if (currentLeading > maxLeading) {
                    maxLeading = currentLeading;
                }
                if (Math.abs(leading - currentLeading) > EPSILON) {
                    mixedLeading = true;
                }
            }
        }

        if (pointSize === null) {
            return null;
        }
        if (mixedPointSizes) {
            if (!ours) {
                return { mixedPointSizes: true };
            }
            pointSize = maxPointSize;
        }
        if (mixedLeading && !ours) {
            return { mixedLeading: true };
        }
        if (mixedLeading && ours && maxLeading !== null) {
            leading = maxLeading;
        }
        if (leading === null || leadingWasAuto) {
            leading = Math.round(pointSize * 1.2 * 100) / 100;
        }

        var paragraphStyle = paragraph.appliedParagraphStyle;
        if (!paragraphStyle || !paragraphStyle.isValid) {
            return { invalidParagraphStyle: true };
        }

        return {
            paragraph: paragraph,
            paragraphStyle: paragraphStyle,
            paragraphStyleName: String(paragraphStyle.name),
            contents: contents,
            charCount: contents.length,
            pointSize: pointSize,
            leading: leading,
            leadingWasAuto: leadingWasAuto
        };
    }

    function parseNumber(value) {
        return Number(String(value).replace(",", ".").replace("%", ""));
    }

    function formatNumber(value) {
        var rounded = Math.round(Number(value) * 100) / 100;
        return String(rounded).replace(".", ",");
    }

    function formatStyleNumber(value) {
        var rounded = Math.round(Number(value) * 100) / 100;
        return String(rounded);
    }

    function roundPt(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    function thresholdsFromState(state, info) {
        var ref = refCharCountOf(state, info);
        var first = firstThresholdFromUntil(state.untilCount, ref);
        if (first >= state.lastThreshold) {
            first = state.untilCount + 1;
        }
        if (first >= state.lastThreshold) {
            return [state.lastThreshold];
        }
        return buildThresholds(first, state.lastThreshold, state.stepCount);
    }

    function readStateFromFields(untilCountField, maxPercentField, lastField, minField, state) {
        state.untilCount = parseNumber(untilCountField.text);
        state.maxPercent = parseNumber(maxPercentField.text);
        state.lastThreshold = parseNumber(lastField.text);
        state.minPercent = parseNumber(minField.text);
    }

    function addStep(state) {
        if (state.stepCount < MAX_STEPS) {
            state.stepCount++;
        }
    }

    function removeStep(state) {
        if (state.stepCount > MIN_STEPS) {
            state.stepCount--;
        }
    }

    function stagesFromState(info, state) {
        var thresholds = thresholdsFromState(state, info);
        var percents = percentsForCount(
            thresholds.length,
            state.maxPercent,
            state.minPercent
        );
        var stages = [];
        for (var i = 0; i < thresholds.length; i++) {
            var pct = percents[i];
            stages.push({
                threshold: thresholds[i],
                percent: pct,
                pointSize: sizeAtPercent(info, pct),
                leading: leadingAtPercent(info, pct)
            });
        }
        return stages;
    }

    function choiceFromState(info, state) {
        return {
            untilCount: state.untilCount,
            maxPercent: state.maxPercent,
            minPercent: state.minPercent,
            stepCount: state.stepCount,
            lastThreshold: state.lastThreshold,
            refCharCount: refCharCountOf(state, info),
            basePointSize: info.pointSize,
            baseLeading: info.leading,
            stages: stagesFromState(info, state)
        };
    }

    // Только кегль/интерлиньяж — шрифт, трекинг и прочие оверрайды не трогаем.
    function setParagraphSize(paragraph, pointSize, leading) {
        try {
            var chars = paragraph.characters;
            for (var i = 0; i < chars.length; i++) {
                if (!isVisibleCharacter(chars[i])) {
                    continue;
                }
                chars[i].pointSize = pointSize;
                chars[i].leading = leading;
            }
        } catch (eChars) {
            try {
                paragraph.pointSize = pointSize;
                paragraph.leading = leading;
            } catch (ePara) {}
        }
    }

    // Временный вид ступени: снимаем наши GREP с абзаца и ставим кегль напрямую.
    function previewPercent(info, percent, previewState) {
        var pointSize = sizeAtPercent(info, percent);
        var leading = leadingAtPercent(info, percent);
        logObj("previewPercent", {
            percent: percent,
            pt: pointSize,
            lead: leading,
            wasActive: !!previewState.active
        });
        if (!previewState.active) {
            removeOwnedGrepFrom(info.paragraph);
            previewState.active = true;
        }
        var snap = snapshotCharLook(info.paragraph);
        setParagraphSize(info.paragraph, pointSize, leading);
        restoreCharLook(info.paragraph, snap);
        previewState.lastPercent = percent;
        try {
            app.redraw();
        } catch (eRedraw) {}
    }

    function applyGrepStages(doc, info, choice) {
        var paragraph = info.paragraph;
        clearLengthGrepFrom(paragraph);
        forceNoneCharacterStyle(paragraph, doc);
        releaseSizeToGrep(paragraph, info.pointSize, info.leading);
        var allStages = withBaseStage(info, choice.stages, choice.maxPercent);
        for (var i = 0; i < allStages.length; i++) {
            var stage = allStages[i];
            var characterStyle = ensureCharacterStyle(
                doc,
                stage.pointSize,
                stage.leading
            );
            paragraph.nestedGrepStyles.add({
                appliedCharacterStyle: characterStyle,
                grepExpression: makeExpression(stage.threshold)
            });
        }
    }

    function restoreAfterPreview(doc, info, previewState) {
        if (!previewState.active) {
            log("restoreAfterPreview: nothing to restore");
            return;
        }
        log("restoreAfterPreview: undo preview size");
        resetCharSizeKeepFont(
            info.paragraph,
            info.pointSize,
            info.leading
        );
        if (previewState.hadOurGrep && previewState.restoreChoice) {
            try {
                applyGrepStages(doc, info, previewState.restoreChoice);
                log("restoreAfterPreview: GREP reapplied");
            } catch (e) {
                log("restoreAfterPreview: applyGrepStages FAIL " + e);
            }
        }
        try {
            app.redraw();
        } catch (eRedraw) {}
        previewState.active = false;
    }

    function prepareForApply(info, previewState) {
        logObj("prepareForApply", {
            pt: info.pointSize,
            lead: info.leading
        });
        // Превью могло поставить кегль оверрайдом — отпустить под GREP, шрифт сохранить.
        releaseSizeToGrep(info.paragraph, info.pointSize, info.leading);
        previewState.active = false;
        try {
            app.redraw();
        } catch (eRedraw) {}
    }

    function bindPreviewButton(btn, info, previewState, fields, kind, index) {
        btn.onClick = function () {
            readStateFromFields(
                fields.untilField,
                fields.maxPercentField,
                fields.lastField,
                fields.minField,
                fields.state
            );
            var percent = fields.state.maxPercent;
            if (kind !== "base") {
                var thresholds = thresholdsFromState(fields.state, info);
                var percents = percentsForCount(
                    thresholds.length,
                    fields.state.maxPercent,
                    fields.state.minPercent
                );
                if (index < 0 || index >= percents.length) {
                    return;
                }
                percent = percents[index];
            }
            if (isNaN(percent) || percent <= 0) {
                return;
            }
            previewPercent(info, percent, previewState);
        };
    }

    function stepButtonLabel(threshold, percent, isLast, info) {
        var label = isLast ? "после " : "от ";
        return (
            label + threshold + " → " + percent +
            "%  " + ptLabel(info, percent)
        );
    }

    function baseButtonLabel(untilCount, maxPercent, info) {
        return (
            "до " + untilCount + " → " + maxPercent +
            "%  " + ptLabel(info, maxPercent)
        );
    }

    function showDialogOnce(info, state, previewState) {
        var thresholds = thresholdsFromState(state, info);
        var percents = percentsForCount(
            thresholds.length,
            state.maxPercent,
            state.minPercent
        );

        var dialog = new Window("dialog", SCRIPT_NAME);
        dialog.orientation = "column";
        dialog.alignChildren = ["fill", "top"];

        var panel = dialog.add("panel", undefined, "Края");
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];

        var untilRow = panel.add("group");
        untilRow.add("statictext", undefined, "До").preferredSize.width = 50;
        var untilField = untilRow.add(
            "edittext",
            undefined,
            String(state.untilCount)
        );
        untilField.characters = 5;
        var maxPercentField = untilRow.add(
            "edittext",
            undefined,
            String(state.maxPercent)
        );
        maxPercentField.characters = 5;
        var maxPtLabel = untilRow.add(
            "statictext",
            undefined,
            ptLabel(info, state.maxPercent)
        );
        maxPtLabel.characters = 12;

        var lastRow = panel.add("group");
        lastRow.add("statictext", undefined, "После").preferredSize.width = 50;
        var lastField = lastRow.add(
            "edittext",
            undefined,
            String(state.lastThreshold)
        );
        lastField.characters = 5;
        var minField = lastRow.add(
            "edittext",
            undefined,
            String(state.minPercent)
        );
        minField.characters = 5;
        var minPtLabel = lastRow.add(
            "statictext",
            undefined,
            ptLabel(info, state.minPercent)
        );
        minPtLabel.characters = 12;

        var meta = dialog.add(
            "statictext",
            undefined,
            "От текста: " + info.charCount + " симв. · " +
                formatNumber(info.pointSize) + " pt"
        );

        var stepButtons = dialog.add("group");
        stepButtons.alignment = "left";
        var minusBtn = stepButtons.add("button", undefined, "− шаг");
        var plusBtn = stepButtons.add("button", undefined, "+ шаг");
        minusBtn.enabled = state.stepCount > MIN_STEPS;
        plusBtn.enabled = state.stepCount < MAX_STEPS;

        var preview = dialog.add("panel", undefined, "Ступени · клик = превью");
        preview.orientation = "column";
        preview.alignChildren = ["fill", "top"];

        var fieldRefs = {
            untilField: untilField,
            maxPercentField: maxPercentField,
            lastField: lastField,
            minField: minField,
            state: state
        };

        var baseBtn = preview.add(
            "button",
            undefined,
            baseButtonLabel(state.untilCount, state.maxPercent, info)
        );
        bindPreviewButton(baseBtn, info, previewState, fieldRefs, "base", 0);

        var stepBtns = [];
        for (var i = 0; i < thresholds.length; i++) {
            (function (threshold, percent, isLast, stepIndex) {
                var btn = preview.add(
                    "button",
                    undefined,
                    stepButtonLabel(threshold, percent, isLast, info)
                );
                bindPreviewButton(
                    btn,
                    info,
                    previewState,
                    fieldRefs,
                    "step",
                    stepIndex
                );
                stepBtns.push(btn);
            })(
                thresholds[i],
                percents[i],
                i === thresholds.length - 1,
                i
            );
        }

        function refreshStepLabels() {
            readStateFromFields(
                untilField,
                maxPercentField,
                lastField,
                minField,
                state
            );
            if (
                isNaN(state.untilCount) ||
                isNaN(state.lastThreshold) ||
                isNaN(state.maxPercent) ||
                isNaN(state.minPercent) ||
                state.maxPercent <= 0 ||
                state.minPercent <= 0 ||
                state.minPercent >= state.maxPercent
            ) {
                return false;
            }

            var nextThresholds = thresholdsFromState(state, info);
            var nextPercents = percentsForCount(
                nextThresholds.length,
                state.maxPercent,
                state.minPercent
            );

            // Число ступеней изменилось — пересобрать окно.
            if (nextThresholds.length !== stepBtns.length) {
                return "rebuild";
            }

            try {
                maxPtLabel.text = ptLabel(info, state.maxPercent);
                minPtLabel.text = ptLabel(info, state.minPercent);
                baseBtn.text = baseButtonLabel(
                    state.untilCount,
                    state.maxPercent,
                    info
                );
                for (var s = 0; s < stepBtns.length; s++) {
                    stepBtns[s].text = stepButtonLabel(
                        nextThresholds[s],
                        nextPercents[s],
                        s === stepBtns.length - 1,
                        info
                    );
                }
            } catch (eRefresh) {}
            return true;
        }

        function scheduleRefresh() {
            var status = refreshStepLabels();
            if (status === "rebuild") {
                action = "refresh";
                dialog.close(5);
            }
        }

        untilField.onChange = scheduleRefresh;
        maxPercentField.onChange = scheduleRefresh;
        lastField.onChange = scheduleRefresh;
        minField.onChange = scheduleRefresh;
        // onChanging — по символам (если ScriptUI отдаёт); onChange — при уходе с поля.
        try {
            untilField.onChanging = scheduleRefresh;
            maxPercentField.onChanging = scheduleRefresh;
            lastField.onChanging = scheduleRefresh;
            minField.onChanging = scheduleRefresh;
        } catch (eChanging) {}

        var refreshBtn = dialog.add("button", undefined, "Обновить");
        refreshBtn.alignment = ["fill", "top"];
        try {
            refreshBtn.preferredSize.height = 40;
        } catch (eRefreshSize) {}

        var buttons = dialog.add("group");
        buttons.alignment = "right";
        buttons.add("button", undefined, "Отмена", { name: "cancel" });
        buttons.add("button", undefined, "Создать", { name: "ok" });

        // ScriptUI: OK → 1, Cancel (name:cancel) → 2. ±шаг / refresh — свои коды.
        var action = "cancel";
        minusBtn.onClick = function () {
            action = "remove";
            dialog.close(3);
        };
        plusBtn.onClick = function () {
            action = "add";
            dialog.close(4);
        };
        refreshBtn.onClick = function () {
            var status = refreshStepLabels();
            if (status === "rebuild") {
                action = "refresh";
                dialog.close(5);
            }
        };

        var result = dialog.show();
        if (result === 1) {
            readStateFromFields(untilField, maxPercentField, lastField, minField, state);
            return "ok";
        }
        if (result === 3 || action === "remove") {
            readStateFromFields(untilField, maxPercentField, lastField, minField, state);
            return "remove";
        }
        if (result === 4 || action === "add") {
            readStateFromFields(untilField, maxPercentField, lastField, minField, state);
            return "add";
        }
        if (result === 5 || action === "refresh") {
            readStateFromFields(untilField, maxPercentField, lastField, minField, state);
            return "refresh";
        }
        return "cancel";
    }

    function showDialog(doc, info, textFrame) {
        var state = initialDialogState(info, textFrame);
        var previewState = {
            active: false,
            hadOurGrep: false,
            restoreChoice: null,
            lastPercent: null
        };
        logObj("showDialog: open (no memory)", {
            chars: info.charCount,
            pt: info.pointSize,
            until: state.untilCount,
            basePt: state.basePointSize
        });
        while (true) {
            var action = showDialogOnce(info, state, previewState);
            log("showDialog: action=" + action);
            if (action === "ok") {
                prepareForApply(info, previewState);
                if (!state.refCharCount || state.refCharCount <= 0) {
                    state.refCharCount = state.untilCount > 0
                        ? state.untilCount
                        : info.charCount;
                }
                state.basePointSize = info.pointSize;
                state.baseLeading = info.leading;
                logObj("showDialog: OK", {
                    pt: state.basePointSize,
                    until: state.untilCount,
                    last: state.lastThreshold,
                    steps: state.stepCount
                });
                return choiceFromState(info, state);
            }
            if (action === "cancel") {
                restoreAfterPreview(doc, info, previewState);
                log("showDialog: cancel done");
                return null;
            }
            if (action === "add") {
                addStep(state);
            }
            if (action === "remove") {
                removeStep(state);
            }
            // refresh — переоткрыть диалог с уже прочитанным state
        }
    }

    function withBaseStage(info, stages, maxPercent) {
        if (stages.length && stages[0].threshold === 1) {
            return stages;
        }
        return [
            {
                threshold: 1,
                percent: maxPercent,
                pointSize: sizeAtPercent(info, maxPercent),
                leading: leadingAtPercent(info, maxPercent),
                isBase: true
            }
        ].concat(stages);
    }

    function validateStages(stages, untilCount, maxPercent, minPercent) {
        if (
            isNaN(untilCount) ||
            untilCount < 0 ||
            Math.floor(untilCount) !== untilCount
        ) {
            return "«До» — целое число ≥ 0.";
        }
        if (
            isNaN(maxPercent) ||
            maxPercent <= 0 ||
            maxPercent > 100
        ) {
            return "«До» % — число от 1 до 100.";
        }
        if (
            isNaN(minPercent) ||
            minPercent <= 0 ||
            minPercent >= maxPercent
        ) {
            return "«После» % — больше 0 и меньше % у «До».";
        }
        var previousThreshold = untilCount;
        for (var i = 0; i < stages.length; i++) {
            var stage = stages[i];
            var label = i === stages.length - 1 ? "После" : "От";
            if (
                isNaN(stage.threshold) ||
                stage.threshold < 1 ||
                Math.floor(stage.threshold) !== stage.threshold
            ) {
                return "«" + label + "» — целое положительное число символов.";
            }
            if (stage.threshold <= previousThreshold) {
                return "Пороги должны расти: до < от < … < после.";
            }
            if (stage.pointSize <= 0 || stage.leading <= 0) {
                return "Нулевой кегль/интерлиньяж на ступени «" + label + "».";
            }
            previousThreshold = stage.threshold;
        }
        return "";
    }

    function styleIsOurs(style) {
        if (!style) {
            return false;
        }
        try {
            if (!style.isValid) {
                return false;
            }
        } catch (eValid) {
            return false;
        }
        try {
            if (style.extractLabel(TAG_KEY) === TAG_VALUE) {
                return true;
            }
        } catch (e1) {}
        try {
            if (style.extractLabel(LEGACY_TAG_KEY) === "1") {
                return true;
            }
        } catch (e2) {}
        try {
            return String(style.name).indexOf(LEGACY_STYLE_PREFIX) === 0;
        } catch (e3) {
            return false;
        }
    }

    function markAsOurs(style) {
        try {
            style.insertLabel(TAG_KEY, TAG_VALUE);
        } catch (e) {}
        try {
            // Снять старый ключ, если остался после миграции.
            if (style.extractLabel(LEGACY_TAG_KEY)) {
                style.insertLabel(LEGACY_TAG_KEY, "");
            }
        } catch (e2) {}
    }

    function removeOwnedGrepFrom(container) {
        if (
            !container ||
            !container.nestedGrepStyles ||
            typeof container.nestedGrepStyles.length !== "number"
        ) {
            return 0;
        }
        var removed = 0;
        for (var i = container.nestedGrepStyles.length - 1; i >= 0; i--) {
            try {
                var grepStyle = container.nestedGrepStyles[i];
                var characterStyle = grepStyle.appliedCharacterStyle;
                if (characterStyle && styleIsOurs(characterStyle)) {
                    grepStyle.remove();
                    removed++;
                }
            } catch (e) {}
        }
        return removed;
    }

    // Все GREP длины ^.{N,} на абзаце — и «наши», и бесхозные хвосты.
    function clearLengthGrepFrom(paragraph) {
        if (
            !paragraph ||
            !paragraph.nestedGrepStyles ||
            typeof paragraph.nestedGrepStyles.length !== "number"
        ) {
            return 0;
        }
        var removed = 0;
        for (var i = paragraph.nestedGrepStyles.length - 1; i >= 0; i--) {
            try {
                var grepStyle = paragraph.nestedGrepStyles[i];
                var expr = String(grepStyle.grepExpression || "");
                var ours = false;
                try {
                    ours = styleIsOurs(grepStyle.appliedCharacterStyle);
                } catch (eOurs) {}
                if (ours || /^\^\.\{\d+,/.test(expr)) {
                    log("clearLengthGrep: remove [" + i + "] " + expr);
                    grepStyle.remove();
                    removed++;
                }
            } catch (e) {}
        }
        return removed;
    }

    function snapshotCharLook(paragraph) {
        var out = [];
        try {
            var chars = paragraph.characters;
            for (var i = 0; i < chars.length; i++) {
                if (!isVisibleCharacter(chars[i])) {
                    out.push(null);
                    continue;
                }
                var item = { tracking: 0 };
                try {
                    item.font = chars[i].appliedFont;
                } catch (eF) {}
                try {
                    item.fontStyle = chars[i].fontStyle;
                } catch (eS) {}
                try {
                    item.tracking = chars[i].tracking;
                } catch (eT) {}
                out.push(item);
            }
        } catch (e) {}
        return out;
    }

    function restoreCharLook(paragraph, snap) {
        if (!snap || !snap.length) {
            return;
        }
        try {
            var chars = paragraph.characters;
            var n = Math.min(chars.length, snap.length);
            for (var i = 0; i < n; i++) {
                if (!snap[i] || !isVisibleCharacter(chars[i])) {
                    continue;
                }
                try {
                    if (snap[i].font) {
                        chars[i].appliedFont = snap[i].font;
                    }
                } catch (eF) {}
                try {
                    if (snap[i].fontStyle) {
                        chars[i].fontStyle = snap[i].fontStyle;
                    }
                } catch (eS) {}
                try {
                    chars[i].tracking = snap[i].tracking;
                } catch (eT) {}
            }
            log("restoreCharLook: restored font/tracking on " + n + " slots");
        } catch (e) {
            log("restoreCharLook FAIL " + e);
        }
    }

    // Снять только кегль/интерлиньяж с символов, шрифт вернуть.
    // clearOverrides целиком НЕ используем — сносит лицо шрифта.
    function resetCharSizeKeepFont(paragraph, pointSize, leading) {
        var snap = snapshotCharLook(paragraph);
        try {
            var chars = paragraph.characters;
            for (var i = 0; i < chars.length; i++) {
                if (!isVisibleCharacter(chars[i])) {
                    continue;
                }
                chars[i].pointSize = pointSize;
                chars[i].leading = leading;
            }
        } catch (eChars) {
            try {
                paragraph.pointSize = pointSize;
                paragraph.leading = leading;
            } catch (ePara) {}
        }
        restoreCharLook(paragraph, snap);
        log("resetCharSizeKeepFont: pt=" + pointSize + " lead=" + leading);
    }

    // После превью/ручного кегля: clearOverrides, шрифт вернуть, кегль — с абзаца.
    // Тогда nested GREP сможет менять размер. clearOverrides без restoreCharLook сносит лицо.
    function releaseSizeToGrep(paragraph, basePointSize, baseLeading) {
        var snap = snapshotCharLook(paragraph);
        try {
            paragraph.clearOverrides(OverrideType.CHARACTER_ONLY);
            log("releaseSizeToGrep: CHARACTER_ONLY cleared");
        } catch (e1) {
            log("releaseSizeToGrep: clearOverrides FAIL " + e1);
        }
        try {
            paragraph.pointSize = basePointSize;
            paragraph.leading = baseLeading;
        } catch (ePara) {}
        restoreCharLook(paragraph, snap);
        log("releaseSizeToGrep: base pt=" + basePointSize);
    }

    // Снимает наши GREP с абзацев и стилей (хвосты 2.x), удаляет наши символьные стили.
    // НЕ вызывать на apply: ломает другие фреймы. Оставлено для ручной диагностики.
    function purgeOwnedStyles(doc) {
        var removedGrep = 0;
        var removedChar = 0;

        for (var s = 0; s < doc.stories.length; s++) {
            try {
                var story = doc.stories[s];
                for (var p = 0; p < story.paragraphs.length; p++) {
                    removedGrep += removeOwnedGrepFrom(story.paragraphs[p]);
                }
            } catch (eStory) {}
        }

        for (var ps = 0; ps < doc.paragraphStyles.length; ps++) {
            try {
                removedGrep += removeOwnedGrepFrom(doc.paragraphStyles[ps]);
            } catch (eParaStyle) {}
        }

        for (var c = doc.characterStyles.length - 1; c >= 0; c--) {
            try {
                var style = doc.characterStyles[c];
                if (styleIsOurs(style)) {
                    style.remove();
                    removedChar++;
                }
            } catch (eChar) {}
        }

        return {
            removedGrep: removedGrep,
            removedChar: removedChar
        };
    }

    // Собрать id AFG-стилей, на которые сейчас ссылается nested GREP.
    function collectUsedOwnedStyleIds(doc) {
        var used = {};

        function markFromContainer(container) {
            if (
                !container ||
                !container.nestedGrepStyles ||
                typeof container.nestedGrepStyles.length !== "number"
            ) {
                return;
            }
            for (var i = 0; i < container.nestedGrepStyles.length; i++) {
                try {
                    var characterStyle =
                        container.nestedGrepStyles[i].appliedCharacterStyle;
                    if (characterStyle && styleIsOurs(characterStyle)) {
                        used[String(characterStyle.id)] = true;
                    }
                } catch (eMark) {}
            }
        }

        for (var s = 0; s < doc.stories.length; s++) {
            try {
                var story = doc.stories[s];
                for (var p = 0; p < story.paragraphs.length; p++) {
                    markFromContainer(story.paragraphs[p]);
                }
            } catch (eStory) {}
        }

        for (var ps = 0; ps < doc.paragraphStyles.length; ps++) {
            try {
                markFromContainer(doc.paragraphStyles[ps]);
            } catch (eParaStyle) {}
        }

        return used;
    }

    // Удалить только AFG, на которые никто не ссылается через nested GREP.
    // Не трогает GREP на других абзацах — в отличие от purgeOwnedStyles.
    function purgeUnusedOwnedStyles(doc) {
        var used = collectUsedOwnedStyleIds(doc);
        var removedChar = 0;

        for (var c = doc.characterStyles.length - 1; c >= 0; c--) {
            try {
                var style = doc.characterStyles[c];
                if (!styleIsOurs(style)) {
                    continue;
                }
                if (used[String(style.id)]) {
                    continue;
                }
                style.remove();
                removedChar++;
            } catch (eChar) {}
        }

        log("purgeUnusedOwnedStyles: removed=" + removedChar);
        return removedChar;
    }

    function ensureCharacterStyle(doc, pointSize, leading) {
        var styleName = CHAR_STYLE_BASE + " " +
            formatStyleNumber(pointSize) + "/" + formatStyleNumber(leading);
        var style = doc.characterStyles.itemByName(styleName);

        if (style.isValid && !styleIsOurs(style)) {
            styleName = styleName + " · AFG";
            style = doc.characterStyles.itemByName(styleName);
        }

        if (!style.isValid) {
            style = doc.characterStyles.add({ name: styleName });
        }
        // Только размер — шрифт/начертание не задаём (иначе GREP подменяет лицо).
        style.pointSize = pointSize;
        style.leading = leading;
        try {
            style.appliedFont = NothingEnum.NOTHING;
        } catch (eFont) {}
        try {
            style.fontStyle = NothingEnum.NOTHING;
        } catch (eStyle) {}
        markAsOurs(style);

        return style;
    }

    function makeExpression(threshold) {
        // Символы абзаца целиком (пробелы считаются). Не «буквы подряд».
        // В InDesign точка не матчит конец абзаца.
        return "^.{" + threshold + ",}";
    }

    function applySetup(doc, info, textFrame, choice) {
        log("applySetup: start");
        var paragraph = info.paragraph;
        var stages = choice.stages;
        var untilCount = choice.untilCount;
        var maxPercent = choice.maxPercent;
        if (
            !paragraph.nestedGrepStyles ||
            typeof paragraph.nestedGrepStyles.add !== "function"
        ) {
            throw new Error("InDesign не даёт добавить локальные GREP к абзацу.");
        }

        var beforeCount = 0;
        try {
            beforeCount = paragraph.nestedGrepStyles.length;
        } catch (eB) {}
        log("applySetup: nestedGrep before clear=" + beforeCount);

        var blockedBefore = findBlockingCharacterStyle(paragraph);
        if (blockedBefore) {
            log("applySetup: blockedBefore=" + blockedBefore);
            throw new Error(blockingStyleMessage(blockedBefore));
        }

        // Только этот абзац. НЕ purge AFG-стилей на весь документ.
        var cleared = clearLengthGrepFrom(paragraph);
        log("applySetup: clearLengthGrep=" + cleared);

        forceNoneCharacterStyle(paragraph, doc);
        releaseSizeToGrep(paragraph, info.pointSize, info.leading);

        var allStages = withBaseStage(info, stages, maxPercent);
        log("applySetup: allStages=" + allStages.length +
            " basePt=" + info.pointSize);

        var summary = [];
        for (var i = 0; i < allStages.length; i++) {
            var stage = allStages[i];
            var characterStyle = ensureCharacterStyle(
                doc,
                stage.pointSize,
                stage.leading
            );
            var expression = makeExpression(stage.threshold);

            paragraph.nestedGrepStyles.add({
                appliedCharacterStyle: characterStyle,
                grepExpression: expression
            });

            var prefix = stage.isBase
                ? "до " + untilCount + " · "
                : i === allStages.length - 1
                    ? "после "
                    : "от ";
            var line =
                prefix +
                (stage.isBase ? "" : stage.threshold + " ") +
                formatNumber(stage.percent) + "% (" +
                ptLabel(info, stage.percent) + ") → " + characterStyle.name;
            summary.push(line);
            log("applySetup: +" + expression + " → " + characterStyle.name +
                " @" + stage.pointSize + "pt");
        }

        // НЕ clearOverrides после GREP.

        saveSettings(textFrame, {
            untilCount: choice.untilCount,
            lastThreshold: choice.lastThreshold,
            stepCount: choice.stepCount,
            maxPercent: choice.maxPercent,
            minPercent: choice.minPercent,
            refCharCount: choice.refCharCount,
            basePointSize: choice.basePointSize || info.pointSize,
            baseLeading: choice.baseLeading || info.leading
        }, info);

        var grepCount = 0;
        try {
            grepCount = paragraph.nestedGrepStyles.length;
        } catch (eG) {}
        log("applySetup: done nestedGrepStyles=" + grepCount +
            " expected=" + allStages.length);

        // После новых GREP: выкинуть осиротевшие AFG от прошлых прогонов/превью.
        var purgedUnused = purgeUnusedOwnedStyles(doc);
        log("applySetup: purgedUnusedAFG=" + purgedUnused);

        try {
            app.redraw();
        } catch (eRedraw) {}

        alert(
            SCRIPT_NAME + "\n\nGREP: " + grepCount +
            " / " + allStages.length + "\n\n" +
            summary.join("\n") +
            "\n\nУдалено лишних AFG: " + purgedUnused +
            "\n\nДлинный адрес → кегль падает.\nШрифт сохраняем (2.26)."
        );
    }
    function main() {
        log("======== main start " + SCRIPT_NAME + " ========");
        if (app.documents.length === 0) {
            fail("Сначала откройте документ.");
            return;
        }
        if (!app.selection || app.selection.length !== 1) {
            fail("Выберите один текстовый фрейм или поставьте курсор в его текст.");
            return;
        }

        var textFrame = resolveTextFrame(app.selection[0]);
        if (!textFrame || !textFrame.isValid) {
            fail("Выбранный объект не является текстовым фреймом.");
            return;
        }

        // Снять ВСЕ length-GREP с абзаца, чтобы читать живой кегль.
        try {
            var paras = textFrame.paragraphs;
            for (var pi = 0; pi < paras.length; pi++) {
                clearLengthGrepFrom(paras[pi]);
            }
        } catch (eStrip) {}
        clearSavedSettings(textFrame);
        try {
            app.redraw();
        } catch (eRedraw0) {}

        var info = getTextInfo(textFrame);
        if (!info) {
            fail("Во фрейме должен быть ровно один непустой абзац.");
            return;
        }
        if (info.invalidFormatting) {
            fail("Не удалось определить кегль текста.");
            return;
        }
        if (info.mixedPointSizes) {
            fail("У текста смешанный кегль. Сначала задайте единый кегль.");
            return;
        }
        if (info.mixedLeading) {
            fail("У текста смешанный интерлиньяж. Сначала задайте единый интерлиньяж.");
            return;
        }
        if (info.invalidParagraphStyle) {
            fail("Не удалось определить стиль абзаца.");
            return;
        }
        if (info.charCount < 1) {
            fail("Во фрейме нет текста.");
            return;
        }

        logObj("main: live text", {
            chars: info.charCount,
            pt: info.pointSize,
            lead: info.leading,
            grep: paragraphHasOurGrep(info.paragraph),
            text: String(info.contents).substr(0, 40)
        });

        var blockedAtStart = findBlockingCharacterStyle(info.paragraph);
        if (blockedAtStart) {
            log("main: blockedAtStart=" + blockedAtStart);
            fail(blockingStyleMessage(blockedAtStart));
            return;
        }

        var choice = showDialog(app.activeDocument, info, textFrame);
        if (!choice) {
            log("main: cancelled");
            return;
        }

        var validationError = validateStages(
            choice.stages,
            choice.untilCount,
            choice.maxPercent,
            choice.minPercent
        );
        if (validationError) {
            log("main: validation " + validationError);
            fail(validationError);
            return;
        }

        applySetup(app.activeDocument, info, textFrame, choice);
        log("main: success");
    }

    try {
        app.doScript(
            main,
            ScriptLanguage.JAVASCRIPT,
            undefined,
            UndoModes.ENTIRE_SCRIPT,
            SCRIPT_NAME
        );
    } catch (e) {
        log("FATAL " + e);
        fail("Ошибка: " + e.message + (e.line ? "\nСтрока: " + e.line : ""));
    }
})();
