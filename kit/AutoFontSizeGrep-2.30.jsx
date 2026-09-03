// AutoFontSizeGrep-2.30.jsx
// Локальные nested GREP на выбранный абзац: длиннее текст → меньше кегль.
// Выражение: ^.{N,}  (один абзац, без переносов).
// Порядок: база ^.{1,} первой, дальше пороги по возрастанию.
//
// 2.30: «До» = текущая длина текста. Дефолт: 8 ступеней, «После» ≈ ×2.7
// (13 → 35), нижний % = 67.
//
// Оверрайд кегля на тексте перекрывает nested GREP — перед установкой кегль
// возвращается к значению стиля абзаца (шрифт/трекинг/цвет не трогаем).
// Без памяти на фрейме. Отмена возвращает исходные GREP и кегль.
// Лог: ~/Desktop/AutoFontSizeGrep.log
// [None] на символах обязателен.
// Владение: label dt.sandbox.autofontsize.grep = owned

(function () {
    var SCRIPT_NAME = "Auto Font Size GREP 2.30";
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
    var DEFAULT_STEPS = 8;
    // «После» относительно текущего текста («До»). 13 → 35.
    var LAST_RATIO = 2.7;
    var DEFAULT_MIN_PERCENT = 67;
    // Доля «потерянного» масштаба кегля, которую интерлиньяж сохраняет.
    // 0 = как кегль; 1 = интерлиньяж не уменьшается. ~0.3 = чуть мягче.
    var LEADING_SOFTEN = 0.3;
    var AUTO_LEADING_FALLBACK = 1.2;
    var LOG_PATH = Folder.desktop.fsName + "/AutoFontSizeGrep.log";
    // Канон 2.26/2.28: ^.{N,}. 2.27 успел наставить ^[^\r]{N,} — тоже снимаем.
    var LENGTH_GREP_RE = /^\^(?:\.|\[\^\\r\])\{(\d+),\}$/;

    var SILENT = false;
    var AFG_ARGS = {
        cancel: false,
        until: "",
        last: "",
        steps: "",
        max: "",
        min: ""
    };
    var REPORT = [];

    // ---------------------------------------------------------------- utils

    function readScriptArg(name) {
        try {
            if (app.scriptArgs.isDefined(name)) {
                return String(app.scriptArgs.getValue(name));
            }
        } catch (e) {}
        return "";
    }

    // scriptArgs живут в процессе InDesign. Прочитали — сразу вытерли,
    // иначе следующий запуск из панели скриптов уйдёт в silent без окна.
    function consumeAfgArgs() {
        SILENT = readScriptArg("afgSilent") === "1";
        AFG_ARGS.cancel = readScriptArg("afgCancel") === "1";
        AFG_ARGS.until = readScriptArg("afgUntil");
        AFG_ARGS.last = readScriptArg("afgLast");
        AFG_ARGS.steps = readScriptArg("afgSteps");
        AFG_ARGS.max = readScriptArg("afgMax");
        AFG_ARGS.min = readScriptArg("afgMin");
        try {
            app.scriptArgs.clear();
        } catch (eClear) {
            var names = [
                "afgSilent", "afgCancel", "afgUntil", "afgLast",
                "afgSteps", "afgMax", "afgMin", "afgPath"
            ];
            for (var i = 0; i < names.length; i++) {
                try {
                    app.scriptArgs.setValue(names[i], "");
                } catch (eSet) {}
            }
        }
    }

    function log(msg) {
        try {
            var f = new File(LOG_PATH);
            f.encoding = "UTF-8";
            f.open("a");
            f.writeln(new Date().toString() + " | " + String(msg));
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

    function report(msg) {
        REPORT.push(String(msg));
        log(msg);
    }

    function publishReport() {
        try {
            $.global.afgLastReport = REPORT.join("\n");
        } catch (e) {}
    }

    function fail(message) {
        report("FAIL: " + message);
        publishReport();
        if (!SILENT) {
            alert(SCRIPT_NAME + "\n\n" + message);
        }
    }

    function notify(message) {
        report(message);
        publishReport();
        if (!SILENT) {
            alert(SCRIPT_NAME + "\n\n" + message);
        }
    }

    function redraw() {
        try {
            app.redraw();
        } catch (e) {}
    }

    function toArray(value) {
        if (value instanceof Array) {
            return value;
        }
        if (value === undefined || value === null) {
            return [];
        }
        return [value];
    }

    // everyItem() на однородном/одиночном наборе может вернуть скаляр.
    function expandTo(values, n) {
        var arr = toArray(values);
        if (arr.length === n) {
            return arr;
        }
        if (arr.length === 1 && n > 1) {
            var out = [];
            for (var i = 0; i < n; i++) {
                out.push(arr[0]);
            }
            return out;
        }
        return arr;
    }

    function parseNumber(value) {
        return Number(String(value).replace(",", ".").replace("%", ""));
    }

    function formatNumber(value) {
        var rounded = Math.round(Number(value) * 100) / 100;
        return String(rounded).replace(".", ",");
    }

    function formatStyleNumber(value) {
        return String(Math.round(Number(value) * 100) / 100);
    }

    function roundPt(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    function usableLeading(value) {
        var number = Number(value);
        if (isNaN(number) || number <= 0 || number > 5000) {
            return null;
        }
        return number;
    }

    function isParagraphReturn(contents) {
        return String(contents) === "\r";
    }

    // ------------------------------------------------------------- numbers

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
        var byLength = Math.round(100 / growth);
        var bySteps = 100 - state.stepCount * 10;
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
            return [lastThreshold];
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

    // «До N» = N символов ещё 100%; первая ступень с N+1.
    // null — если поля не складываются в возрастающие пороги.
    function thresholdsFromState(state) {
        var until = Number(state.untilCount);
        var last = Number(state.lastThreshold);
        if (isNaN(until) || isNaN(last)) {
            return null;
        }
        var first = until + 1;
        if (first > last) {
            return null;
        }
        var n = Math.min(state.stepCount, last - first + 1);
        if (n < 2) {
            return [last];
        }
        return buildThresholds(first, last, n);
    }

    function defaultDialogState(info) {
        var untilCount = info.charCount;
        var lastThreshold = Math.round(info.charCount * LAST_RATIO);
        if (lastThreshold <= untilCount) {
            lastThreshold = untilCount + DEFAULT_STEPS * charStep(info.charCount);
        }
        return {
            untilCount: untilCount,
            lastThreshold: lastThreshold,
            stepCount: DEFAULT_STEPS,
            maxPercent: 100,
            minPercent: DEFAULT_MIN_PERCENT
        };
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

    function stagesFromState(info, state) {
        var thresholds = thresholdsFromState(state);
        if (!thresholds) {
            return [];
        }
        var percents = percentsForCount(
            thresholds.length,
            state.maxPercent,
            state.minPercent
        );
        var stages = [];
        for (var i = 0; i < thresholds.length; i++) {
            stages.push({
                threshold: thresholds[i],
                percent: percents[i],
                pointSize: sizeAtPercent(info, percents[i]),
                leading: leadingAtPercent(info, percents[i])
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
            stages: stagesFromState(info, state)
        };
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
        if (isNaN(maxPercent) || maxPercent <= 0 || maxPercent > 100) {
            return "«До» % — число от 1 до 100.";
        }
        if (isNaN(minPercent) || minPercent <= 0 || minPercent >= maxPercent) {
            return "«После» % — больше 0 и меньше % у «До».";
        }
        if (!stages.length) {
            return "«После» должно быть больше «До».";
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

    // Ступень, которая сейчас действует для charCount символов.
    function stageForCount(allStages, charCount) {
        var best = null;
        for (var i = 0; i < allStages.length; i++) {
            if (allStages[i].threshold <= charCount) {
                if (!best || allStages[i].threshold > best.threshold) {
                    best = allStages[i];
                }
            }
        }
        return best;
    }

    // -------------------------------------------------------------- styles

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
            if (style.extractLabel(LEGACY_TAG_KEY)) {
                style.insertLabel(LEGACY_TAG_KEY, "");
            }
        } catch (e2) {}
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

    // Чужой стиль символов перекрывает nested GREP. Наши AFG — ок.
    function isBlockingCharacterStyle(style) {
        if (isNoneCharacterStyle(style)) {
            return false;
        }
        return !styleIsOurs(style);
    }

    function findBlockingCharacterStyle(paragraph) {
        var styles = [];
        try {
            styles = toArray(paragraph.characters.everyItem().appliedCharacterStyle);
        } catch (eChars) {}
        for (var i = 0; i < styles.length; i++) {
            if (isBlockingCharacterStyle(styles[i])) {
                try {
                    return String(styles[i].name);
                } catch (eName) {
                    return "?";
                }
            }
        }
        return null;
    }

    function blockingStyleMessage(styleName) {
        return (
            "На тексте стоит стиль символов «" + styleName + "».\n" +
            "Нужен [None] — иначе он перекрывает GREP-ступени.\n\n" +
            "Снимите стиль символов (оставьте [None]) и запустите снова."
        );
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
        // Только размер — шрифт/начертание не задаём, иначе GREP подменит лицо.
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

    // ---------------------------------------------------------------- GREP

    // Символы абзаца целиком (пробелы считаются). В контексте задачи
    // переносов во фрейме нет.
    function makeExpression(threshold) {
        return "^.{" + threshold + ",}";
    }

    function lengthThresholdOf(expression) {
        var match = LENGTH_GREP_RE.exec(String(expression || ""));
        return match ? Number(match[1]) : null;
    }

    function grepEntriesOf(container) {
        var out = [];
        if (
            !container ||
            !container.nestedGrepStyles ||
            typeof container.nestedGrepStyles.length !== "number"
        ) {
            return out;
        }
        for (var i = 0; i < container.nestedGrepStyles.length; i++) {
            try {
                var grepStyle = container.nestedGrepStyles[i];
                var style = null;
                try {
                    style = grepStyle.appliedCharacterStyle;
                } catch (eStyle) {}
                var expression = String(grepStyle.grepExpression || "");
                out.push({
                    index: i,
                    expression: expression,
                    style: style,
                    ours: styleIsOurs(style),
                    threshold: lengthThresholdOf(expression)
                });
            } catch (e) {}
        }
        return out;
    }

    function snapshotGrep(paragraph) {
        var entries = grepEntriesOf(paragraph);
        var text = [];
        for (var i = 0; i < entries.length; i++) {
            var name = "?";
            try {
                name = entries[i].style ? String(entries[i].style.name) : "-";
            } catch (e) {}
            text.push(entries[i].expression + " → " + name);
        }
        log("snapshotGrep: " + entries.length + " [" + text.join(" | ") + "]");
        return entries;
    }

    // Снять с абзаца наши GREP и любые length-GREP (хвосты старых версий).
    function clearLengthGrepFrom(paragraph) {
        var entries = grepEntriesOf(paragraph);
        var removed = 0;
        for (var i = entries.length - 1; i >= 0; i--) {
            if (!entries[i].ours && entries[i].threshold === null) {
                continue;
            }
            try {
                paragraph.nestedGrepStyles[entries[i].index].remove();
                removed++;
            } catch (e) {
                log("clearLengthGrep: remove FAIL " + e);
            }
        }
        if (removed) {
            log("clearLengthGrep: removed=" + removed);
        }
        return removed;
    }

    function removeAllGrepFrom(paragraph) {
        try {
            for (var i = paragraph.nestedGrepStyles.length - 1; i >= 0; i--) {
                paragraph.nestedGrepStyles[i].remove();
            }
        } catch (e) {}
    }

    // Вернуть GREP как было (порядок сохраняется).
    function restoreGrep(paragraph, snapshot) {
        removeAllGrepFrom(paragraph);
        var restored = 0;
        for (var i = 0; i < snapshot.length; i++) {
            var entry = snapshot[i];
            try {
                if (!entry.style || !entry.style.isValid) {
                    continue;
                }
                paragraph.nestedGrepStyles.add({
                    appliedCharacterStyle: entry.style,
                    grepExpression: entry.expression
                });
                restored++;
            } catch (e) {
                log("restoreGrep: FAIL " + entry.expression + " " + e);
            }
        }
        log("restoreGrep: restored=" + restored + "/" + snapshot.length);
        return restored;
    }

    // База из уже стоящего AFG-GREP ^…{1,}: кегль и интерлиньяж стиля.
    function baseFromGrepSnapshot(snapshot) {
        for (var i = 0; i < snapshot.length; i++) {
            var entry = snapshot[i];
            if (!entry.ours || entry.threshold !== 1 || !entry.style) {
                continue;
            }
            try {
                var size = Number(entry.style.pointSize);
                if (isNaN(size) || size <= 0) {
                    continue;
                }
                return {
                    pointSize: size,
                    leading: usableLeading(entry.style.leading)
                };
            } catch (e) {}
        }
        return null;
    }

    // ---------------------------------------------------------------- text

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

    function paragraphHasText(paragraph) {
        var contents = [];
        try {
            contents = toArray(paragraph.characters.everyItem().contents);
        } catch (e) {
            return false;
        }
        for (var i = 0; i < contents.length; i++) {
            if (!isParagraphReturn(contents[i])) {
                return true;
            }
        }
        return false;
    }

    function findSingleParagraph(textFrame) {
        var paragraphs = textFrame.paragraphs;
        var found = null;
        var count = 0;
        for (var i = 0; i < paragraphs.length; i++) {
            if (paragraphHasText(paragraphs[i])) {
                found = paragraphs[i];
                count++;
            }
        }
        return count === 1 ? found : null;
    }

    function getTextInfo(paragraph) {
        var chars = paragraph.characters;
        var n = chars.length;
        var contents, sizes, leads;
        try {
            contents = expandTo(chars.everyItem().contents, n);
            sizes = expandTo(chars.everyItem().pointSize, n);
            leads = expandTo(chars.everyItem().leading, n);
        } catch (eRead) {
            return { invalidFormatting: true };
        }
        var m = Math.min(contents.length, sizes.length, leads.length);

        var charCount = 0;
        var text = "";
        var pointSize = null;
        var mixedPointSizes = false;
        var leadingRaw = null;
        var mixedLeading = false;

        for (var i = 0; i < m; i++) {
            if (isParagraphReturn(contents[i])) {
                continue;
            }
            charCount++;
            var c = String(contents[i]);
            text += c.length === 1 ? c : "|";

            var currentSize = Number(sizes[i]);
            if (isNaN(currentSize) || currentSize <= 0) {
                return { invalidFormatting: true };
            }
            if (pointSize === null) {
                pointSize = currentSize;
            } else if (Math.abs(pointSize - currentSize) > EPSILON) {
                mixedPointSizes = true;
            }

            var currentLeading = usableLeading(leads[i]);
            if (leadingRaw === null) {
                leadingRaw = currentLeading === null ? "auto" : currentLeading;
            } else if (currentLeading === null) {
                if (leadingRaw !== "auto") {
                    mixedLeading = true;
                }
            } else if (
                leadingRaw === "auto" ||
                Math.abs(leadingRaw - currentLeading) > EPSILON
            ) {
                mixedLeading = true;
            }
        }

        if (pointSize === null || charCount < 1) {
            return null;
        }
        if (mixedPointSizes) {
            return { mixedPointSizes: true };
        }
        if (mixedLeading) {
            return { mixedLeading: true };
        }

        var paragraphStyle = paragraph.appliedParagraphStyle;
        if (!paragraphStyle || !paragraphStyle.isValid) {
            return { invalidParagraphStyle: true };
        }
        var styleSize = Number(paragraphStyle.pointSize);
        var styleLeading = null;
        try {
            styleLeading = usableLeading(paragraphStyle.leading);
        } catch (eLead) {}

        var autoRatio = AUTO_LEADING_FALLBACK;
        try {
            var autoPercent = Number(paragraph.autoLeading);
            if (!isNaN(autoPercent) && autoPercent > 0) {
                autoRatio = autoPercent / 100;
            }
        } catch (eAuto) {}

        var leadingWasAuto = leadingRaw === "auto";
        var liveLeading = leadingWasAuto ? null : leadingRaw;
        var sizeOverridden = isNaN(styleSize)
            ? true
            : Math.abs(pointSize - styleSize) > EPSILON;
        var leadingOverridden;
        if (liveLeading === null && styleLeading === null) {
            leadingOverridden = false;
        } else if (liveLeading === null || styleLeading === null) {
            leadingOverridden = true;
        } else {
            leadingOverridden = Math.abs(liveLeading - styleLeading) > EPSILON;
        }

        return {
            paragraph: paragraph,
            paragraphStyle: paragraphStyle,
            paragraphStyleName: String(paragraphStyle.name),
            contents: text,
            charCount: charCount,
            pointSize: pointSize,
            leading: leadingWasAuto
                ? roundPt(pointSize * autoRatio)
                : liveLeading,
            leadingWasAuto: leadingWasAuto,
            autoRatio: autoRatio,
            livePointSize: pointSize,
            liveLeading: liveLeading,
            styleSize: styleSize,
            styleLeading: styleLeading,
            sizeOverridden: sizeOverridden,
            leadingOverridden: leadingOverridden
        };
    }

    // ---------------------------------------------------------------- size

    // На весь абзац вместе с символом конца абзаца. Шрифт и прочее не трогаем.
    function setTextSize(paragraph, pointSize, leading) {
        try {
            paragraph.pointSize = pointSize;
        } catch (eSize) {
            log("setTextSize: pointSize FAIL " + eSize);
        }
        try {
            paragraph.leading = leading;
        } catch (eLead) {
            log("setTextSize: leading FAIL " + eLead);
        }
    }

    function styleLeadingValue(info) {
        return info.styleLeading === null ? Leading.AUTO : info.styleLeading;
    }

    // Кегль/интерлиньяж = значения стиля абзаца → InDesign снимает оверрайд,
    // и nested GREP снова управляет размером.
    function releaseSizeToStyle(info) {
        setTextSize(info.paragraph, info.styleSize, styleLeadingValue(info));
        log("releaseSizeToStyle: pt=" + info.styleSize +
            " lead=" + styleLeadingValue(info));
    }

    // Вернуть кегль как был до запуска: живой оверрайд или значение стиля.
    function restoreLiveSize(info) {
        var pt = info.sizeOverridden ? info.livePointSize : info.styleSize;
        var lead;
        if (info.leadingOverridden) {
            lead = info.liveLeading === null ? Leading.AUTO : info.liveLeading;
        } else {
            lead = styleLeadingValue(info);
        }
        setTextSize(info.paragraph, pt, lead);
        log("restoreLiveSize: pt=" + pt + " lead=" + lead);
    }

    // Временный вид ступени: кегль напрямую (GREP на время диалога сняты).
    function previewPercent(info, percent, previewState) {
        var pointSize = sizeAtPercent(info, percent);
        var leading = leadingAtPercent(info, percent);
        logObj("previewPercent", { percent: percent, pt: pointSize, lead: leading });
        setTextSize(info.paragraph, pointSize, leading);
        previewState.active = true;
        previewState.lastPercent = percent;
        redraw();
    }

    function restoreOriginal(info, grepSnapshot, previewState) {
        if (previewState && previewState.active) {
            restoreLiveSize(info);
            previewState.active = false;
        }
        restoreGrep(info.paragraph, grepSnapshot);
        redraw();
    }

    // -------------------------------------------------------------- purge

    function markUsedFrom(container, used) {
        var entries = grepEntriesOf(container);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].ours) {
                try {
                    used[String(entries[i].style.id)] = true;
                } catch (e) {}
            }
        }
    }

    function markUsedInParagraphs(paragraphs, used) {
        for (var p = 0; p < paragraphs.length; p++) {
            try {
                if (paragraphs[p].nestedGrepStyles.length > 0) {
                    markUsedFrom(paragraphs[p], used);
                }
            } catch (e) {}
        }
    }

    // id AFG-стилей, на которые сейчас ссылается хоть один nested GREP.
    function collectUsedOwnedStyleIds(doc) {
        var used = {};
        for (var s = 0; s < doc.stories.length; s++) {
            try {
                var story = doc.stories[s];
                markUsedInParagraphs(story.paragraphs, used);
                var tables = story.tables;
                for (var t = 0; t < tables.length; t++) {
                    var cells = tables[t].cells;
                    for (var c = 0; c < cells.length; c++) {
                        markUsedInParagraphs(cells[c].paragraphs, used);
                    }
                }
            } catch (eStory) {}
        }
        var paraStyles = [];
        try {
            paraStyles = doc.allParagraphStyles;
        } catch (eAll) {
            paraStyles = doc.paragraphStyles;
        }
        for (var ps = 0; ps < paraStyles.length; ps++) {
            try {
                markUsedFrom(paraStyles[ps], used);
            } catch (eParaStyle) {}
        }
        return used;
    }

    // Удалить только AFG, на которые никто не ссылается. Чужие GREP не трогаем.
    function purgeUnusedOwnedStyles(doc) {
        var used = collectUsedOwnedStyleIds(doc);
        var removed = 0;
        var styles = [];
        try {
            styles = doc.allCharacterStyles;
        } catch (eAll) {
            styles = doc.characterStyles;
        }
        for (var c = styles.length - 1; c >= 0; c--) {
            try {
                var style = styles[c];
                if (!styleIsOurs(style) || used[String(style.id)]) {
                    continue;
                }
                style.remove();
                removed++;
            } catch (eChar) {}
        }
        log("purgeUnusedOwnedStyles: removed=" + removed);
        return removed;
    }

    // ------------------------------------------------------------- dialog

    function readStateFromFields(fields, state) {
        state.untilCount = parseNumber(fields.untilField.text);
        state.maxPercent = parseNumber(fields.maxPercentField.text);
        state.lastThreshold = parseNumber(fields.lastField.text);
        state.minPercent = parseNumber(fields.minField.text);
    }

    function stateLooksValid(state) {
        return !(
            isNaN(state.untilCount) ||
            isNaN(state.lastThreshold) ||
            isNaN(state.maxPercent) ||
            isNaN(state.minPercent) ||
            state.maxPercent <= 0 ||
            state.minPercent <= 0 ||
            state.minPercent >= state.maxPercent
        );
    }

    function stepButtonLabel(threshold, percent, isLast, info) {
        return (
            (isLast ? "после " : "от ") + threshold + " → " + percent +
            "%  " + ptLabel(info, percent)
        );
    }

    function baseButtonLabel(untilCount, maxPercent, info) {
        return (
            "до " + untilCount + " → " + maxPercent +
            "%  " + ptLabel(info, maxPercent)
        );
    }

    function bindPreviewButton(btn, info, previewState, fields, kind, index) {
        btn.onClick = function () {
            readStateFromFields(fields, fields.state);
            if (!stateLooksValid(fields.state)) {
                return;
            }
            var percent = fields.state.maxPercent;
            if (kind !== "base") {
                var thresholds = thresholdsFromState(fields.state);
                if (!thresholds) {
                    return;
                }
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

    // Возвращает "ok" | "cancel" | "add" | "remove" | "rebuild".
    function showDialogOnce(info, state, previewState) {
        var thresholds = thresholdsFromState(state) || [state.lastThreshold];
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
        var untilField = untilRow.add("edittext", undefined, String(state.untilCount));
        untilField.characters = 5;
        var maxPercentField = untilRow.add("edittext", undefined, String(state.maxPercent));
        maxPercentField.characters = 5;
        var maxPtLabel = untilRow.add("statictext", undefined, ptLabel(info, state.maxPercent));
        maxPtLabel.characters = 12;

        var lastRow = panel.add("group");
        lastRow.add("statictext", undefined, "После").preferredSize.width = 50;
        var lastField = lastRow.add("edittext", undefined, String(state.lastThreshold));
        lastField.characters = 5;
        var minField = lastRow.add("edittext", undefined, String(state.minPercent));
        minField.characters = 5;
        var minPtLabel = lastRow.add("statictext", undefined, ptLabel(info, state.minPercent));
        minPtLabel.characters = 12;

        dialog.add(
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

        var fields = {
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
        bindPreviewButton(baseBtn, info, previewState, fields, "base", 0);

        var stepBtns = [];
        for (var i = 0; i < thresholds.length; i++) {
            var btn = preview.add(
                "button",
                undefined,
                stepButtonLabel(thresholds[i], percents[i], i === thresholds.length - 1, info)
            );
            bindPreviewButton(btn, info, previewState, fields, "step", i);
            stepBtns.push(btn);
        }

        // true — подписи обновлены; false — поля пока невалидны;
        // "rebuild" — число ступеней изменилось, окно надо пересобрать.
        function refreshStepLabels() {
            readStateFromFields(fields, state);
            if (!stateLooksValid(state)) {
                return false;
            }
            var nextThresholds = thresholdsFromState(state);
            if (!nextThresholds) {
                return false;
            }
            if (nextThresholds.length !== stepBtns.length) {
                return "rebuild";
            }
            var nextPercents = percentsForCount(
                nextThresholds.length,
                state.maxPercent,
                state.minPercent
            );
            try {
                maxPtLabel.text = ptLabel(info, state.maxPercent);
                minPtLabel.text = ptLabel(info, state.minPercent);
                baseBtn.text = baseButtonLabel(state.untilCount, state.maxPercent, info);
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

        // При наборе окно не пересобираем — иначе оно мигает на каждой цифре.
        function onTyping() {
            refreshStepLabels();
        }
        untilField.onChange = onTyping;
        maxPercentField.onChange = onTyping;
        lastField.onChange = onTyping;
        minField.onChange = onTyping;
        try {
            untilField.onChanging = onTyping;
            maxPercentField.onChanging = onTyping;
            lastField.onChanging = onTyping;
            minField.onChanging = onTyping;
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

        // ScriptUI: OK → 1, Cancel → 2. Свои коды: 3 remove, 4 add, 5 rebuild.
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
            if (refreshStepLabels() === "rebuild") {
                action = "rebuild";
                dialog.close(5);
            }
        };

        var result = dialog.show();
        if (result === 1) {
            readStateFromFields(fields, state);
            return "ok";
        }
        if (result === 3 || action === "remove") {
            readStateFromFields(fields, state);
            return "remove";
        }
        if (result === 4 || action === "add") {
            readStateFromFields(fields, state);
            return "add";
        }
        if (result === 5 || action === "rebuild") {
            readStateFromFields(fields, state);
            return "rebuild";
        }
        return "cancel";
    }

    function showDialog(info, previewState) {
        var state = defaultDialogState(info);
        logObj("showDialog: open", {
            chars: info.charCount,
            pt: info.pointSize,
            until: state.untilCount,
            last: state.lastThreshold
        });
        while (true) {
            var action = showDialogOnce(info, state, previewState);
            log("showDialog: action=" + action);
            if (action === "cancel") {
                return null;
            }
            if (action === "ok") {
                var choice = choiceFromState(info, state);
                var error = validateStages(
                    choice.stages,
                    choice.untilCount,
                    choice.maxPercent,
                    choice.minPercent
                );
                if (error) {
                    log("showDialog: validation " + error);
                    alert(SCRIPT_NAME + "\n\n" + error);
                    continue;
                }
                return choice;
            }
            if (action === "add" && state.stepCount < MAX_STEPS) {
                state.stepCount++;
            }
            if (action === "remove" && state.stepCount > MIN_STEPS) {
                state.stepCount--;
            }
            // rebuild — просто переоткрыть с уже прочитанным state.
        }
    }

    function silentChoice(info) {
        var state = defaultDialogState(info);
        var v;
        v = AFG_ARGS.until;
        if (v !== "") {
            state.untilCount = parseNumber(v);
        }
        v = AFG_ARGS.last;
        if (v !== "") {
            state.lastThreshold = parseNumber(v);
        }
        v = AFG_ARGS.steps;
        if (v !== "") {
            state.stepCount = Math.max(MIN_STEPS, Math.min(MAX_STEPS, parseNumber(v)));
        }
        v = AFG_ARGS.max;
        if (v !== "") {
            state.maxPercent = parseNumber(v);
        }
        v = AFG_ARGS.min;
        if (v !== "") {
            state.minPercent = parseNumber(v);
        } else if (AFG_ARGS.until !== "" || AFG_ARGS.last !== "") {
            state.minPercent = minPercentFor(state);
        }
        var choice = choiceFromState(info, state);
        var error = validateStages(
            choice.stages,
            choice.untilCount,
            choice.maxPercent,
            choice.minPercent
        );
        if (error) {
            fail(error);
            return null;
        }
        return choice;
    }

    // -------------------------------------------------------------- apply

    function applySetup(doc, info, choice) {
        var paragraph = info.paragraph;
        log("applySetup: start");
        if (
            !paragraph.nestedGrepStyles ||
            typeof paragraph.nestedGrepStyles.add !== "function"
        ) {
            throw new Error("InDesign не даёт добавить локальные GREP к абзацу.");
        }

        var blocked = findBlockingCharacterStyle(paragraph);
        if (blocked) {
            throw new Error(blockingStyleMessage(blocked));
        }

        clearLengthGrepFrom(paragraph);
        // Оверрайд кегля перекрыл бы GREP — отпускаем размер на стиль абзаца.
        releaseSizeToStyle(info);

        var allStages = withBaseStage(info, choice.stages, choice.maxPercent);
        // Как в 2.26: база первой, пороги по возрастанию.

        var styleByThreshold = {};
        for (var i = 0; i < allStages.length; i++) {
            var stage = allStages[i];
            var characterStyle = ensureCharacterStyle(doc, stage.pointSize, stage.leading);
            var expression = makeExpression(stage.threshold);
            paragraph.nestedGrepStyles.add({
                appliedCharacterStyle: characterStyle,
                grepExpression: expression
            });
            styleByThreshold[String(stage.threshold)] = String(characterStyle.name);
            log("applySetup: +" + expression + " → " + characterStyle.name +
                " @" + stage.pointSize + "/" + stage.leading);
        }

        var summary = [];
        for (var s = 0; s < allStages.length; s++) {
            var st = allStages[s];
            var prefix = st.isBase
                ? "до " + choice.untilCount
                : (s === allStages.length - 1 ? "после " : "от ") + st.threshold;
            summary.push(
                prefix + " · " + formatNumber(st.percent) + "% (" +
                formatNumber(st.pointSize) + " pt) → " +
                styleByThreshold[String(st.threshold)]
            );
        }

        var grepCount = 0;
        try {
            grepCount = paragraph.nestedGrepStyles.length;
        } catch (eG) {}

        var purged = purgeUnusedOwnedStyles(doc);

        // Контроль: текущая длина → ожидаемая ступень → фактический кегль.
        try {
            doc.recompose();
        } catch (eRecompose) {}
        var expected = stageForCount(allStages, info.charCount);
        var actual = NaN;
        try {
            var probe = expandTo(paragraph.characters.everyItem().pointSize, paragraph.characters.length);
            actual = Number(probe[0]);
        } catch (eProbe) {}
        var checkOk = expected && !isNaN(actual) &&
            Math.abs(actual - expected.pointSize) < 0.01;
        var check = "Проверка: " + info.charCount + " симв. → " +
            (expected ? formatNumber(expected.pointSize) : "?") + " pt, в макете " +
            (isNaN(actual) ? "?" : formatNumber(actual)) + " pt " +
            (checkOk ? "✓" : "✗");
        logObj("applySetup: done", {
            grep: grepCount,
            expectedGrep: allStages.length,
            purgedAFG: purged,
            check: check
        });

        redraw();

        var message =
            "GREP: " + grepCount + " / " + allStages.length + "\n\n" +
            summary.join("\n") + "\n\n" + check +
            (purged ? "\nУдалено лишних AFG: " + purged : "");
        if (!checkOk) {
            message += "\n\nКегль не совпал с ожидаемой ступенью: на тексте остался " +
                "оверрайд или чужой стиль символов. Снимите оверрайды на абзаце " +
                "и запустите снова.";
        }
        notify(message);
        return checkOk;
    }

    // --------------------------------------------------------------- main

    function main() {
        consumeAfgArgs();
        REPORT = [];
        log("======== main start " + SCRIPT_NAME + (SILENT ? " (silent)" : "") + " ========");

        if (app.documents.length === 0) {
            fail("Сначала откройте документ.");
            return;
        }
        var doc = app.activeDocument;
        if (!app.selection || app.selection.length !== 1) {
            fail("Выберите один текстовый фрейм или поставьте курсор в его текст.");
            return;
        }
        var textFrame = resolveTextFrame(app.selection[0]);
        if (!textFrame || !textFrame.isValid) {
            fail("Выбранный объект не является текстовым фреймом.");
            return;
        }
        var paragraph = findSingleParagraph(textFrame);
        if (!paragraph) {
            fail("Во фрейме должен быть ровно один непустой абзац.");
            return;
        }

        // Снять GREP, чтобы прочитать живой кегль. На отмене/ошибке — вернуть.
        var grepSnapshot = snapshotGrep(paragraph);
        clearLengthGrepFrom(paragraph);
        try {
            textFrame.insertLabel(SETTINGS_KEY, "");
        } catch (eLabel) {}

        function bail(message) {
            restoreGrep(paragraph, grepSnapshot);
            redraw();
            fail(message);
        }

        var info = getTextInfo(paragraph);
        if (!info) {
            bail("Во фрейме нет текста.");
            return;
        }
        if (info.invalidFormatting) {
            bail("Не удалось определить кегль текста.");
            return;
        }
        if (info.mixedPointSizes) {
            bail("У текста смешанный кегль. Сначала задайте единый кегль.");
            return;
        }
        if (info.mixedLeading) {
            bail("У текста смешанный интерлиньяж. Сначала задайте единый интерлиньяж.");
            return;
        }
        if (info.invalidParagraphStyle) {
            bail("Не удалось определить стиль абзаца.");
            return;
        }

        // Нет оверрайда кегля, но стоял наш GREP → база из его ^…{1,}.
        var grepBase = baseFromGrepSnapshot(grepSnapshot);
        if (grepBase && !info.sizeOverridden) {
            info.pointSize = grepBase.pointSize;
            if (!info.leadingOverridden && grepBase.leading !== null) {
                info.leading = grepBase.leading;
            } else if (info.leadingWasAuto) {
                info.leading = roundPt(info.pointSize * info.autoRatio);
            }
            log("main: base from existing GREP pt=" + info.pointSize +
                " lead=" + info.leading);
        }

        logObj("main: text", {
            chars: info.charCount,
            pt: info.pointSize,
            lead: info.leading,
            livePt: info.livePointSize,
            stylePt: info.styleSize,
            sizeOverridden: info.sizeOverridden,
            leadingOverridden: info.leadingOverridden,
            hadGrep: grepSnapshot.length,
            style: info.paragraphStyleName,
            text: info.contents.substr(0, 40)
        });

        var blocked = findBlockingCharacterStyle(paragraph);
        if (blocked) {
            bail(blockingStyleMessage(blocked));
            return;
        }

        // Пока открыт диалог, текст держим на базовом кегле (GREP сняты).
        var previewState = { active: false, lastPercent: null };
        if (grepSnapshot.length) {
            previewPercent(info, 100, previewState);
        }

        var choice;
        if (!SILENT) {
            choice = showDialog(info, previewState);
        } else if (AFG_ARGS.cancel) {
            choice = null;
        } else {
            choice = silentChoice(info);
        }
        if (!choice) {
            restoreOriginal(info, grepSnapshot, previewState);
            log("main: cancelled, original restored");
            publishReport();
            return;
        }

        logObj("main: choice", {
            until: choice.untilCount,
            last: choice.lastThreshold,
            steps: choice.stepCount,
            max: choice.maxPercent,
            min: choice.minPercent
        });
        applySetup(doc, info, choice);
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
