#targetengine "TerminalPreparatorUI"

(function () {

function getLiveDocument() {
    var d, i, n;
    try {
        d = app.activeDocument;
        if (d && d.isValid) return d;
    } catch (e0) {}
    try {
        n = app.layoutWindows.length;
        for (i = 0; i < n; i++) {
            try {
                d = app.layoutWindows[i].parent;
                if (d && d.isValid) return d;
            } catch (e1) {}
        }
    } catch (e2) {}
    try {
        n = app.documents.length;
        for (i = 0; i < n; i++) {
            try {
                d = app.documents[i];
                if (d && d.isValid) return d;
            } catch (e3) {}
        }
    } catch (e4) {}
    return null;
}

try { stopPrepDance(); } catch (eStop0) {}

var doc = getLiveDocument();
if (!doc) {
    alert("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u0437\u044f\u0442\u044c \u043c\u0430\u043a\u0435\u0442. \u0417\u0430\u043a\u0440\u043e\u0439 \u043e\u043a\u043d\u043e \u043e\u0448\u0438\u0431\u043a\u0438 \u0438 \u043e\u0442\u0447\u0451\u0442 Preparator, \u043a\u043b\u0438\u043a\u043d\u0438 \u043f\u043e \u043c\u0430\u043a\u0435\u0442\u0443.");
    return;
}

// FigmaToIndd: скрытые слои сверки, не для Терминала.
// Слои: "Figma Reference" / "Figma Reference Multiply".
// Файл: reference/figma_reference_overlay.jpg
function isFigmaReferenceOverlayLayerName(name) {
    var n = String(name || "");
    return n === "Figma Reference" || n.indexOf("Figma Reference ") === 0;
}

function isFigmaReferenceOverlayLinkName(name) {
    var n = String(name || "").toLowerCase();
    return n.indexOf("figma_reference_overlay") !== -1;
}

function isFigmaReferenceOverlayItem(item) {
    try {
        if (isFigmaReferenceOverlayLayerName(item.itemLayer.name)) return true;
    } catch (eLayer) {}
    try {
        if (isFigmaReferenceOverlayLayerName(item.name)) return true;
    } catch (eName) {}
    return false;
}

function isFigmaReferenceOverlayLink(link) {
    try {
        if (isFigmaReferenceOverlayLinkName(link.name)) return true;
    } catch (eName) {}
    try {
        var p = link.parent;
        if (p && isFigmaReferenceOverlayItem(p)) return true;
        if (p && p.parent && isFigmaReferenceOverlayItem(p.parent)) return true;
    } catch (eParent) {}
    return false;
}

// [pack.hero#link]: ферма подставит картинку из value set, PPI плейсхолдера не важен.
function nameLooksLikeLinkVariable(name) {
    var n = String(name || "");
    return n.length >= 7 && n.charAt(0) === "[" && n.slice(-6) === "#link]";
}

function itemIsLinkVariablePlaceholder(item) {
    var cur = item;
    for (var g = 0; g < 8; g++) {
        if (!cur) return false;
        try {
            if (nameLooksLikeLinkVariable(cur.name)) return true;
        } catch (eName) {}
        try {
            cur = cur.parent;
        } catch (eParent) {
            return false;
        }
    }
    return false;
}

// --- СНЯТИЕ ЗАМКОВ СО ВСЕХ ОБЪЕКТОВ И СЛОЕВ ---
// Оверлей Figma не трогаем: он специально hidden + locked.
for (var i = 0; i < doc.layers.length; i++) {
    if (isFigmaReferenceOverlayLayerName(doc.layers[i].name)) continue;
    doc.layers[i].locked = false;
}

// Снимаем замки со всех объектов на страницах
for (var i = 0; i < doc.pages.length; i++) {
    var pageItems = doc.pages[i].allPageItems;
    for (var j = 0; j < pageItems.length; j++) {
        try {
            if (isFigmaReferenceOverlayItem(pageItems[j])) continue;
            if (pageItems[j].locked) {
                pageItems[j].locked = false;
            }
        } catch(e) {}
    }
}

// Снимаем замки со всех объектов на мастер-страницах
for (var i = 0; i < doc.masterSpreads.length; i++) {
    var masterItems = doc.masterSpreads[i].allPageItems;
    for (var j = 0; j < masterItems.length; j++) {
        try {
            if (isFigmaReferenceOverlayItem(masterItems[j])) continue;
            if (masterItems[j].locked) {
                masterItems[j].locked = false;
            }
        } catch(e) {}
    }
}

// Проверка наличия блидов
var hasBleed = doc.documentPreferences.documentBleedTopOffset > 0 &&
               doc.documentPreferences.documentBleedBottomOffset > 0 &&
               doc.documentPreferences.documentBleedInsideOrLeftOffset > 0 &&
               doc.documentPreferences.documentBleedOutsideOrRightOffset > 0;

// Проверяем, является ли документ веб-документом
var isWebDocument = doc.documentPreferences.intent === DocumentIntentOptions.WEB_INTENT;
var SCREEN_REQUIRED_PPI = 72;

function isPixelMeasurementUnit(unit) {
    try {
        if (unit === MeasurementUnits.PIXELS) {
            return true;
        }
    } catch(e) {}

    try {
        return unit.toString().toLowerCase().indexOf("pixel") !== -1;
    } catch(e) {}

    return false;
}

function isPixelDocument(doc) {
    try {
        return isPixelMeasurementUnit(doc.viewPreferences.horizontalMeasurementUnits) ||
               isPixelMeasurementUnit(doc.viewPreferences.verticalMeasurementUnits);
    } catch(e) {}

    return false;
}

function collectDocNameHaystack(docRef) {
    var s = "";
    try { s += " " + docRef.name; } catch (eName) {}
    try {
        var f = new File(docRef.fullName);
        s += " " + f.name;
        if (f.parent) s += " " + f.parent.name;
    } catch (eFile) {}
    return s.toLowerCase();
}

function layoutSkipsBleedCheck(haystack) {
    var hay = String(haystack || "").toLowerCase();
    if (!hay) return false;
    if (hay.indexOf("price tag") !== -1) return true;
    if (hay.indexOf("pricetag") !== -1) return true;
    if (hay.indexOf("ценник") !== -1) return true;
    if (hay.indexOf("sticker") !== -1) return true;
    if (hay.indexOf("наклейк") !== -1) return true;
    if (hay.indexOf("digital") !== -1) return true;
    if (hay.indexOf("internet advertising") !== -1) return true;
    if (hay.indexOf("tv board") !== -1) return true;
    if (hay.indexOf("video for") !== -1) return true;
    if (hay.indexOf("social media") !== -1) return true;
    if (hay.indexOf("kiosk") !== -1) return true;
    if (hay.indexOf("banner web") !== -1) return true;
    if (hay.indexOf("google display") !== -1) return true;
    if (hay.indexOf("facebook") !== -1) return true;
    if (hay.indexOf("in-app") !== -1) return true;
    if (hay.indexOf(" px") !== -1) return true;
    return false;
}

var isWebPixelDocument = isWebDocument && isPixelDocument(doc);
var bleedWarning = !hasBleed && !isWebDocument && !isPixelDocument(doc) &&
    !layoutSkipsBleedCheck(collectDocNameHaystack(doc));

// Функция для определения минимального PPI по площади в мм²
// A4 = 210×297 = 62370 → 300; билборд 4×3 м (1:10) = 400×300 = 120000 → 256
function getMinPPI(area) {
    if (area <= 62370) return 300;
    if (area <= 124740) return 256;
    if (area <= 249480) return 182;
    if (area <= 499554) return 129;
    if (area <= 999949) return 92;
    return 65; // для площадей больше 999949
}

function measurementToMm(value, unit) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    try {
        if (unit === MeasurementUnits.MILLIMETERS) return n;
        if (unit === MeasurementUnits.CENTIMETERS) return n * 10;
        if (unit === MeasurementUnits.INCHES) return n * 25.4;
        if (unit === MeasurementUnits.POINTS) return n * 25.4 / 72;
        if (unit === MeasurementUnits.PICAS) return n * 25.4 / 6;
        if (unit === MeasurementUnits.PIXELS) return n * 25.4 / 72;
    } catch (e) {}
    return n;
}

// Функция проверки, скрыт ли какой-либо родитель (слой, группа и т.д.)
function isAnyParentHidden(obj) {
    try {
        var parent = obj;
        while (parent) {
            if (parent.hasOwnProperty('visible') && parent.visible === false) {
                return true;
            }
            if (parent.reflect && parent.reflect.name === "Document") break;
            if (parent.hasOwnProperty('parent')) {
                parent = parent.parent;
            } else {
                break;
            }
        }
    } catch (e) {}
    return false;
}

// Очищаем все настройки поиска перед началом работы
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;

// Включаем все опции поиска
app.findChangeTextOptions.includeFootnotes = true;
app.findChangeTextOptions.includeMasterPages = true;
app.findChangeTextOptions.includeHiddenLayers = true;
app.findChangeTextOptions.caseSensitive = false;

// Включаем опции поиска для GREP
app.findChangeGrepOptions.includeFootnotes = true;
app.findChangeGrepOptions.includeMasterPages = true;
app.findChangeGrepOptions.includeHiddenLayers = true;

// Проверка autoSizing для текстовых фреймов с переменными
var framesWithoutAutosize = [];
var hasLegalWithoutAutosize = false;
var legalFramesWithWidthAutoSize = [];
var possibleLegalNoAutoSize = [];
var possibleLegalWidthAutoSize = [];
var legalFramesWithoutHyphenation = [];
var legalFramesWithoutRussianLanguage = [];
var legalFramesCheckedCount = 0;
var checkedLegalTypographyFrames = {};
var hasLegalWithoutParagraphSetup = false;
var checkedLegalSetupFrames = {};

function addUniqueLimited(list, seen, value, limit) {
    if (!value || seen[value]) {
        return;
    }
    seen[value] = true;
    if (list.length < limit) {
        list.push(value);
    }
}

function getTextFrameKey(textFrame) {
    try {
        if (textFrame.id) {
            return "id:" + textFrame.id;
        }
    } catch(e) {}

    try {
        return "contents:" + textFrame.contents;
    } catch(e) {}

    return "unknown";
}

function getLegalFrameSnippet(textFrame) {
    try {
        var text = textFrame.contents.replace(/\s+/g, " ");
        if (text.length > 70) {
            text = text.substring(0, 70) + "...";
        }
        return text;
    } catch(e) {}

    return "[не удалось прочитать текст лигала]";
}

function getShortSnippet(text) {
    try {
        text = text.replace(/\s+/g, " ");
        if (text.length > 90) {
            text = text.substring(0, 90) + "...";
        }
        return text;
    } catch(e) {}

    return "[не удалось прочитать фрагмент]";
}

function getLanguageName(languageValue) {
    try {
        if (languageValue && languageValue.name) {
            return languageValue.name;
        }
        if (languageValue) {
            return languageValue.toString();
        }
    } catch(e) {}

    return "[не удалось определить язык]";
}

function isRussianLanguageValue(languageValue) {
    try {
        var languageName = getLanguageName(languageValue).toLowerCase();
        return languageName.indexOf("russian") !== -1 || languageName.indexOf("рус") !== -1;
    } catch(e) {}

    return false;
}

function collectLegalHyphenationProblems(textFrame, frameSnippet) {
    var problems = [];

    try {
        var paragraphs = textFrame.paragraphs.everyItem().getElements();
        for (var p = 0; p < paragraphs.length; p++) {
            if (paragraphs[p].contents && paragraphs[p].contents.replace(/\s+/g, "").length > 0) {
                if (paragraphs[p].hyphenation !== true) {
                    problems.push({
                        frame: frameSnippet,
                        fragment: getShortSnippet(paragraphs[p].contents)
                    });
                }
            }
        }
    } catch(e) {}

    return problems;
}

function collectLegalLanguageProblems(textFrame, frameSnippet) {
    var problems = [];

    try {
        var contents = textFrame.contents;
        var bracketRanges = getBracketRanges(contents);
        var textStyleRanges = textFrame.texts[0].textStyleRanges.everyItem().getElements();
        var runningIndex = 0;
        for (var r = 0; r < textStyleRanges.length; r++) {
            var range = textStyleRanges[r];
            if (range.contents && range.contents.replace(/\s+/g, "").length > 0) {
                var start = runningIndex;
                var end = start + range.contents.length - 1;
                if (!overlapsBracketRange(start, end, bracketRanges) && !isRussianLanguageValue(range.appliedLanguage)) {
                    problems.push({
                        frame: frameSnippet,
                        fragment: getShortSnippet(range.contents),
                        language: getLanguageName(range.appliedLanguage)
                    });
                }
            }
            try {
                runningIndex += range.contents.length;
            } catch(e) {}
        }
    } catch(e) {}

    return problems;
}

function legalParagraphSetupGrepLooksApplied(expr) {
    var e = String(expr || "");
    return e.indexOf("для|или|при") !== -1 ||
        e.indexOf("\\*[A-Za-z0-9.]+\\*") !== -1 ||
        e.indexOf("огрн") !== -1 ||
        e.indexOf("[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)+") !== -1;
}

function paragraphLooksLikeLegalParagraphSetup(paragraph) {
    try {
        var greps = paragraph.nestedGrepStyles;
        var g;
        for (g = 0; g < greps.length; g++) {
            if (legalParagraphSetupGrepLooksApplied(greps[g].grepExpression)) {
                return true;
            }
        }
    } catch (eGrep) {}
    return false;
}

function legalFrameHasParagraphSetup(textFrame) {
    try {
        var paragraphs = textFrame.paragraphs.everyItem().getElements();
        var visible = 0;
        var withLps = 0;
        var p;
        var contents;
        for (p = 0; p < paragraphs.length; p++) {
            contents = String(paragraphs[p].contents || "").replace(/\s+/g, "");
            if (!contents.length) continue;
            visible++;
            if (paragraphLooksLikeLegalParagraphSetup(paragraphs[p])) withLps++;
        }
        return visible > 0 && withLps === visible;
    } catch (eFrame) {}
    return false;
}

function checkLegalParagraphSetup(textFrame) {
    var key = getTextFrameKey(textFrame);
    if (checkedLegalSetupFrames[key]) {
        return;
    }
    checkedLegalSetupFrames[key] = true;
    if (!legalFrameHasParagraphSetup(textFrame)) {
        hasLegalWithoutParagraphSetup = true;
    }
}

function checkLegalTypography(textFrame) {
    var key = getTextFrameKey(textFrame);
    if (checkedLegalTypographyFrames[key]) {
        return;
    }
    checkedLegalTypographyFrames[key] = true;
    legalFramesCheckedCount++;

    var snippet = getLegalFrameSnippet(textFrame);
    var hyphenationProblems = collectLegalHyphenationProblems(textFrame, snippet);
    for (var h = 0; h < hyphenationProblems.length; h++) {
        legalFramesWithoutHyphenation.push(hyphenationProblems[h]);
    }

    var languageProblems = collectLegalLanguageProblems(textFrame, snippet);
    for (var l = 0; l < languageProblems.length; l++) {
        legalFramesWithoutRussianLanguage.push(languageProblems[l]);
    }
}

function frameLooksLikeLegal(frameText) {
    var t = String(frameText || "");
    return /\[company\.(name|statenumberlong|statenumber|legaladdress)\]/i.test(t) ||
        /<COMPANY_(NAME|STATE_NUMBER|LEGAL_ADDRESS)>/i.test(t);
}

// Не любой длинный фрейм с [переменной], а текст, похожий на юр. блок без company.*.
function frameLooksLikePossibleLegal(frameText) {
    var t = String(frameText || "");
    if (!t || frameLooksLikeLegal(t)) return false;
    var low = t.toLowerCase();
    if (/огрнип|огрн|erid|оферт|рекламодател|не является|юридическ|реклама\./.test(low)) return true;
    if (/ооо\s*[«"']/.test(low)) return true;
    return /(^|[^а-яё])инн([^а-яё]|$)/.test(low);
}

function addUniqueNames(target, names) {
    var seen = {};
    var i, n;
    for (i = 0; i < target.length; i++) {
        seen[String(target[i])] = true;
    }
    for (i = 0; i < names.length; i++) {
        n = names[i];
        if (n && !seen[String(n)]) {
            seen[String(n)] = true;
            target.push(n);
        }
    }
}

function getBracketRanges(text) {
    var ranges = [];
    var start = -1;

    for (var i = 0; i < text.length; i++) {
        if (text.charAt(i) === "[") {
            start = i;
        } else if (text.charAt(i) === "]" && start !== -1) {
            ranges.push({ start: start, end: i });
            start = -1;
        }
    }

    return ranges;
}

function overlapsBracketRange(start, end, ranges) {
    for (var i = 0; i < ranges.length; i++) {
        if (start <= ranges[i].end && end >= ranges[i].start) {
            return true;
        }
    }

    return false;
}

// Figma/копирайты часто ставят <COMPANY_NAME> — ферма это не подставляет, только [company.name].
var angleCompanyReplaceCount = 0;
var leftoverAnglePlaceholders = [];
(function replaceAngleCompanyPlaceholders() {
    var map = [
        { find: "(?i)<COMPANY_NAME>", to: "[company.name]" },
        { find: "(?i)<COMPANY_STATE_NUMBER>", to: "[company.stateNumber]" },
        { find: "(?i)<COMPANY_LEGAL_ADDRESS>", to: "[company.legalAddress]" }
    ];
    var m;
    for (m = 0; m < map.length; m++) {
        app.findGrepPreferences = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
        app.findGrepPreferences.findWhat = map[m].find;
        app.changeGrepPreferences.changeTo = map[m].to;
        var changed = doc.changeGrep();
        angleCompanyReplaceCount += changed.length;
    }
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = "<[A-Z][A-Z0-9_]{3,}>";
    var leftovers = doc.findGrep();
    var seen = {};
    var L;
    for (L = 0; L < leftovers.length; L++) {
        var tok = leftovers[L].contents;
        if (!seen[tok]) {
            seen[tok] = true;
            leftoverAnglePlaceholders.push(tok);
        }
    }
    app.findGrepPreferences = NothingEnum.nothing;
})();

app.findGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\[.*?\\]";

var found = doc.findGrep();
for (var i = 0; i < found.length; i++) {
    var textFrame = found[i].parentTextFrames[0];
    if (textFrame) {
        var variableName = found[i].contents;
        var frameText = textFrame.contents;
        var isLegalFrame = frameLooksLikeLegal(frameText);
        var isHidden = isAnyParentHidden(textFrame);

        if (isLegalFrame) {
            if (!isHidden) {
                checkLegalTypography(textFrame);
                checkLegalParagraphSetup(textFrame);

                if (textFrame.textFramePreferences.autoSizingType === AutoSizingTypeEnum.OFF) {
                    hasLegalWithoutAutosize = true;
                }
                if (textFrame.textFramePreferences.autoSizingType === AutoSizingTypeEnum.WIDTH_ONLY) {
                    legalFramesWithWidthAutoSize.push(variableName);
                }
            }
        } else {
            if (!isHidden) {
                if (textFrame.textFramePreferences.autoSizingType === AutoSizingTypeEnum.OFF) {
                    framesWithoutAutosize.push(variableName);
                }
                if (frameLooksLikePossibleLegal(frameText)) {
                    if (textFrame.textFramePreferences.autoSizingType === AutoSizingTypeEnum.OFF) {
                        possibleLegalNoAutoSize.push(frameText);
                    }
                    if (textFrame.textFramePreferences.autoSizingType === AutoSizingTypeEnum.WIDTH_ONLY) {
                        possibleLegalWidthAutoSize.push(frameText);
                    }
                }
            }
        }
    }
}

// 2. Нормализация сайтов и замена сайта Додо на системную переменную
var websiteReplaced = false;
var websiteSpacingFixed = 0;
var websiteSpacingFixes = [];
var websiteSpacingFixesSeen = {};

function changeGrepAndCount(findWhat, changeTo) {
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = findWhat;
    app.changeGrepPreferences.changeTo = changeTo;

    var changedItems = doc.changeGrep();
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    return changedItems.length;
}

function normalizeWebsiteMatch(text) {
    try {
        return text.replace(/\s*\.\s*/g, ".");
    } catch(e) {}

    return text;
}

function changeWebsiteSpacingAndRemember(findWhat, changeTo) {
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = findWhat;

    var foundItems = doc.findGrep();
    var actualFixes = 0;
    for (var i = 0; i < foundItems.length; i++) {
        var before = foundItems[i].contents;
        var after = normalizeWebsiteMatch(before);
        if (before !== after) {
            actualFixes++;
            addUniqueLimited(websiteSpacingFixes, websiteSpacingFixesSeen, before + " → " + after, 20);
        }
    }

    app.changeGrepPreferences.changeTo = changeTo;
    doc.changeGrep();
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    return actualFixes;
}

// Сначала приводим домены к виду без пробелов вокруг точек: www. com -> www.com, dodo .ru -> dodo.ru.
websiteSpacingFixed += changeWebsiteSpacingAndRemember("(?i)www\\s*\\.\\s*\\.", "www.");
websiteSpacingFixed += changeWebsiteSpacingAndRemember("(?i)www\\s*\\.\\s*", "www.");
websiteSpacingFixed += changeWebsiteSpacingAndRemember("(?i)([A-Za-z0-9-])\\s*\\.\\s*(ru|com|kz|by|uz|рф)", "$1.$2");

// Потом заменяем сайт Додо целиком, включая вариант с www и пробелами вокруг точки.
var dodoWebsiteReplacements = changeGrepAndCount("(?i)(www\\s*\\.\\s*)?dodopizza\\s*\\.\\s*ru", "[country.mainWebsite]");
websiteReplaced = dodoWebsiteReplacements > 0;

// 2.5 Замена неправильных кавычек
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;

// Находим все текстовые фреймы
var allTextFrames = [];
for (var i = 0; i < doc.pages.length; i++) {
    for (var j = 0; j < doc.pages[i].textFrames.length; j++) {
        allTextFrames.push(doc.pages[i].textFrames[j]);
    }
}

// Проверяем мастер-страницы
for (var i = 0; i < doc.masterSpreads.length; i++) {
    for (var j = 0; j < doc.masterSpreads[i].pages.length; j++) {
        for (var k = 0; k < doc.masterSpreads[i].pages[j].textFrames.length; k++) {
            allTextFrames.push(doc.masterSpreads[i].pages[j].textFrames[k]);
        }
    }
}

var quotesFixed = 0;
var innerQuotesFixed = 0;

// Функция для исправления кавычек в тексте
function fixQuotes(text) {
    var result = text;
    var quoteCount = 0;
    var quotePositions = [];
    
    // Находим все позиции кавычек
    for (var i = 0; i < result.length; i++) {
        if (result[i] === "«" || result[i] === "»") {
            quoteCount++;
            quotePositions.push(i);
        }
    }
    
    // Если кавычек нет, возвращаем текст как есть
    if (quoteCount === 0) return result;
    
    // Если кавычек нечетное количество, добавляем закрывающую в конец
    if (quoteCount % 2 !== 0) {
        result += "»";
        quoteCount++;
    }
    
    // Исправляем кавычки по порядку
    for (var i = 0; i < quotePositions.length; i++) {
        var pos = quotePositions[i];
        // Четные позиции (0, 2, 4...) - открывающие кавычки
        // Нечетные позиции (1, 3, 5...) - закрывающие кавычки
        if (i % 2 === 0) {
            result = result.substring(0, pos) + "«" + result.substring(pos + 1);
        } else {
            result = result.substring(0, pos) + "»" + result.substring(pos + 1);
        }
    }
    
    return result;
}

// Исправляем кавычки во всех текстовых фреймах
for (var i = 0; i < allTextFrames.length; i++) {
    var textFrame = allTextFrames[i];
    var originalText = textFrame.contents;
    var fixedText = fixQuotes(originalText);
    
    if (originalText !== fixedText) {
        textFrame.contents = fixedText;
        quotesFixed++;
    }
}

// 3. Исправление точек
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

// Сначала убираем пробелы перед точкой
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\s+\\.";
app.changeGrepPreferences.changeTo = ".";
doc.changeGrep();

// Затем оставляем только один пробел после точки
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\.\\s+";
app.changeGrepPreferences.changeTo = ". ";
doc.changeGrep();

// Сначала убираем лишние точки
app.findTextPreferences.findWhat = "..";
app.changeTextPreferences.changeTo = ".";
doc.changeText();

// Добавляем пробелы после точек
var dotsFixed = 0;
var dotFixDetails = [];
var dotFixDetailsByKey = {};

function rememberDotFix(findText, replaceText, count) {
    if (count <= 0) {
        return;
    }

    var key = findText + " → " + replaceText;
    if (!dotFixDetailsByKey[key]) {
        dotFixDetailsByKey[key] = {
            before: findText,
            after: replaceText,
            count: 0
        };
        dotFixDetails.push(dotFixDetailsByKey[key]);
    }
    dotFixDetailsByKey[key].count += count;
}

// Список текстов для поиска и замены
var replacements = [
    { find: ".А", replace: ". А" },
    { find: ".Б", replace: ". Б" },
    { find: ".В", replace: ". В" },
    { find: ".Г", replace: ". Г" },
    { find: ".Д", replace: ". Д" },
    { find: ".Е", replace: ". Е" },
    { find: ".Ё", replace: ". Ё" },
    { find: ".Ж", replace: ". Ж" },
    { find: ".З", replace: ". З" },
    { find: ".И", replace: ". И" },
    { find: ".Й", replace: ". Й" },
    { find: ".К", replace: ". К" },
    { find: ".Л", replace: ". Л" },
    { find: ".М", replace: ". М" },
    { find: ".Н", replace: ". Н" },
    { find: ".О", replace: ". О" },
    { find: ".П", replace: ". П" },
    { find: ".Р", replace: ". Р" },
    { find: ".С", replace: ". С" },
    { find: ".Т", replace: ". Т" },
    { find: ".У", replace: ". У" },
    { find: ".Ф", replace: ". Ф" },
    { find: ".Х", replace: ". Х" },
    { find: ".Ц", replace: ". Ц" },
    { find: ".Ч", replace: ". Ч" },
    { find: ".Ш", replace: ". Ш" },
    { find: ".Щ", replace: ". Щ" },
    { find: ".Ъ", replace: ". Ъ" },
    { find: ".Ы", replace: ". Ы" },
    { find: ".Ь", replace: ". Ь" },
    { find: ".Э", replace: ". Э" },
    { find: ".Ю", replace: ". Ю" },
    { find: ".Я", replace: ". Я" },
    { find: ".[", replace: ". [" },
    { find: ".—", replace: ". —" }
];

// Применяем все замены
for (var i = 0; i < replacements.length; i++) {
    app.findTextPreferences.findWhat = replacements[i].find;
    app.changeTextPreferences.changeTo = replacements[i].replace;
    var found = doc.changeText();
    dotsFixed += found.length;
    rememberDotFix(replacements[i].find, replacements[i].replace, found.length);
}

// 3.1 Исправление запятых
// Важно: десятичная запятая в числах (0,5 / 0,45 л) — НЕ пробел после запятой.
// Старое правило ",(\\S)" → ", $1" ломало объёмы: 0,5 → "0, 5".
var commasFixed = 0;

// Сначала чиним уже сломанные десятичные: "0, 5" / "0,  45" → "0,5" / "0,45"
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "(\\d),\\s+(\\d)";
app.changeGrepPreferences.changeTo = "$1,$2";
var foundDecimalCommas = doc.changeGrep();
commasFixed += foundDecimalCommas.length;

// Убираем пробелы перед запятой
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\s+,";
app.changeGrepPreferences.changeTo = ",";
var foundCommasBefore = doc.changeGrep();
commasFixed += foundCommasBefore.length;

// Один пробел после запятой, но не перед цифрой (не трогаем 0,5)
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = ",(?!\\d)\\s+";
app.changeGrepPreferences.changeTo = ", ";
var foundCommasAfter = doc.changeGrep();
commasFixed += foundCommasAfter.length;

// Пробел после запятой, если его нет — только когда дальше не цифра (не 0,5)
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = ",(?!\\d)(\\S)";
app.changeGrepPreferences.changeTo = ", $1";
var foundCommasNoSpace = doc.changeGrep();
commasFixed += foundCommasNoSpace.length;

// 3.5 Проверка проблемных шрифтов
var problematicFonts = {
    "Rooftop-ExtendedBold": false,
    "Condensed Bold": false
};
var problematicFontsFound = false;

// Функция проверки шрифтов на странице
function checkFontsOnPage(page) {
    for (var i = 0; i < page.textFrames.length; i++) {
        var textFrame = page.textFrames[i];
        if (textFrame.contents.length > 0) {
            try {
                var appliedFont = textFrame.paragraphs[0].appliedFont.name;
                if (appliedFont in problematicFonts) {
                    problematicFonts[appliedFont] = true;
                    problematicFontsFound = true;
                }
            } catch(e) {}
        }
    }
}

// Проверяем шрифты на всех страницах
for (var i = 0; i < doc.pages.length; i++) {
    checkFontsOnPage(doc.pages[i]);
}

// Проверяем шрифты на мастер-страницах
for (var i = 0; i < doc.masterSpreads.length; i++) {
    for (var j = 0; j < doc.masterSpreads[i].pages.length; j++) {
        checkFontsOnPage(doc.masterSpreads[i].pages[j]);
    }
}

// --- ПРОВЕРКА ОТСУТСТВУЮЩИХ ШРИФТОВ С ПРИМЕРАМИ ТЕКСТА ---
var missingFontsData = {}; // { "Font Name": ["snippet1", "snippet2"] }
var missingFontsFound = false;
try {
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    for (var i = 0; i < doc.fonts.length; i++) {
        var font = doc.fonts[i];
        if (font.status === FontStatus.NOT_AVAILABLE) {
            
            // --- НОВАЯ ПРОВЕРКА НА ЛОЖНОЕ СРАБАТЫВАНИЕ (например, из-за "(OTF)") ---
            var fontName = font.name;
            var nameParts = fontName.split('\t');
            var familyName = nameParts[0];
            var styleName = nameParts.length > 1 ? nameParts[1] : "";
            
            // Удаляем обозначения типа "(OTF)", "(TT)" и т.д. из имени семейства
            var cleanedFamilyName = familyName.replace(/\s*\((OTF|TT|TrueType|PostScript|Type 1)\)\s*/i, '').replace(/\s+$/, '');

            var isLikelySubstitution = false;
            if (cleanedFamilyName !== familyName) {
                // Ищем шрифт с "очищенным" именем
                var potentialSubstituteName = cleanedFamilyName + (styleName ? '\t' + styleName : '');
                try {
                    var substituteFont = app.fonts.itemByName(potentialSubstituteName);
                    // Если "очищенный" шрифт найден и установлен, считаем это ложным срабатыванием
                    if (substituteFont.isValid && substituteFont.status === FontStatus.INSTALLED) {
                        isLikelySubstitution = true;
                    }
                } catch(e) {}
            }
            
            // Если это ложное срабатывание, пропускаем этот шрифт и не сообщаем об ошибке
            if (isLikelySubstitution) {
                continue; 
            }
            // --- КОНЕЦ НОВОЙ ПРОВЕРКИ ---

            if (!missingFontsData[fontName]) {
                missingFontsData[fontName] = [];
            }
            
            app.findGrepPreferences.appliedFont = font;
            var foundItems = doc.findGrep();
            
            var uniqueSnippets = {};
            for (var j = 0; j < foundItems.length; j++) {
                if (missingFontsData[fontName].length >= 3) break;
                
                var found = foundItems[j];
                var isHidden = false;
                try {
                    var textFrame = found.parentTextFrames[0];
                    isHidden = isAnyParentHidden(textFrame);
                } catch(e) {}

                if (!isHidden) {
                    var snippet = "";
                    try {
                        snippet = found.paragraphs[0].contents.replace(/\s+/g, ' ').substring(0, 70);
                    } catch(e) {
                        snippet = found.contents.replace(/\s+/g, ' ').substring(0, 70);
                    }
                    if (snippet && !uniqueSnippets[snippet]) {
                        missingFontsData[fontName].push('"' + snippet.replace(/"/g, "'") + '..."');
                        uniqueSnippets[snippet] = true;
                    }
                }
            }
            app.findGrepPreferences = NothingEnum.nothing; // Сбрасываем
        }
    }

    // Проверяем, есть ли хотя бы один шрифт с ошибками на видимых слоях
    for (var fontName in missingFontsData) {
        if (missingFontsData.hasOwnProperty(fontName) && missingFontsData[fontName].length > 0) {
            missingFontsFound = true;
            break;
        }
    }
} catch (e) {
    // Игнорируем ошибки
} finally {
    app.findGrepPreferences = NothingEnum.nothing;
}


// 4. Проверка эффективного PPI изображений
var ppiReport = "";
var hasPPIWarning = false;
var hasFileSizeWarning = false;

// Определяем необходимый PPI для макета по площади в мм² (не в единицах линейки)
var pageWidthMm = Math.round(measurementToMm(doc.documentPreferences.pageWidth, doc.viewPreferences.horizontalMeasurementUnits) * 10) / 10;
var pageHeightMm = Math.round(measurementToMm(doc.documentPreferences.pageHeight, doc.viewPreferences.verticalMeasurementUnits) * 10) / 10;
var docArea = Math.round(pageWidthMm * pageHeightMm);
var requiredPPI = isWebPixelDocument ? SCREEN_REQUIRED_PPI : getMinPPI(docArea);

function formatFileSizeMb(mb) {
    var n = Math.round(Number(mb) * 10) / 10;
    return String(n).replace(".", ",") + " MB";
}

function formatImagePpiWarning(ppi, required, mb) {
    return "⚠ PPI " + ppi + " (" + required + "), " + formatFileSizeMb(mb);
}

// Функция проверки изображений на странице
function checkImagesOnPage(page, pageName) {
    // Перебираем все объекты на странице
    for (var j = 0; j < page.allPageItems.length; j++) {
        var item = page.allPageItems[j];
        
        try {
            if (isFigmaReferenceOverlayItem(item)) continue;
            if (itemIsLinkVariablePlaceholder(item)) continue;
            // Проверяем есть ли у объекта ссылка
            if (item.itemLink) {
                var link = item.itemLink;
                var fileSize = link.size / 1048576; // Переводим в МБ
                var firstPPI = 0;
                var hasPpiValue = false;
                var ppiBad = false;

                if (item.effectivePpi) {
                    firstPPI = Math.round(item.effectivePpi[0]);
                    hasPpiValue = true;

                    var tolerance = requiredPPI * 0.15;
                    var upperLimit = requiredPPI + tolerance;
                    var lowerLimit = requiredPPI - tolerance;

                    if (!isWebPixelDocument && firstPPI > upperLimit) {
                        if (fileSize > 15) {
                            hasPPIWarning = true;
                            ppiBad = true;
                        }
                    } else if (firstPPI < lowerLimit) {
                        hasPPIWarning = true;
                        ppiBad = true;
                    }
                }

                var sizeBad = fileSize > 18;
                if (sizeBad) hasFileSizeWarning = true;

                if (ppiBad || sizeBad) {
                    ppiReport += link.name + "\n";
                    if (hasPpiValue) {
                        ppiReport += formatImagePpiWarning(firstPPI, requiredPPI, fileSize) + "\n";
                    } else {
                        ppiReport += "⚠ " + formatFileSizeMb(fileSize) + "\n";
                    }
                }
            }
        } catch(e) {}
    }
}

// Проверяем мастер-страницы
for (var i = 0; i < doc.masterSpreads.length; i++) {
    var masterSpread = doc.masterSpreads[i];
    for (var p = 0; p < masterSpread.pages.length; p++) {
        checkImagesOnPage(masterSpread.pages[p], "мастер-странице " + masterSpread.name);
    }
}

// Проверяем обычные страницы
for (var i = 0; i < doc.pages.length; i++) {
    checkImagesOnPage(doc.pages[i], "странице " + (i + 1));
}

// 5. Замены для Беларуси
var stateNumberCount = 0;
var ogrnCount = 0;
var addressCount = 0;
var ogrnStateNumberCount = 0;
var ogrnStateNumberLongCount = 0;

// Замена "ОГРН [company.stateNumberLong]" на "[company.stateNumberLong]"
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findTextPreferences.findWhat = "ОГРН [company.stateNumberLong]";
app.changeTextPreferences.changeTo = "[company.stateNumberLong]";
ogrnStateNumberLongCount = doc.changeText().length;

// Замена "ОГРН [company.stateNumber]" на "[company.stateNumberLong]"
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findTextPreferences.findWhat = "ОГРН [company.stateNumber]";
app.changeTextPreferences.changeTo = "[company.stateNumberLong]";
ogrnStateNumberCount = doc.changeText().length;

// Замена [company.stateNumber] на [company.stateNumberLong]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findTextPreferences.findWhat = "[company.stateNumber]";
app.changeTextPreferences.changeTo = "[company.stateNumberLong]";
stateNumberCount = doc.changeText().length;

// Замена [company.ogrn] на [company.stateNumber]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findTextPreferences.findWhat = "[company.ogrn]";
app.changeTextPreferences.changeTo = "[company.stateNumber]";
ogrnCount = doc.changeText().length;

// Замена [company.legalAdress] на [company.legalAddress]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findTextPreferences.findWhat = "[company.legalAdress]";
app.changeTextPreferences.changeTo = "[company.legalAddress]";
addressCount = doc.changeText().length;

// Проверка и включение overprint stroke в слое cutline
var hasOverprintFixed = false;
var cutlineLayerFound = false;
var cutlineLayerHasObjects = false;
var cutlineLayer = null;

// Поиск слоя cutline без учёта регистра
for (var li = 0; li < doc.layers.length; li++) {
    if (doc.layers[li].name.toLowerCase() === "cutline") {
        cutlineLayer = doc.layers[li];
        break;
    }
}

try {
    if (cutlineLayer && cutlineLayer.isValid) {
        cutlineLayerFound = true;
        if (cutlineLayer.pageItems.length > 0) {
            cutlineLayerHasObjects = true;
            for (var i = 0; i < cutlineLayer.pageItems.length; i++) {
                var item = cutlineLayer.pageItems[i];
                // Если это compound path, включаем overprint для каждого path внутри
                if (item.constructor.name === "CompoundPathItem") {
                    for (var j = 0; j < item.pathItems.length; j++) {
                        if (!item.pathItems[j].overprintStroke) {
                            item.pathItems[j].overprintStroke = true;
                            hasOverprintFixed = true;
                        }
                    }
                } else {
                    if (!item.overprintStroke) {
                        item.overprintStroke = true;
                        hasOverprintFixed = true;
                    }
                }
            }
        }
    }
} catch(e) {
    // Игнорируем ошибки - слой может отсутствовать
}

// Проверка переменных в квадратных скобках на запрещённые символы и некорректный префикс
var invalidVarSymbols = /[ \-–_,&]/; // пробел, дефис, тире, нижнее подчеркивание, запятая, амперсанд
var invalidVariables = [];
var invalidTypeOrDotVariables = [];
var multipleDotsVariables = [];
var misspelledSystemVariables = [];
var unknownSystemVariables = [];
var disallowedCompanyVariables = [];
var disallowedBranchVariables = [];
var disallowedCountryVariables = [];
var variablesOnHiddenLayers = [];
var websiteVariablesFound = [];
var allowedPrefixes = ["country.", "company.", "branch.", "pack.", "layout.", "terminal."];
var systemPrefixes = ["country.", "company.", "branch."];

// Список переменных, которые должны быть в квадратных скобках
var requiredBracketsVariables = [
    "country.currencySign",
    "country.mainWebsite",
    "country.phone",
    "country.hrWebsite",
    "country.hrPhone",
    "company.name",
    "company.legalAddress",
    "company.stateNumber",
    "company.stateNumberLong",
    "branch.addressShort",
    "branch.addressDetailsCity",
    "branch.addressDetailsStreetTypeDecrease",
    "branch.addressDetailsStreetTypeName",
    "branch.addressDetailsStreetName",
    "branch.addressDetailsHouseNumber",
    "branch.publicWiFiPassword",
    "branch.publicWiFiName",
    "branch.vk",
    "branch.instagram",
    "branch.workingTime"
];

var allSystemVariables = {};
for (var i = 0; i < requiredBracketsVariables.length; i++) {
    allSystemVariables[requiredBracketsVariables[i]] = true;
}

// Известные опечатки системных переменных → подсказки для автозамены
var typoMap = {
    "company.legaladress": "company.legalAddress",
    "company.legaladrres": "company.legalAddress",
    "company.legaladdres": "company.legalAddress",
    "company.legaladres": "company.legalAddress"
};

// Строгий список допустимых company.* переменных
var allowedCompanyVariables = {
    "company.name": true,
    "company.legalAddress": true,
    "company.stateNumber": true,
    "company.stateNumberLong": true
};
// Кейс-инвариантное сопоставление к каноническим вариантам
var allowedCompanyByLower = {
    "company.name": "company.name",
    "company.legaladdress": "company.legalAddress",
    "company.statenumber": "company.stateNumber",
    "company.statenumberlong": "company.stateNumberLong"
};

// Строгий список допустимых branch.* переменных
var allowedBranchVariables = {
    "branch.addressShort": true,
    "branch.addressDetailsCity": true,
    "branch.addressDetailsStreetTypeDecrease": true,
    "branch.addressDetailsStreetTypeName": true,
    "branch.addressDetailsStreetName": true,
    "branch.addressDetailsHouseNumber": true,
    "branch.publicWiFiPassword": true,
    "branch.publicWiFiName": true,
    "branch.vk": true,
    "branch.instagram": true,
    "branch.workingTime": true
};
var allowedBranchByLower = {
    "branch.addressshort": "branch.addressShort",
    "branch.addressdetailscity": "branch.addressDetailsCity",
    "branch.addressdetailsstreettypedecrease": "branch.addressDetailsStreetTypeDecrease",
    "branch.addressdetailsstreettypename": "branch.addressDetailsStreetTypeName",
    "branch.addressdetailsstreetname": "branch.addressDetailsStreetName",
    "branch.addressdetailshousenumber": "branch.addressDetailsHouseNumber",
    "branch.publicwifipassword": "branch.publicWiFiPassword",
    "branch.publicwifiname": "branch.publicWiFiName",
    "branch.vk": "branch.vk",
    "branch.instagram": "branch.instagram",
    "branch.workingtime": "branch.workingTime"
};

// Строгий список допустимых country.* переменных
var allowedCountryVariables = {
    "country.currencySign": true,
    "country.mainWebsite": true,
    "country.phone": true,
    "country.hrWebsite": true,
    "country.hrPhone": true
};
var allowedCountryByLower = {
    "country.currencysign": "country.currencySign",
    "country.mainwebsite": "country.mainWebsite",
    "country.phone": "country.phone",
    "country.hrwebsite": "country.hrWebsite",
    "country.hrphone": "country.hrPhone"
};

// Префикс без учёта регистра: Figma часто даёт [COMPANY.NAME], а не [company.name].
function innerStartsWithCi(inner, prefix) {
    return String(inner || "").toLowerCase().indexOf(String(prefix || "").toLowerCase()) === 0;
}

function hasPrefixFromList(inner, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
        if (innerStartsWithCi(inner, prefixes[i])) return true;
    }
    return false;
}

function canonicalSystemVariableName(inner, typoMapArg, companyMap, branchMap, countryMap) {
    var lower = String(inner || "").toLowerCase();
    if (typoMapArg && typoMapArg[lower]) return typoMapArg[lower];
    if (lower.indexOf("company.") === 0) return (companyMap && companyMap[lower]) || null;
    if (lower.indexOf("branch.") === 0) return (branchMap && branchMap[lower]) || null;
    if (lower.indexOf("country.") === 0) return (countryMap && countryMap[lower]) || null;
    return null;
}

// Дополнительная проверка недопустимых системных переменных через явные GREP-поисковые запросы
try {
    // company.*
    app.findGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = "\\[(?i:company\\.[^\\]]+)\\]"; // регистронезависимо
    var _foundCompanyVars = doc.findGrep();
    var _seenBadCompany = {};
    for (var _i = 0; _i < _foundCompanyVars.length; _i++) {
        var _txt = _foundCompanyVars[_i].contents;
        var _innerLower = _txt.slice(1, -1).toLowerCase();
        if (!allowedCompanyByLower[_innerLower]) {
            if (!_seenBadCompany[_txt]) {
                disallowedCompanyVariables.push(_txt);
                _seenBadCompany[_txt] = true;
            }
        }
    }
    // branch.*
    app.findGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = "\\[(?i:branch\\.[^\\]]+)\\]";
    var _foundBranchVars = doc.findGrep();
    var _seenBadBranch = {};
    for (var _j = 0; _j < _foundBranchVars.length; _j++) {
        var _btxt = _foundBranchVars[_j].contents;
        var _bLower = _btxt.slice(1, -1).toLowerCase();
        if (!allowedBranchByLower[_bLower]) {
            if (!_seenBadBranch[_btxt]) {
                disallowedBranchVariables.push(_btxt);
                _seenBadBranch[_btxt] = true;
            }
        }
    }
    // country.*
    app.findGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = "\\[(?i:country\\.[^\\]]+)\\]";
    var _foundCountryVars = doc.findGrep();
    var _seenBadCountry = {};
    for (var _k = 0; _k < _foundCountryVars.length; _k++) {
        var _ctxt = _foundCountryVars[_k].contents;
        var _cLower = _ctxt.slice(1, -1).toLowerCase();
        if (!allowedCountryByLower[_cLower]) {
            if (!_seenBadCountry[_ctxt]) {
                disallowedCountryVariables.push(_ctxt);
                _seenBadCountry[_ctxt] = true;
            }
        }
    }

    // Жёсткая проверка company.* с исключением разрешённых четырёх имён (на случай, если предыдущие проходы что-то пропустили)
    app.findGrepPreferences = NothingEnum.nothing;
    app.findGrepPreferences.findWhat = "\\[company\\.(?!name\\]|legalAddress\\]|stateNumber\\]|stateNumberLong\\])[^\\]]+\\]";
    var _explicitBadCompany = doc.findGrep();
    var _seenExplicitBadCompany = {};
    for (var _m = 0; _m < _explicitBadCompany.length; _m++) {
        var _ct = _explicitBadCompany[_m].contents;
        if (!_seenExplicitBadCompany[_ct]) {
            disallowedCompanyVariables.push(_ct);
            _seenExplicitBadCompany[_ct] = true;
        }
    }
} catch(e) { /* ignore */ }

// Функция для проверки переменных без квадратных скобок
function checkVariablesWithoutBrackets(doc) {
    var variablesWithoutBrackets = [];
    
    for (var i = 0; i < requiredBracketsVariables.length; i++) {
        var variable = requiredBracketsVariables[i];
        app.findGrepPreferences = NothingEnum.nothing;
        // Ищем переменную как часть текста, а не только точное совпадение
        app.findGrepPreferences.findWhat = "(?<!\\[)" + variable.replace(/\./g, "\\.") + "(?!\\])";
        var found = doc.findGrep();
        
        if (found.length > 0) {
            variablesWithoutBrackets.push(variable);
        }
    }
    
    return variablesWithoutBrackets;
}

app.findGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\[.*?\\]";
var foundVars = doc.findGrep();
for (var i = 0; i < foundVars.length; i++) {
    var varText = foundVars[i].contents;
    var isHidden = false;
    // Проверяем все возможные контейнеры
    if (foundVars[i].parentTextFrames && foundVars[i].parentTextFrames.length > 0) {
        for (var j = 0; j < foundVars[i].parentTextFrames.length; j++) {
            if (isAnyParentHidden(foundVars[i].parentTextFrames[j])) {
                isHidden = true;
                break;
            }
        }
    } else {
        // Если нет parentTextFrames, проверяем сам объект
        if (isAnyParentHidden(foundVars[i])) {
            isHidden = true;
        }
    }
    if (isHidden) {
        variablesOnHiddenLayers.push(varText);
    }
    // Убираем скобки
    var inner = varText.slice(1, -1);

    // Новая проверка на website (исключаем допустимые значения)
    var innerLowerCheck = inner.toLowerCase();
    if (
        innerLowerCheck.indexOf("website") !== -1 &&
        innerLowerCheck !== "country.mainwebsite" &&
        innerLowerCheck !== "country.hrwebsite"
    ) {
        websiteVariablesFound.push(varText);
    }

    if (invalidVarSymbols.test(inner)) {
        invalidVariables.push(varText);
    }
    // Проверка на две и более точки
    if (inner.split('.').length > 2) {
        multipleDotsVariables.push(varText);
    }
    // Проверка на допустимый префикс и наличие точки.
    // company/branch/country — без учёта регистра (капс из Figma).
    // pack/layout/terminal — как написано: канон неизвестен, не угадываем camelCase.
    var isSystemPrefix = hasPrefixFromList(inner, systemPrefixes);
    var hasAllowedPrefix = isSystemPrefix;
    if (!hasAllowedPrefix) {
        for (var p = 0; p < allowedPrefixes.length; p++) {
            if (inner.indexOf(allowedPrefixes[p]) === 0) {
                hasAllowedPrefix = true;
                break;
            }
        }
    }
    if (!hasAllowedPrefix || inner.indexOf(".") === -1) {
        invalidTypeOrDotVariables.push(varText);
    }

    // Системная переменная с чужим регистром / опечаткой — в автозамену, не в «недопустимые».
    if (isSystemPrefix && !allSystemVariables[inner]) {
        var innerLower = inner.toLowerCase();
        var suggestion = canonicalSystemVariableName(
            inner,
            typoMap,
            allowedCompanyByLower,
            allowedBranchByLower,
            allowedCountryByLower
        );

        if (innerLower.indexOf("company.") === 0) {
            if (!suggestion) disallowedCompanyVariables.push(varText);
        } else if (innerLower.indexOf("branch.") === 0) {
            if (!suggestion) disallowedBranchVariables.push(varText);
        } else if (innerLower.indexOf("country.") === 0) {
            if (!suggestion) disallowedCountryVariables.push(varText);
        } else if (!suggestion) {
            unknownSystemVariables.push(varText);
        }

        misspelledSystemVariables.push({
            incorrect: varText,
            suggestion: suggestion
        });
    }
}

// --- Автоматическое исправление системных переменных ---
var systemVariablesFixedCount = 0;
var fixedSystemVariablesReport = "";
var uniqueFixes = {}; // Чтобы избежать дублирования замен и отчетов

// Функция для экранирования специальных символов в строке для использования в GREP
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (var i = 0; i < misspelledSystemVariables.length; i++) {
    var item = misspelledSystemVariables[i];
    if (item.suggestion && !uniqueFixes[item.incorrect]) {
        app.findGrepPreferences = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
        
        app.findGrepPreferences.findWhat = escapeRegExp(item.incorrect);
        app.changeGrepPreferences.changeTo = '[' + item.suggestion + ']';
        
        var replacementsMade = doc.changeGrep();
        if (replacementsMade.length > 0) {
            systemVariablesFixedCount += replacementsMade.length;
            fixedSystemVariablesReport += "   • " + item.incorrect + " → [" + item.suggestion + "]\n";
            uniqueFixes[item.incorrect] = true;
        }
    }
}

// --- Проверка линков и содержимого папки Links ---
var missingLinks = [];
var notInLinksFolder = [];
var usedLinkNames = {};
var linksFolderFiles = [];
var linksFolderPath = null;
var linksFolderOkComparisons = [];
var comparisonDetails = [];
var hasWrongLinks = false;
// 1.46: временно не ругаемся «не из Links» — Preparator часто гоняют до Package.
var REPORT_LINKS_NOT_IN_FOLDER = false;

// Проверка на слетевшие или недоступные линки
for (var i = 0; i < doc.links.length; i++) {
    var link = doc.links[i];
    if (isFigmaReferenceOverlayLink(link)) continue;
    if (link.status === LinkStatus.LINK_MISSING || link.status === LinkStatus.LINK_INACCESSIBLE) {
        missingLinks.push(link.name);
    }
}

function normalizePath(path) {
    return decodeURI(path).replace(/\\/g, "/");
}

function normalizeDriveLetterPath(path) {
    var norm = normalizePath(path);
    // Приводим к виду I:/...
    var driveMatch = norm.match(/^\/([a-z])\//i);
    if (driveMatch) {
        var driveLetter = driveMatch[1].toUpperCase();
        norm = driveLetter + ':/' + norm.substr(3);
    }
    return norm;
}

try {
    var docFile = new File(doc.fullName);
    if (docFile && docFile.parent) {
        var linksFolder = new Folder(docFile.parent.fsName + "/Links");
        if (linksFolder.exists) {
            linksFolderPath = linksFolder.fsName;
        }
    }
} catch(e) {
    $.writeln("Ошибка при определении пути к папке Links: " + e);
}

var normalizedLinksFolder = linksFolderPath ? normalizePath(linksFolderPath) : null;

function getFolderPath(path) {
    var norm = normalizePath(path);
    return norm.substring(0, norm.lastIndexOf('/'));
}

function getParentOfLinksFolder(path) {
    var norm = normalizePath(path);
    var linksIndex = norm.toLowerCase().lastIndexOf('/links');
    if (linksIndex !== -1) {
        return norm.substring(0, linksIndex);
    }
    return getFolderPath(path);
}

function stripTrailingSlash(path) {
    var p = String(path || "");
    while (p.length > 1 && p.charAt(p.length - 1) === "/") {
        p = p.substring(0, p.length - 1);
    }
    return p;
}

/** Папка файла = ожидаемый Links или его подпапка (без учёта регистра). */
function pathIsUnderLinksFolder(imageFolder, expectedLinksFolder) {
    if (!imageFolder || !expectedLinksFolder) return false;
    var img = stripTrailingSlash(normalizePath(imageFolder)).toLowerCase();
    var lnk = stripTrailingSlash(normalizePath(expectedLinksFolder)).toLowerCase();
    return img === lnk || img.indexOf(lnk + "/") === 0;
}

function pluralImagesRu(n) {
    var n10 = n % 10;
    var n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return "изображение";
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "изображения";
    return "изображений";
}

/**
 * Сводка «линки не из Links этого INDD»: группировка по папке, без простыни путей.
 * items: [{ name, folder }, ...]
 */
function formatNotInLinksReport(items, expectedLinksFolder, maxExamples) {
    if (!items || items.length === 0) return "";
    if (!maxExamples) maxExamples = 5;

    var groups = [];
    var byFolder = {};
    var i;
    for (i = 0; i < items.length; i++) {
        var folder = items[i].folder || "(нет пути)";
        if (!byFolder[folder]) {
            byFolder[folder] = [];
            groups.push(folder);
        }
        byFolder[folder].push(items[i].name);
    }

    var lines = [];
    var n = items.length;
    lines.push("⚠ " + n + " " + pluralImagesRu(n) + " ссылаются не на Links рядом с открытым INDD.");
    if (expectedLinksFolder) {
        lines.push("   Ожидается: " + expectedLinksFolder);
    }
    for (i = 0; i < groups.length; i++) {
        var f = groups[i];
        var names = byFolder[f];
        lines.push("   Сейчас: " + f + "  (" + names.length + ")");
        var shown = Math.min(maxExamples, names.length);
        var j;
        for (j = 0; j < shown; j++) {
            lines.push("      • " + names[j]);
        }
        if (names.length > shown) {
            lines.push("      … и ещё " + (names.length - shown));
        }
    }
    lines.push("   Частый случай: Package на Desktop, а открыт файл с Диска. Для Терминала линки должны быть в Links рядом с этим INDD.");
    return lines.join("\n") + "\n";
}

function isSilentPreparatorRun() {
    try {
        if (app.scriptPreferences.userInteractionLevel === UserInteractionLevels.NEVER_INTERACT) {
            return true;
        }
    } catch (eUil) {}
    try {
        if (app.scriptArgs.isDefined("silent")) {
            var silentVal = String(app.scriptArgs.getValue("silent")).toLowerCase();
            if (silentVal === "1" || silentVal === "true" || silentVal === "yes") {
                return true;
            }
        }
    } catch (eArg) {}
    return false;
}

function persistPrepReport(reportText) {
    var text = String(reportText || "");
    try {
        $.global.terminalPreparatorLastReport = text;
    } catch (eG) {}
    var outPath = "";
    try {
        if (app.scriptArgs.isDefined("prepReport")) {
            outPath = String(app.scriptArgs.getValue("prepReport") || "");
        }
    } catch (eArg) {}
    if (!outPath) return;
    try {
        var rf = File(outPath);
        rf.encoding = "UTF-8";
        if (rf.open("w")) {
            rf.write(text);
            rf.close();
        }
    } catch (eW) {}
}

function reportIsAllOk(text) {
    var s = String(text || "");
    return s.indexOf("\u26a0") === -1 && s.indexOf("\u0412\u0441\u0435 \u043e\u043a") !== -1;
}

function isBlankReport(text) {
    return String(text || "").replace(/\s+/g, "") === "";
}

function joinPrepReport(errorsText, logText) {
    var e = String(errorsText || "").replace(/\s+$/, "");
    var l = String(logText || "").replace(/\s+$/, "");
    if (!l) return e;
    if (!e) return l;
    return e + "\n\n" + l;
}

function countVisualLines(text, charsPerLine) {
    var rawLines = String(text || "").split("\n");
    var visualLines = 0;
    var c = Math.max(1, charsPerLine || 28);
    var i, lineLen;
    for (i = 0; i < rawLines.length; i++) {
        lineLen = rawLines[i].length;
        visualLines += lineLen <= 0 ? 1 : Math.max(1, Math.ceil(lineLen / c));
    }
    return visualLines;
}

function paginateReportPages(text, maxVisualLines, charsPerLine) {
    var maxL = Math.max(1, maxVisualLines || 20);
    var c = Math.max(1, charsPerLine || 28);
    var rawLines = String(text || "").split("\n");
    var pages = [];
    var cur = [];
    var curVis = 0;
    var i, lineLen, vis;
    function flush() {
        if (cur.length === 0) return;
        pages.push(cur.join("\n"));
        cur = [];
        curVis = 0;
    }
    for (i = 0; i < rawLines.length; i++) {
        lineLen = rawLines[i].length;
        vis = lineLen <= 0 ? 1 : Math.max(1, Math.ceil(lineLen / c));
        if (cur.length > 0 && curVis + vis > maxL) {
            flush();
        }
        cur.push(rawLines[i]);
        curVis += vis;
        if (curVis >= maxL) {
            flush();
        }
    }
    flush();
    if (pages.length === 0) pages.push("");
    return pages;
}

function dialogBoxMetrics() {
    var lineH = 18;
    var padH = 28;
    var boxW = 320;
    var maxH = 360;
    try {
        if (typeof $.screens !== "undefined" && $.screens && $.screens.length > 0) {
            var scr = $.screens[0];
            var scrH = scr.bottom - scr.top;
            var scrW = scr.right - scr.left;
            if (scrW > 0) boxW = Math.min(340, Math.max(280, Math.floor(scrW * 0.20)));
            if (scrH > 0) maxH = Math.min(360, Math.max(320, Math.floor(scrH * 0.34)));
        }
    } catch (eScr) {}
    return {
        lineH: lineH,
        padH: padH,
        boxW: boxW,
        maxH: maxH,
        winW: boxW + 32,
        winH: maxH + 80,
        paneMargins: [8, 8, 8, 8],
        charsPerLine: Math.max(28, Math.floor(boxW / 7))
    };
}

function applyFixedDialogSize(w, metrics) {
    w.preferredSize = [metrics.winW, metrics.winH];
    try {
        w.minimumSize = [metrics.winW, metrics.winH];
        w.maximumSize = [metrics.winW, metrics.winH];
    } catch (eSize) {}
}

function addDialogOkButton(parent, metrics) {
    var okRow = parent.add("group");
    okRow.orientation = "row";
    okRow.alignment = ["fill", "bottom"];
    okRow.alignChildren = ["right", "center"];
    var okBtn = okRow.add("button", undefined, "OK", {name: "ok"});
    okBtn.preferredSize = [80, 24];
    okBtn.minimumSize = [80, 24];
    return okBtn;
}

function addPagedReportPane(parent, text, metrics) {
    var boxW = metrics.boxW;
    var maxH = metrics.maxH;
    var lineH = metrics.lineH;
    var padH = metrics.padH;
    var charsPerLine = metrics.charsPerLine;
    var maxLines = Math.max(4, Math.floor((maxH - padH) / lineH));
    var pages = paginateReportPages(text, maxLines, charsPerLine);
    var pageIdx = 0;
    var boxH = maxH;

    var et = parent.add("statictext", undefined, pages[0], {multiline: true});
    et.preferredSize = [boxW, boxH];
    et.minimumSize = [boxW, boxH];
    et.alignment = ["fill", "top"];

    if (pages.length > 1) {
        var nav = parent.add("group");
        nav.alignment = ["fill", "bottom"];
        nav.orientation = "row";
        nav.alignChildren = ["center", "center"];
        var prev = nav.add("button", undefined, "<");
        prev.preferredSize = [32, 24];
        var lab = nav.add("statictext", undefined, "1 / " + pages.length);
        lab.preferredSize = [64, 22];
        lab.justify = "center";
        var next = nav.add("button", undefined, ">");
        next.preferredSize = [32, 24];

        function refreshPage() {
            et.text = pages[pageIdx];
            lab.text = (pageIdx + 1) + " / " + pages.length;
            prev.enabled = pageIdx > 0;
            next.enabled = pageIdx < pages.length - 1;
        }
        prev.onClick = function () {
            if (pageIdx > 0) {
                pageIdx--;
                refreshPage();
            }
        };
        next.onClick = function () {
            if (pageIdx < pages.length - 1) {
                pageIdx++;
                refreshPage();
            }
        };
        refreshPage();
    }
}

function addReportTabs(parent, errorsText, logText, metrics) {
    var logShow = String(logText || "").replace(/\s+$/, "");
    var paneMargins = metrics.paneMargins;

    if (isBlankReport(logShow)) {
        var pane = parent.add("group");
        pane.orientation = "column";
        pane.alignChildren = ["fill", "top"];
        pane.alignment = ["fill", "top"];
        pane.margins = paneMargins;
        addPagedReportPane(pane, errorsText, metrics);
        return pane;
    }

    var tpanel = parent.add("tabbedpanel");
    tpanel.alignChildren = ["fill", "fill"];
    tpanel.preferredSize = [metrics.boxW + 24, metrics.maxH + 56];

    var tabErr = tpanel.add("tab", undefined, "Важное");
    tabErr.orientation = "column";
    tabErr.alignChildren = ["fill", "top"];
    tabErr.margins = paneMargins;
    tabErr.spacing = 6;
    addPagedReportPane(tabErr, errorsText, metrics);

    var tabLog = tpanel.add("tab", undefined, "Неважное");
    tabLog.orientation = "column";
    tabLog.alignChildren = ["fill", "top"];
    tabLog.margins = paneMargins;
    tabLog.spacing = 6;
    addPagedReportPane(tabLog, logShow, metrics);

    tpanel.selection = tabErr;
    return tpanel;
}

function showTabbedReportDialog(errorsText, logText) {
    var metrics = dialogBoxMetrics();
    var w = new Window("dialog", "Terminal Preparator");
    w.orientation = "column";
    w.alignChildren = ["fill", "fill"];
    w.margins = 8;
    w.spacing = 8;

    addReportTabs(w, errorsText, logText, metrics);

    addDialogOkButton(w, metrics);

    applyFixedDialogSize(w, metrics);
    w.center();
    w.show();
}

function stopPrepDance() {
    try {
        for (var i = app.idleTasks.length - 1; i >= 0; i--) {
            if (String(app.idleTasks[i].name) === "TerminalPreparatorDance") {
                app.idleTasks[i].remove();
            }
        }
    } catch (eStop) {}
}

function fwRnd(a, b) {
    return a + Math.random() * (b - a);
}

function createFireworksSim(cols, rows) {
    var rockets = [];
    var sparks = [];
    var tick = 0;
    var cooldown = 0;
    var launched = 0;
    var cellN = cols * rows;
    var cells = [];
    var prio = [];
    var dirty = [];
    var dirtyN = 0;
    var ci;
    for (ci = 0; ci < cellN; ci++) {
        cells[ci] = " ";
        prio[ci] = 0;
    }

    function spawnRocket() {
        rockets.push({
            x: fwRnd(5, cols - 6),
            y: rows - 1,
            vy: fwRnd(-1.2, -0.92),
            peak: fwRnd(1, Math.max(4, rows * 0.52))
        });
    }

    function explode(x, y) {
        var n = 28 + Math.floor(Math.random() * 10);
        var i, a, sp;
        for (i = 0; i < n; i++) {
            a = (i / n) * Math.PI * 2 + fwRnd(-0.15, 0.15);
            sp = fwRnd(0.42, 0.95);
            sparks.push({
                x: x,
                y: y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp * 0.82,
                life: 16 + Math.floor(fwRnd(0, 10)),
                maxLife: 26
            });
        }
        for (i = 0; i < 14; i++) {
            a = fwRnd(0, Math.PI * 2);
            sp = fwRnd(0.12, 0.38);
            sparks.push({
                x: x,
                y: y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp * 0.8,
                life: 10 + Math.floor(fwRnd(0, 8)),
                maxLife: 18
            });
        }
    }

    function clearGrid() {
        var d, idx;
        for (d = 0; d < dirtyN; d++) {
            idx = dirty[d];
            cells[idx] = " ";
            prio[idx] = 0;
        }
        dirtyN = 0;
    }

    function plot(x, y, ch, priVal) {
        var xi = Math.floor(x + 0.5);
        var yi = Math.floor(y + 0.5);
        if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) return;
        var idx = yi * cols + xi;
        if (priVal >= prio[idx]) {
            if (prio[idx] === 0) {
                dirty[dirtyN] = idx;
                dirtyN++;
            }
            cells[idx] = ch;
            prio[idx] = priVal;
        }
    }

    function render() {
        var y, x, row, parts = [];
        for (y = 0; y < rows; y++) {
            row = [];
            var base = y * cols;
            for (x = 0; x < cols; x++) row[x] = cells[base + x];
            parts[y] = row.join("");
        }
        return parts.join("\n");
    }

    function step() {
        var i, r, s, t, ch, priVal;
        tick++;
        if (cooldown > 0) cooldown--;
        if (cooldown <= 0 && rockets.length === 0 && sparks.length < 3) {
            if (launched >= 5) {
                launched = 0;
                cooldown = 22;
            } else {
                spawnRocket();
                launched++;
                cooldown = 18;
            }
        }

        for (i = rockets.length - 1; i >= 0; i--) {
            r = rockets[i];
            r.y += r.vy;
            r.vy += 0.004;
            if (r.y <= r.peak) {
                explode(r.x, r.y);
                rockets.splice(i, 1);
                cooldown = 16;
            }
        }

        for (i = sparks.length - 1; i >= 0; i--) {
            s = sparks[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.022;
            s.vx *= 0.99;
            s.life--;
            if (s.life <= 0 || s.y >= rows) sparks.splice(i, 1);
        }

        clearGrid();

        for (i = 0; i < rockets.length; i++) {
            r = rockets[i];
            plot(r.x, r.y, "^", 4);
            plot(r.x, r.y + 1, "|", 3);
            plot(r.x, r.y + 2, ":", 2);
            plot(r.x, r.y + 3, ".", 1);
        }

        for (i = 0; i < sparks.length; i++) {
            s = sparks[i];
            t = s.life / (s.maxLife || 18);
            ch = ".";
            priVal = 1;
            if (t > 0.78) { ch = "@"; priVal = 5; }
            else if (t > 0.55) { ch = "*"; priVal = 4; }
            else if (t > 0.35) { ch = "+"; priVal = 3; }
            else if (t > 0.18) { ch = ":"; priVal = 2; }
            plot(s.x, s.y, ch, priVal);
        }

        return render();
    }

    return { step: step };
}

function setMonoFont(control, size) {
    try {
        control.graphics.font = ScriptUI.newFont("Courier New", "REGULAR", size);
        return;
    } catch (e1) {}
    try {
        control.graphics.font = ScriptUI.newFont("Courier", "REGULAR", size);
    } catch (e2) {}
}

function showAllOkDanceDialog(reportText, logText) {
    stopPrepDance();

    var metrics = dialogBoxMetrics();
    var boxW = metrics.boxW;
    var dancerH = metrics.maxH - 48;

    var fwCols = Math.max(46, Math.floor(boxW / 5));
    var fwRows = Math.max(28, Math.floor(dancerH / 12));
    var sim = createFireworksSim(fwCols, fwRows);
    var logStr = String(logText || "").replace(/\s+$/, "");

    var w = new Window("palette", "Terminal Preparator");
    w.orientation = "column";
    w.alignChildren = ["fill", "fill"];
    w.margins = 8;
    w.spacing = 8;

    var okParent = w;
    if (logStr) {
        var tpanel = w.add("tabbedpanel");
        tpanel.alignChildren = ["fill", "fill"];
        tpanel.preferredSize = [metrics.boxW + 24, metrics.maxH + 56];
        var tabOk = tpanel.add("tab", undefined, "Важное");
        tabOk.orientation = "column";
        tabOk.alignChildren = ["fill", "top"];
        tabOk.margins = metrics.paneMargins;
        tabOk.spacing = 6;
        var tabLog = tpanel.add("tab", undefined, "Неважное");
        tabLog.orientation = "column";
        tabLog.alignChildren = ["fill", "top"];
        tabLog.margins = metrics.paneMargins;
        tabLog.spacing = 6;
        addPagedReportPane(tabLog, logStr, metrics);
        tpanel.selection = tabOk;
        okParent = tabOk;
    } else {
        var pane = w.add("group");
        pane.orientation = "column";
        pane.alignChildren = ["fill", "top"];
        pane.alignment = ["fill", "fill"];
        pane.margins = metrics.paneMargins;
        okParent = pane;
    }

    var et = okParent.add("statictext", undefined, reportText, {multiline: true});
    et.preferredSize = [boxW, 22];
    et.alignment = ["fill", "top"];

    var dancer = okParent.add("statictext", undefined, sim.step(), {multiline: true});
    dancer.preferredSize = [boxW, dancerH];
    dancer.alignment = ["fill", "top"];
    setMonoFont(dancer, 8);
    try {
        dancer.graphics.foregroundColor = dancer.graphics.newPen(
            dancer.graphics.PenType.SOLID_COLOR,
            [0.72, 0.32, 0.04],
            1
        );
    } catch (eFg) {}

    var okBtn = addDialogOkButton(w, metrics);
    okBtn.onClick = function () {
        stopPrepDance();
        w.close();
    };
    w.onClose = function () {
        stopPrepDance();
        return true;
    };

    var task = app.idleTasks.add({
        name: "TerminalPreparatorDance",
        sleep: 20
    });
    task.addEventListener("onIdle", function () {
        try {
            if (!w.visible) {
                stopPrepDance();
                return;
            }
            dancer.text = sim.step();
        } catch (eTick) {
            stopPrepDance();
        }
    });

    applyFixedDialogSize(w, metrics);
    w.center();
    w.show();
    try {
        dancer.text = sim.step();
    } catch (eKick) {}
}

function showReportDialog(errorsText, logText) {
    var reportText = joinPrepReport(errorsText, logText);
    persistPrepReport(reportText);
    stopPrepDance();
    if (isSilentPreparatorRun()) {
        try { $.writeln(reportText); } catch (eLog) {}
        return;
    }
    if (reportIsAllOk(errorsText)) {
        try {
            showAllOkDanceDialog(errorsText, logText);
            return;
        } catch (eDance) {
            stopPrepDance();
        }
    }
    try {
        showTabbedReportDialog(errorsText, logText);
    } catch (eWin) {
        if (isSilentPreparatorRun()) return;
        alert(reportText);
    }
}

if (linksFolderPath) {
    var inddFolder = getFolderPath(doc.fullName);
    var linksFolder = normalizeDriveLetterPath(inddFolder + '/Links');
    for (var i = 0; i < doc.links.length; i++) {
        var link = doc.links[i];
        if (link.name.indexOf('QR Code') === 0) continue;
        if (isFigmaReferenceOverlayLink(link)) continue;
        try {
            var filePath = link.filePath;
            var imageFolder = normalizeDriveLetterPath(getFolderPath(filePath));
            // --- ДОПОЛНИТЕЛЬНАЯ ДИАГНОСТИКА doc.fullName ---
            try {
                $.writeln("DEBUG: doc.fullName = " + doc.fullName + " (type: " + typeof doc.fullName + ")");
            } catch(e) {
                $.writeln("DEBUG: doc.fullName вызвал ошибку (" + e + ")");
            }
            // Пробуем получить путь к папке Links стандартным способом
            var linksFolderDiag = null;
            try {
                linksFolderDiag = normalizeDriveLetterPath(getFolderPath(doc.fullName) + '/Links');
                $.writeln("DEBUG: linksFolder = " + linksFolderDiag);
            } catch(e) {
                $.writeln("⚠ Не удалось получить путь к папке Links (" + e + ")");
                linksFolderDiag = null;
            }
            // Если doc.fullName не определён, используем imageFolder как папку Links для сравнения
            if (!doc.fullName) {
                $.writeln("⚠ doc.fullName не определён, сравнение с папкой Links невозможно.");
            } else if (linksFolderDiag && !pathIsUnderLinksFolder(imageFolder, linksFolderDiag)) {
                $.writeln("⚠ Не в папке Links (" + imageFolder + ")");
            }
            if (!pathIsUnderLinksFolder(imageFolder, linksFolder)) {
                notInLinksFolder.push({ name: link.name, folder: imageFolder });
            }
            usedLinkNames[link.name] = true;
        } catch(e) {
            notInLinksFolder.push({ name: link.name, folder: "ошибка: " + e });
            comparisonDetails.push('❌ ' + link.name + ' — ошибка: ' + e);
            hasWrongLinks = true;
        }
    }
}

// Проверяем содержимое папки Links
if (linksFolderPath) {
    try {
        var linksFolder = new Folder(linksFolderPath);
        if (linksFolder.exists) {
            var files = linksFolder.getFiles();
            for (var j = 0; j < files.length; j++) {
                if (files[j] instanceof File) {
                    var fname = files[j].name;
                    linksFolderFiles.push(fname);
                }
            }
        }
    } catch(e) {
        $.writeln("Ошибка при проверке содержимого папки Links: " + e);
    }
}

// --- ПРОВЕРКА QR-КОДОВ ---
var qrErrors = [];
var qrErrorMap = {};
var allowedPrefixes = ["country.", "company.", "branch.", "pack.", "layout.", "terminal."];
var invalidVarSymbols = /[ \-–_,&]/;

function checkQROnPage(page) {
    for (var i = 0; i < page.rectangles.length; i++) {
        var rect = page.rectangles[i];
        if (rect.graphics.length === 0) continue;
        var graphic = rect.graphics[0];
        // --- ПРОВЕРКА QR-КОДА ОТКЛЮЧЕНА ---
        /*
        // Кандидат в QR-код: нет itemLink (или имя не пустое)
        var isQR = (!graphic.itemLink) || (rect.name && rect.name !== "");
        if (!isQR) continue;
        var objName = rect.name;
        if (!qrErrorMap[objName]) qrErrorMap[objName] = [];
        // Проверяем оформление имени
        var isVar = objName && objName.match(/^\[.*\]$/);
        if (!isVar) {
            qrErrorMap[objName].push("⚠ Имя объекта QR-кода '" + objName + "' не оформлено как переменная в квадратных скобках");
            $.writeln('Ошибка: имя не в скобках!');
            continue; // остальные проверки не нужны
        }
        var inner = objName.slice(1, -1);
        var hasAllowedPrefix = false;
        for (var p = 0; p < allowedPrefixes.length; p++) {
            if (inner.indexOf(allowedPrefixes[p]) === 0) {
                hasAllowedPrefix = true;
                break;
            }
        }
        if (!hasAllowedPrefix || inner.indexOf(".") === -1) {
            qrErrorMap[objName].push("⚠ Имя объекта QR-кода должно быть только типа country, company, branch, pack, layout или terminal и содержать точку: " + objName);
            $.writeln('Ошибка: неверный префикс или нет точки!');
        }
        if (invalidVarSymbols.test(inner)) {
            qrErrorMap[objName].push("⚠ В названии переменных не поддерживаются пробел, дефис, тире, нижнее подчеркивание, запятые и амперсанд: " + objName);
            $.writeln('Ошибка: запрещённые символы!');
        }
        // Проверка окончания #qr
        if (inner.substr(inner.length - 3) !== "#qr") {
            qrErrorMap[objName].push("⚠ Имя объекта QR-кода должно заканчиваться на #qr: " + objName);
            $.writeln('Ошибка: не заканчивается на #qr!');
        }
        // Проверка: существует ли swatch с нужным именем (без скобок)
        var swatchNameNoBrackets = objName.slice(1, -1);
        var swatchExists = false;
        try {
            var swatch = doc.swatches.itemByName(swatchNameNoBrackets);
            swatchExists = swatch && swatch.isValid;
        } catch (e) {
            swatchExists = false;
        }
        if (!swatchExists) {
            qrErrorMap[objName].push("⚠ Для QR-кода нет swatch с именем " + swatchNameNoBrackets + " (без скобок)");
        }
        */
    }
}

// --- ПРОВЕРКА ИМЕН ОБЪЕКТОВ НА ПОДДЕРЖИВАЕМЫЕ ХЭШТЕГИ ---
var qrNameMistakes = [];
var uniqueMistakes = {}; // Используем объект для проверки уникальности
var missingSwatchErrors = [];
var uniqueSwatchErrorCheck = {};
var linkVariableWithoutLinkErrors = [];
var uniqueLinkVariableWithoutLinkCheck = {};

function isQrVariableObjectName(inner) {
    return inner.slice(-3) === "#qr";
}

function isLinkVariableObjectName(inner) {
    return inner.slice(-5) === "#link";
}

function hasSupportedVariableObjectSuffix(inner) {
    return isQrVariableObjectName(inner) || isLinkVariableObjectName(inner);
}

// Ферма (fillLink + fit) падает: "leave the pasteboard" на #link
// (картинка из value set / штатный бlid). Страницу не трогаем — только серое поле.
// Если в макете есть хотя бы один #link — подстраховываем pasteboard (даже без вылета:
// PNG из set может быть больше плейсхолдера). Нет #link — ничего не делаем.
var PASTEBOARD_LINK_BUFFER_PT = 400;
var PASTEBOARD_LINK_FLOOR_PT = 2000;
var pasteboardExpandInfo = null;

function round1(n) {
    return Math.round(n * 10) / 10;
}

function expandPasteboardForLinkOverhang() {
    var view = doc.viewPreferences;
    var oldH = view.horizontalMeasurementUnits;
    var oldV = view.verticalMeasurementUnits;
    view.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    view.verticalMeasurementUnits = MeasurementUnits.POINTS;

    var result = {
        changed: false,
        fromH: 0,
        fromV: 0,
        toH: 0,
        toV: 0,
        details: []
    };

    try {
        var current = doc.pasteboardPreferences.pasteboardMargins;
        var curH = current[0];
        var curV = current[1];
        result.fromH = curH;
        result.fromV = curV;
        result.toH = curH;
        result.toV = curV;

        var maxH = 0;
        var maxV = 0;
        var hasLink = false;
        var details = [];

        function considerItem(item, page) {
            if (!item || !page) return;
            var name = "";
            try {
                name = item.name;
            } catch (eName) {
                return;
            }
            if (!name || name.charAt(0) !== "[" || name.charAt(name.length - 1) !== "]") return;
            var inner = name.slice(1, -1);
            if (!isLinkVariableObjectName(inner)) return;

            hasLink = true;

            var gb;
            var pb;
            try {
                gb = item.geometricBounds;
                pb = page.bounds;
            } catch (eBounds) {
                return;
            }

            var overLeft = pb[1] - gb[1];
            var overRight = gb[3] - pb[3];
            var overTop = pb[0] - gb[0];
            var overBottom = gb[2] - pb[2];
            var side = Math.max(0, overLeft, overRight);
            var vert = Math.max(0, overTop, overBottom);
            if (side > 0.5 || vert > 0.5) {
                details.push({
                    name: name,
                    overLeft: Math.max(0, overLeft),
                    overRight: Math.max(0, overRight),
                    overTop: Math.max(0, overTop),
                    overBottom: Math.max(0, overBottom)
                });
            }
            if (side > maxH) maxH = side;
            if (vert > maxV) maxV = vert;
        }

        var i;
        var j;
        for (i = 0; i < doc.pages.length; i++) {
            var page = doc.pages[i];
            var pageItems = page.allPageItems;
            for (j = 0; j < pageItems.length; j++) {
                considerItem(pageItems[j], page);
            }
        }
        for (i = 0; i < doc.masterSpreads.length; i++) {
            var ms = doc.masterSpreads[i];
            for (j = 0; j < ms.pages.length; j++) {
                var masterPage = ms.pages[j];
                var masterItems = masterPage.allPageItems;
                var k;
                for (k = 0; k < masterItems.length; k++) {
                    considerItem(masterItems[k], masterPage);
                }
            }
        }

        result.details = details;
        result.hasLink = hasLink;
        if (hasLink) {
            var needH = Math.max(curH, PASTEBOARD_LINK_FLOOR_PT);
            var needV = Math.max(curV, PASTEBOARD_LINK_FLOOR_PT);
            if (maxH > 0) needH = Math.max(needH, maxH + PASTEBOARD_LINK_BUFFER_PT);
            if (maxV > 0) needV = Math.max(needV, maxV + PASTEBOARD_LINK_BUFFER_PT);

            var changed = false;
            if (needH > curH + 1) {
                changed = true;
            }
            if (needV > curV + 1) {
                changed = true;
            }
            if (changed) {
                doc.pasteboardPreferences.pasteboardMargins = [needH, needV];
                result.changed = true;
                result.toH = needH;
                result.toV = needV;
            }
        }
    } catch (eExpand) {
        result.error = String(eExpand);
    }

    view.horizontalMeasurementUnits = oldH;
    view.verticalMeasurementUnits = oldV;
    return result;
}

function itemHasLinkedAsset(item) {
    try {
        if (item.itemLink && item.itemLink.isValid) {
            return true;
        }
    } catch(e) {}

    try {
        if (item.graphics && item.graphics.length > 0) {
            for (var g = 0; g < item.graphics.length; g++) {
                if (item.graphics[g].itemLink && item.graphics[g].itemLink.isValid) {
                    return true;
                }
            }
        }
    } catch(e) {}

    return false;
}

// --- ПРОВЕРКА ИМЕН ОБЪЕКТОВ НА #qr / #link В НАЗВАНИИ ---
try {
    var allItemsToCheck = [];
    // Собираем объекты со всех страниц
    for (var i = 0; i < doc.pages.length; i++) {
        var pageItems = doc.pages[i].allPageItems;
        for (var j = 0; j < pageItems.length; j++) {
            allItemsToCheck.push(pageItems[j]);
        }
    }
    // Собираем объекты со всех мастер-страниц
    for (var i = 0; i < doc.masterSpreads.length; i++) {
        var masterItems = doc.masterSpreads[i].allPageItems;
        for (var j = 0; j < masterItems.length; j++) {
            allItemsToCheck.push(masterItems[j]);
        }
    }

    for (var i = 0; i < allItemsToCheck.length; i++) {
        var item = allItemsToCheck[i];
        var itemName = item.name;
        if (itemName && itemName.match(/^\[.*\]$/)) {
            var inner = itemName.slice(1, -1);
            if (!hasSupportedVariableObjectSuffix(inner)) {
                if (!uniqueMistakes[itemName]) {
                    qrNameMistakes.push(itemName);
                    uniqueMistakes[itemName] = true;
                }
            }

            // #link — это asset link переменная. Для неё не нужен одноименный свотч,
            // но в шаблоне должен быть файл, который id-templater сможет заменить.
            if (isLinkVariableObjectName(inner) && !itemHasLinkedAsset(item)) {
                if (!uniqueLinkVariableWithoutLinkCheck[itemName]) {
                    linkVariableWithoutLinkErrors.push(itemName);
                    uniqueLinkVariableWithoutLinkCheck[itemName] = true;
                }
            }

            // --- ПРОВЕРКА СВОТЧЕЙ ДЛЯ QR ---
            if (isQrVariableObjectName(inner)) {
                var swatchExists = false;
                try {
                    var swatch = doc.swatches.itemByName(inner);
                    if (swatch.isValid) swatchExists = true;
                } catch(e) {}
                if (!swatchExists) {
                    if(!uniqueSwatchErrorCheck[itemName]) {
                        missingSwatchErrors.push(itemName);
                        uniqueSwatchErrorCheck[itemName] = true;
                    }
                }
            }
            // --- КОНЕЦ ПРОВЕРКИ СВОТЧЕЙ ---
        }
    }
} catch (e) {
    // Ошибку игнорируем, чтобы не прерывать выполнение
}

try {
    pasteboardExpandInfo = expandPasteboardForLinkOverhang();
} catch (ePasteboard) {
    pasteboardExpandInfo = { changed: false, error: String(ePasteboard), details: [] };
}


// Проверяем все страницы и мастер-страницы
for (var i = 0; i < doc.pages.length; i++) checkQROnPage(doc.pages[i]);
for (var i = 0; i < doc.masterSpreads.length; i++) {
    for (var j = 0; j < doc.masterSpreads[i].pages.length; j++) {
        checkQROnPage(doc.masterSpreads[i].pages[j]);
    }
}

// --- ПРОВЕРКА ПОВТОРЯЮЩИХСЯ СЛОВ (БЕЗ GREP) ---
var repeatedWordsFound = [];
var uniqueRepeats = {};

try {
    var allStories = doc.stories.everyItem().getElements();
    for (var s = 0; s < allStories.length; s++) {
        var story = allStories[s];
        if (story.contents.length === 0) continue;

        var isHidden = false;
        try {
            if (story.parent.constructor.name === "TextFrame") {
                 isHidden = isAnyParentHidden(story.parent);
            }
        } catch(e){}
        if (isHidden) continue;

        var paragraphs = story.paragraphs.everyItem().getElements();
        for (var p = 0; p < paragraphs.length; p++) {
            var words = paragraphs[p].words.everyItem().getElements();
            if (words.length < 2) continue;

            for (var i = 0; i < words.length - 1; i++) {
                var word1 = words[i];
                var word2 = words[i+1];

                var cleanContent1 = word1.contents.replace(/[.,:;!?"'«»()\[\]]/g, '').toLowerCase();
                var cleanContent2 = word2.contents.replace(/[.,:;!?"'«»()\[\]]/g, '').toLowerCase();

                if (cleanContent1 && cleanContent1 === cleanContent2) {
                    var repeatText = word1.contents + " " + word2.contents;
                    var normalizedRepeat = repeatText.toLowerCase();

                    if (!uniqueRepeats[normalizedRepeat]) {
                        repeatedWordsFound.push('"' + repeatText + '"');
                        uniqueRepeats[normalizedRepeat] = true;
                    }
                }
            }
        }
    }
} catch(e) {
    // Игнорируем ошибки
}
// --- КОНЕЦ ПРОВЕРКИ ПОВТОРОВ ---

// 3. Формируем предупреждения: ошибки сразу, автозамены и прочий шум — в лог.
var errorReport = "";
var logReport = "";

// Группируем ошибки по QR-кодам
var qrKeys = [];
for (var key in qrErrorMap) {
    if (qrErrorMap.hasOwnProperty(key)) {
        qrKeys.push(key);
    }
}
if (qrKeys.length > 0) {
    for (var i = 0; i < qrKeys.length; i++) {
        var qrName = qrKeys[i];
        var errors = qrErrorMap[qrName];
        if (errors.length > 0) {
            errorReport += "QR-код " + qrName + "\n";
            for (var j = 0; j < errors.length; j++) {
                errorReport += errors[j] + "\n";
            }
            errorReport += "\n";
        }
    }
}

// Чёрные не трогаем и не конвертируем — только предупреждение, если в макете смешаны разные «чёрные»
function classifyBlackishColor(color) {
    if (!color) return null;
    try {
        if (!color.isValid) return null;
    } catch (e0) {
        return null;
    }
    var name = "";
    try { name = String(color.name || ""); } catch (e1) {}
    if (name.indexOf("Registration") !== -1) return "registration";
    try {
        var space = color.space;
        var v = color.colorValue;
        if (space === ColorSpace.CMYK && v && v.length >= 4) {
            var c = Number(v[0]), m = Number(v[1]), y = Number(v[2]), k = Number(v[3]);
            var cmy = c + m + y;
            if (k >= 85 && cmy <= 12) return "k100";
            if (k >= 40 && cmy >= 60) return "rich";
        }
        if (space === ColorSpace.RGB && v && v.length >= 3) {
            if (v[0] <= 20 && v[1] <= 20 && v[2] <= 20) return "rgb";
        }
        if (space === ColorSpace.GRAY && v && v.length >= 1) {
            if (Number(v[0]) <= 15) return "gray";
        }
    } catch (e2) {}
    if (name === "Black" || name === "[Black]") return "k100";
    return null;
}

function noteBlackFromItem(item, kinds) {
    try {
        var fill = item.fillColor;
        var k1 = classifyBlackishColor(fill);
        if (k1) kinds[k1] = true;
    } catch (eF) {}
    try {
        var stroke = item.strokeColor;
        var k2 = classifyBlackishColor(stroke);
        if (k2) kinds[k2] = true;
    } catch (eS) {}
}

var mixedBlackKinds = {};
var mixedBlackFound = false;
var mixedBlackReport = "";
try {
    var blackScanLimit = 400;
    var scanned = 0;
    for (var pg = 0; pg < doc.pages.length && scanned < blackScanLimit; pg++) {
        var items = doc.pages[pg].allPageItems;
        for (var ii = 0; ii < items.length && scanned < blackScanLimit; ii++) {
            if (isFigmaReferenceOverlayItem(items[ii])) continue;
            noteBlackFromItem(items[ii], mixedBlackKinds);
            scanned++;
        }
    }
    for (var st = 0; st < doc.stories.length && scanned < blackScanLimit; st++) {
        var story = doc.stories[st];
        try {
            var ranges = story.textStyleRanges;
            var rmax = Math.min(ranges.length, 80);
            for (var ri = 0; ri < rmax && scanned < blackScanLimit; ri++) {
                try {
                    var kT = classifyBlackishColor(ranges[ri].fillColor);
                    if (kT) mixedBlackKinds[kT] = true;
                } catch (eR) {}
                scanned++;
            }
        } catch (eStory) {}
    }
} catch (eBlack) {}
var mixedBlackLabels = [];
if (mixedBlackKinds.k100) mixedBlackLabels.push("K100 / [Black]");
if (mixedBlackKinds.rich) mixedBlackLabels.push("rich black (CMYK с цветными)");
if (mixedBlackKinds.rgb) mixedBlackLabels.push("RGB 0-0-0");
if (mixedBlackKinds.gray) mixedBlackLabels.push("Gray");
if (mixedBlackKinds.registration) mixedBlackLabels.push("Registration");
if (mixedBlackLabels.length >= 2) {
    mixedBlackFound = true;
    mixedBlackReport = "⚠ В макете смешаны разные чёрные: " + mixedBlackLabels.join(", ") + ". На печати они могут разъехаться. Preparator цвет не меняет — выровняйте вручную.\n\n";
}

// Линки и [terminal.renderCode] скрипт не удаляет — только отчёт. Старый 1.35 вырезал renderCode, 1.36+ нет.
// 1.45: [terminal.renderCode] — допустимый префикс terminal., не ошибка типа переменной.
// 1.46: «не из Links» в отчёт не кладём (REPORT_LINKS_NOT_IN_FOLDER).
// --- ДОБАВЛЕНО: Явные предупреждения по линкам и папке Links ---
if (missingLinks.length > 0) {
    errorReport += "⚠ В макете есть слетевшие или отсутствующие линки:\n";
    for (var i = 0; i < missingLinks.length; i++) {
        errorReport += "   • " + missingLinks[i] + "\n";
    }
    errorReport += "\n";
}

if (REPORT_LINKS_NOT_IN_FOLDER && notInLinksFolder.length > 0) {
    errorReport += formatNotInLinksReport(notInLinksFolder, normalizedLinksFolder, 5);
    errorReport += "\n";
}

if (comparisonDetails.length > 0) {
    errorReport += '\nПроверка каждой картинки относительно папки Links:\n';
    for (var i = 0; i < comparisonDetails.length; i++) {
        errorReport += '   ' + comparisonDetails[i] + '\n';
    }
}

if (
    hasPPIWarning ||
    hasFileSizeWarning ||
    bleedWarning ||
    problematicFontsFound ||
    hasLegalWithoutAutosize ||
    hasLegalWithoutParagraphSetup ||
    legalFramesWithWidthAutoSize.length > 0 ||
    legalFramesWithoutHyphenation.length > 0 ||
    legalFramesWithoutRussianLanguage.length > 0 ||
    framesWithoutAutosize.length > 0 ||
    invalidVariables.length > 0 ||
    invalidTypeOrDotVariables.length > 0 ||
    disallowedBranchVariables.length > 0 ||
    disallowedCompanyVariables.length > 0 ||
    disallowedCountryVariables.length > 0 ||
    multipleDotsVariables.length > 0 ||
    unknownSystemVariables.length > 0 ||
    variablesOnHiddenLayers.length > 0 ||
    missingLinks.length > 0 ||
    (REPORT_LINKS_NOT_IN_FOLDER && notInLinksFolder.length > 0) ||
    hasWrongLinks ||
    websiteVariablesFound.length > 0 ||
    qrNameMistakes.length > 0 ||
    linkVariableWithoutLinkErrors.length > 0 ||
    missingSwatchErrors.length > 0 ||
    missingFontsFound ||
    repeatedWordsFound.length > 0 ||
    leftoverAnglePlaceholders.length > 0 ||
    mixedBlackFound
) {
    //report = "⚠ Файл не готов к Терминалу!\n\n";
    if (mixedBlackReport) {
        errorReport += mixedBlackReport;
    }
    
    if (bleedWarning) {
        errorReport += "⚠ Отсутствуют блиды\n\n";
    }

    if (repeatedWordsFound.length > 0) {
        errorReport += "⚠ Найдены повторяющиеся слова или фразы:\n";
        for (var i = 0; i < repeatedWordsFound.length; i++) {
            errorReport += "   • " + repeatedWordsFound[i] + "\n";
        }
        errorReport += "\n";
    }

    if (qrNameMistakes.length > 0) {
        errorReport += "⚠ Обнаружены объекты, похожие на переменные Терминала, но без поддерживаемого хэштега #qr или #link:\n";
        for (var i = 0; i < qrNameMistakes.length; i++) {
            var name = qrNameMistakes[i];
            errorReport += "   • Кажется, в макете есть объект с названием «" + name + "», но в нем нет хэштега #qr или #link\n";
        }
        errorReport += "\n";
    }

    if (linkVariableWithoutLinkErrors.length > 0) {
        errorReport += "⚠ Обнаружены link-переменные без привязанного файла:\n";
        for (var i = 0; i < linkVariableWithoutLinkErrors.length; i++) {
            errorReport += "   • Для объекта «" + linkVariableWithoutLinkErrors[i] + "» нужен размещенный файл-линк\n";
        }
        errorReport += "\n";
    }

    if (missingSwatchErrors.length > 0) {
        errorReport += "⚠ Обнаружены QR-объекты, для которых отсутствуют одноименные свотчи:\n";
        for(var i = 0; i < missingSwatchErrors.length; i++) {
            var objName = missingSwatchErrors[i];
            var swatchName = objName.slice(1, -1);
            errorReport += "   • Для объекта «" + objName + "» не найден свотч с именем «" + swatchName + "»\n";
        }
        errorReport += "\n";
    }

    if (variablesOnHiddenLayers.length > 0) {
        errorReport += "⚠ На скрытых слоях или в скрытых группах найдены переменные, которые лучше удалить:\n";
        for (var i = 0; i < variablesOnHiddenLayers.length; i++) {
            errorReport += "   • " + variablesOnHiddenLayers[i] + "\n";
        }
        errorReport += "\n";
    }

    if (problematicFontsFound) {
        errorReport += "⚠ В макете используются проблемные шрифты:\n";
        for (var font in problematicFonts) {
            if (problematicFonts[font]) {
                errorReport += "   • " + font + " - замените этот шрифт\n";
            }
        }
        errorReport += "\n";
    }

    if (missingFontsFound) {
        errorReport += "⚠ В макете отсутствуют шрифты. Установите их или замените:\n";
        for (var fontName in missingFontsData) {
            if (missingFontsData.hasOwnProperty(fontName)) {
                var snippets = missingFontsData[fontName];
                if (snippets.length > 0) {
                    errorReport += "   • " + fontName + "\n";
                    for (var i = 0; i < snippets.length; i++) {
                        errorReport += "     - " + snippets[i] + "\n";
                    }
                }
            }
        }
        errorReport += "\n";
    }

    // Лигал — один блок в конце отчёта, не отдельные ⚠.

    if (framesWithoutAutosize.length > 0) {
        var uniqueVariables = {};
        for (var i = 0; i < framesWithoutAutosize.length; i++) {
            uniqueVariables[framesWithoutAutosize[i]] = true;
        }
        for (var variable in uniqueVariables) {
            errorReport += "⚠ У блока с переменной " + variable + " нет авто-сайза\n";
        }
    }

    var badVarNames = [];
    addUniqueNames(badVarNames, invalidTypeOrDotVariables);
    addUniqueNames(badVarNames, invalidVariables);
    addUniqueNames(badVarNames, multipleDotsVariables);
    addUniqueNames(badVarNames, disallowedBranchVariables);
    addUniqueNames(badVarNames, disallowedCompanyVariables);
    addUniqueNames(badVarNames, disallowedCountryVariables);
    addUniqueNames(badVarNames, unknownSystemVariables);
    if (badVarNames.length > 0) {
        errorReport += "Недопустимые переменные\n";
        for (var bv = 0; bv < badVarNames.length; bv++) {
            errorReport += "⚠ " + badVarNames[bv] + "\n";
        }
        errorReport += "\n";
    }
    if (websiteVariablesFound.length > 0) {
        var uniqueWebsites = {};
        for (var i = 0; i < websiteVariablesFound.length; i++) {
            uniqueWebsites[websiteVariablesFound[i]] = true;
        }
        var uniqueWebsiteKeys = [];
        for (var key in uniqueWebsites) {
            if (uniqueWebsites.hasOwnProperty(key)) {
                uniqueWebsiteKeys.push(key);
            }
        }
        errorReport += "⚠ Обнаружены переменные, содержащие 'website'. Сайт Додо Пиццы должен задаваться через системную переменную [country.mainWebsite].\n";
        errorReport += "   Найденные переменные: " + uniqueWebsiteKeys.join(", ") + "\n\n";
    }
    if (ppiReport) {
        errorReport += ppiReport + "\n";
    }
}

// Лог: автозамены и то, что скрипт уже сделал. Ошибки — выше.
if (ogrnStateNumberLongCount > 0 || ogrnStateNumberCount > 0 || stateNumberCount > 0) {
    logReport += "✓ Произведена замена на [company.stateNumberLong]\n";
}

if (angleCompanyReplaceCount > 0) {
    logReport += "✓ Плейсхолдеры <COMPANY_*> заменены на [company.name] / [company.stateNumber] / [company.legalAddress] (" + angleCompanyReplaceCount + ")\n";
}
if (leftoverAnglePlaceholders.length > 0) {
    errorReport += "⚠ В тексте остались угловые плейсхолдеры — ферма их не подставит: " + leftoverAnglePlaceholders.join(", ") + "\n\n";
}
if (websiteReplaced) {
    logReport += "✓ Сайт dodopizza.ru заменен на переменную [country.mainWebsite]\n";
}
if (websiteSpacingFixed > 0) {
    logReport += "✓ Исправлены пробелы в адресах сайтов:\n";
    for (var i = 0; i < websiteSpacingFixes.length; i++) {
        logReport += "   " + websiteSpacingFixes[i] + "\n";
    }
}
if (quotesFixed > 0) {
    logReport += "✓ Исправлены " + quotesFixed + " пары кавычек\n";
}
if (innerQuotesFixed > 0) {
    logReport += "✓ Исправлены " + innerQuotesFixed + " внутренние пары кавычек\n";
}
if (dotsFixed > 0) {
    logReport += "✓ Исправлены пробелы и ошибки после точек:\n";
    for (var i = 0; i < dotFixDetails.length; i++) {
        logReport += "   " + dotFixDetails[i].before + " → " + dotFixDetails[i].after;
        if (dotFixDetails[i].count > 1) {
            logReport += " (" + dotFixDetails[i].count + ")";
        }
        logReport += "\n";
    }
}

if (cutlineLayerFound && !cutlineLayerHasObjects) {
    errorReport += "⚠ В слое cutline нет объектов\n";
} else if (hasOverprintFixed) {
    logReport += "✓ Включен Overprint stroke для объектов в слое cutline\n";
}

var legalBullets = [];
if (hasLegalWithoutAutosize) {
    legalBullets.push("не включен авто-сайз");
}
if (legalFramesWithWidthAutoSize.length > 0) {
    legalBullets.push("авто-сайз только по ширине");
}
if (hasLegalWithoutParagraphSetup) {
    legalBullets.push("без LegalParagraphSetup");
} else {
    if (legalFramesWithoutHyphenation.length > 0) {
        legalBullets.push("не включены переносы");
    }
    if (legalFramesWithoutRussianLanguage.length > 0) {
        legalBullets.push("язык не русский");
    }
}
if (possibleLegalNoAutoSize.length > 0) {
    legalBullets.push("похоже ещё лигалы без авто-сайза");
}
if (possibleLegalWidthAutoSize.length > 0) {
    legalBullets.push("похоже ещё лигалы с авто-сайзом только по ширине");
}
if (legalBullets.length > 0) {
    errorReport += "Лигал\n";
    for (var lb = 0; lb < legalBullets.length; lb++) {
        errorReport += "⚠ " + legalBullets[lb] + "\n";
    }
    errorReport += "\n";
}

var variablesWithoutBrackets = checkVariablesWithoutBrackets(doc);
if (variablesWithoutBrackets.length > 0) {
    errorReport += "⚠ Найдены переменные без квадратных скобок: " + variablesWithoutBrackets.join(", ") + "\n\n";
}

if (systemVariablesFixedCount > 0) {
    logReport += "✓ Исправлены ошибки в системных переменных:\n" + fixedSystemVariablesReport;
}

if (pasteboardExpandInfo && pasteboardExpandInfo.error) {
    errorReport += "⚠ Не удалось расширить pasteboard для #link: " + pasteboardExpandInfo.error + "\n\n";
} else if (pasteboardExpandInfo && pasteboardExpandInfo.changed) {
    logReport += "✓ Есть #link — pasteboard расширен, чтобы ферма смогла подставить картинку (value set)\n";
    logReport += "   " + round1(pasteboardExpandInfo.fromH) + "×" + round1(pasteboardExpandInfo.fromV) +
        " → " + round1(pasteboardExpandInfo.toH) + "×" + round1(pasteboardExpandInfo.toV) + " pt\n";
    var pbDetails = pasteboardExpandInfo.details || [];
    for (var pbi = 0; pbi < pbDetails.length; pbi++) {
        var d = pbDetails[pbi];
        var bits = [];
        if (d.overTop > 0.5) bits.push("верх " + round1(d.overTop) + " pt");
        if (d.overBottom > 0.5) bits.push("низ " + round1(d.overBottom) + " pt");
        if (d.overLeft > 0.5) bits.push("лево " + round1(d.overLeft) + " pt");
        if (d.overRight > 0.5) bits.push("право " + round1(d.overRight) + " pt");
        logReport += "   • " + d.name + ": вылет " + bits.join(", ") + "\n";
    }
    logReport += "   Страница и блид не менялись. Фрейм картинки подрезать не надо.\n";
}

if (isBlankReport(errorReport)) {
    errorReport = "✓ Все ок\n";
}

showReportDialog(errorReport, logReport);


})();
