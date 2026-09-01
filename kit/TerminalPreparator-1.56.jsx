#targetengine "TerminalPreparatorUI"

var doc = app.activeDocument;

// --- СНЯТИЕ ЗАМКОВ СО ВСЕХ ОБЪЕКТОВ И СЛОЕВ ---
// Снимаем замки со всех слоев
for (var i = 0; i < doc.layers.length; i++) {
    doc.layers[i].locked = false;
}

// Снимаем замки со всех объектов на страницах
for (var i = 0; i < doc.pages.length; i++) {
    var pageItems = doc.pages[i].allPageItems;
    for (var j = 0; j < pageItems.length; j++) {
        try {
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
var bleedWarning = !hasBleed && !isWebDocument;
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

var isWebPixelDocument = isWebDocument && isPixelDocument(doc);

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
        var isLegalFrame = frameText.match(/\[company\.(name|stateNumberLong|stateNumber|legalAddress)\]/) ||
            frameText.match(/<COMPANY_(NAME|STATE_NUMBER|LEGAL_ADDRESS)>/i);
        var isHidden = isAnyParentHidden(textFrame);

        if (isLegalFrame) {
            if (!isHidden) {
                checkLegalTypography(textFrame);

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
                // Новая эвристика: если фрейм длинный, возможно это лигал
                if (frameText.length > 40) {
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

// Функция проверки изображений на странице
function checkImagesOnPage(page, pageName) {
    // Перебираем все объекты на странице
    for (var j = 0; j < page.allPageItems.length; j++) {
        var item = page.allPageItems[j];
        
        try {
            // Проверяем есть ли у объекта ссылка
            if (item.itemLink) {
                var link = item.itemLink;
                var linkName = link.name;
                var fileSize = link.size / 1048576; // Переводим в МБ
                var fileSizeFormatted = Math.round(fileSize * 100) / 100; // Округляем до 2 знаков
                var hasWarning = false;
                var warningText = "";

                // Проверяем PPI для всех изображений
                if (item.effectivePpi) {
                    var firstPPI = Math.round(item.effectivePpi[0]); // Берем только первое число и округляем
                    
                    // Рассчитываем 15% допуск
                    var tolerance = requiredPPI * 0.15;
                    var upperLimit = requiredPPI + tolerance;
                    var lowerLimit = requiredPPI - tolerance;

                    // Проверяем PPI с учетом допуска.
                    // Для web-макетов в пикселях высокий PPI не является печатной проблемой.
                    if (!isWebPixelDocument && firstPPI > upperLimit) {
                        // Для высокого PPI добавляем проверку на вес файла
                        if (fileSize > 7) {
                        hasPPIWarning = true;
                        hasWarning = true;
                            warningText += "⚠ слишком высокий PPI: " + firstPPI + " (требуется: " + requiredPPI + "), вес файла: " + fileSizeFormatted + " МБ\n";
                        }
                    } else if (firstPPI < lowerLimit) {
                        hasPPIWarning = true;
                        hasWarning = true;
                        if (isWebPixelDocument) {
                            warningText += "⚠ слишком низкий PPI для web-макета: " + firstPPI + " (требуется экранный: " + requiredPPI + ")\n";
                        } else {
                            warningText += "⚠ слишком низкий PPI: " + firstPPI + " (требуется: " + requiredPPI + ")\n";
                        }
                    }
                }

                // Проверяем размер файла для всех типов ссылок
                if (fileSize > 18) {
                    hasFileSizeWarning = true;
                    hasWarning = true;
                    
                    // Проверяем формат файла
                    var fileFormat = linkName.toLowerCase();
                    if (fileFormat.indexOf('.pdf') !== -1) {
                        warningText += "⚠ слишком большой размер: " + fileSizeFormatted + " МБ. Файл в формате PDF, пересохраните в JPG\n";
                    } else if (fileFormat.indexOf('.png') !== -1) {
                        warningText += "⚠ слишком большой размер: " + fileSizeFormatted + " МБ. Файл в формате PNG, пересохраните в JPG\n";
                    } else if (fileFormat.indexOf('.jpg') === -1 && fileFormat.indexOf('.jpeg') === -1) {
                        warningText += "⚠ слишком большой размер: " + fileSizeFormatted + " МБ. Файл не в формате JPG, возможно это причина большого веса. Пересохраните в JPG\n";
                    } else {
                        warningText += "⚠ слишком большой размер: " + fileSizeFormatted + " МБ (максимум: 18 МБ)\n";
                    }
                }

                // Добавляем в отчет только если есть предупреждения
                if (hasWarning) {
                    ppiReport += linkName + "\n" + warningText + "\n";
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
    // Проверка на допустимый префикс и наличие точки
    var hasAllowedPrefix = false;
    var isSystemPrefix = false;
    for (var p = 0; p < allowedPrefixes.length; p++) {
        if (inner.indexOf(allowedPrefixes[p]) === 0) {
            hasAllowedPrefix = true;
            break;
        }
    }
    for (var sp = 0; sp < systemPrefixes.length; sp++) {
        if (inner.indexOf(systemPrefixes[sp]) === 0) {
            isSystemPrefix = true;
            break;
        }
    }
    if (!hasAllowedPrefix || inner.indexOf(".") === -1) {
        invalidTypeOrDotVariables.push(varText);
    }

    // Новая проверка: если это системная переменная, проверяем ее по полному списку
    if (isSystemPrefix && !allSystemVariables[inner]) {
        var innerLower = inner.toLowerCase();
        var suggestion = null;

        // Строгая валидация для company.*
        if (inner.indexOf("company.") === 0) {
            // Популярные опечатки сначала
            if (typoMap[innerLower]) {
                suggestion = typoMap[innerLower];
            } else {
                var canonical = allowedCompanyByLower[innerLower];
                if (canonical) {
                    // Отличается только регистр — нормализуем
                    suggestion = canonical;
                } else {
                    // Любая другая company.* — запрещена
                    disallowedCompanyVariables.push(varText);
                }
            }
        } else if (inner.indexOf("branch.") === 0) {
            var canonicalBranch = allowedBranchByLower[innerLower];
            if (canonicalBranch) {
                suggestion = canonicalBranch;
            } else {
                disallowedBranchVariables.push(varText);
            }
        } else if (inner.indexOf("country.") === 0) {
            var canonicalCountry = allowedCountryByLower[innerLower];
            if (canonicalCountry) {
                suggestion = canonicalCountry;
            } else {
                disallowedCountryVariables.push(varText);
            }
        } else {
            // Для прочих системных префиксов — прежняя логика: опечатки/регистры/unknown
            if (typoMap[innerLower]) {
                suggestion = typoMap[innerLower];
            } else {
                for (var k = 0; k < requiredBracketsVariables.length; k++) {
                    if (innerLower === requiredBracketsVariables[k].toLowerCase()) {
                        suggestion = requiredBracketsVariables[k];
                        break;
                    }
                }
            }
            if (!suggestion) {
                unknownSystemVariables.push(varText);
            }
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
    var s = String(text);
    return s.indexOf("\u26a0") === -1 && s.indexOf("\u0412\u0441\u0435 \u043e\u043a") !== -1;
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

    function spawnRocket() {
        rockets.push({
            x: fwRnd(4, cols - 5),
            y: rows - 1,
            vy: fwRnd(-0.58, -0.34),
            peak: fwRnd(2, rows * 0.4)
        });
    }

    function explode(x, y) {
        var n = 18 + Math.floor(Math.random() * 16);
        var i, a, sp;
        for (i = 0; i < n; i++) {
            a = (i / n) * Math.PI * 2 + fwRnd(-0.25, 0.25);
            sp = fwRnd(0.3, 0.78);
            sparks.push({
                x: x,
                y: y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp * 0.6,
                life: 12 + Math.floor(fwRnd(0, 10)),
                maxLife: 22
            });
        }
        for (i = 0; i < 10; i++) {
            a = fwRnd(0, Math.PI * 2);
            sp = fwRnd(0.06, 0.24);
            sparks.push({
                x: x,
                y: y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                life: 6 + Math.floor(fwRnd(0, 6)),
                maxLife: 12
            });
        }
    }

    function plot(grid, x, y, ch, pri) {
        var xi = Math.floor(x + 0.5);
        var yi = Math.floor(y + 0.5);
        if (xi < 0 || yi < 0 || xi >= cols || yi >= rows) return;
        if (pri >= grid[yi][xi].p) {
            grid[yi][xi].c = ch;
            grid[yi][xi].p = pri;
        }
    }

    function step() {
        var i, r, s, y, x, grid, lines, row, t, ch, pri;
        tick++;
        if (tick === 1 || tick % 6 === 0) {
            if (rockets.length < 3) spawnRocket();
        }

        for (i = rockets.length - 1; i >= 0; i--) {
            r = rockets[i];
            r.y += r.vy;
            r.vy += 0.007;
            if (r.y <= r.peak || r.vy >= -0.03) {
                explode(r.x, r.y);
                rockets.splice(i, 1);
            }
        }

        for (i = sparks.length - 1; i >= 0; i--) {
            s = sparks[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.048;
            s.vx *= 0.985;
            s.life--;
            if (s.life <= 0 || s.y >= rows) sparks.splice(i, 1);
        }

        grid = [];
        for (y = 0; y < rows; y++) {
            grid[y] = [];
            for (x = 0; x < cols; x++) {
                grid[y][x] = { c: " ", p: 0 };
            }
        }

        for (i = 0; i < rockets.length; i++) {
            r = rockets[i];
            plot(grid, r.x, r.y, "^", 4);
            plot(grid, r.x, r.y + 1, "|", 3);
            plot(grid, r.x, r.y + 2, ":", 2);
            plot(grid, r.x, r.y + 3, ".", 1);
        }

        for (i = 0; i < sparks.length; i++) {
            s = sparks[i];
            t = s.life / (s.maxLife || 18);
            ch = ".";
            pri = 1;
            if (t > 0.78) { ch = "@"; pri = 5; }
            else if (t > 0.55) { ch = "*"; pri = 4; }
            else if (t > 0.35) { ch = "+"; pri = 3; }
            else if (t > 0.18) { ch = ":"; pri = 2; }
            plot(grid, s.x, s.y, ch, pri);
        }

        lines = [];
        for (y = 0; y < rows; y++) {
            row = "";
            for (x = 0; x < cols; x++) row += grid[y][x].c;
            lines.push(row);
        }
        return lines.join("\n");
    }

    return { step: step };
}

function showAllOkDanceDialog(reportText) {
    stopPrepDance();

    var boxW = 340;
    try {
        if (typeof $.screens !== "undefined" && $.screens && $.screens.length > 0) {
            var scrW = $.screens[0].right - $.screens[0].left;
            if (scrW > 0) boxW = Math.min(360, Math.max(300, Math.floor(scrW * 0.22)));
        }
    } catch (eScr) {}

    var side = 300;
    var fwCols = 42;
    var fwRows = 24;
    var sim = createFireworksSim(fwCols, fwRows);

    var w = new Window("palette", "Terminal Preparator");
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.margins = 12;
    w.spacing = 8;

    var et = w.add("statictext", undefined, reportText, {multiline: true});
    et.preferredSize = [Math.max(boxW, side), 72];
    et.alignment = ["fill", "top"];

    var canvas = w.add("group");
    canvas.alignment = ["center", "bottom"];
    canvas.preferredSize = [side, side];
    canvas.minimumSize = [side, side];
    canvas.maximumSize = [side, side];
    canvas.fwFrame = sim.step();
    canvas.onDraw = function () {
        var g = this.graphics;
        var ww = this.size.width;
        var hh = this.size.height;
        g.newPath();
        g.rectPath(0, 0, ww, hh);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.07, 0.07, 0.09]));
        try {
            g.font = ScriptUI.newFont("Courier New", "REGULAR", 9);
        } catch (eFont) {}
        var pen = g.newPen(g.PenType.SOLID_COLOR, [1, 0.78, 0.28], 1);
        var lines = String(this.fwFrame || "").split("\n");
        var i;
        var lh = 11;
        for (i = 0; i < lines.length; i++) {
            g.drawString(lines[i], pen, 6, 6 + i * lh);
        }
    };

    var row = w.add("group");
    row.alignment = ["right", "bottom"];
    var okBtn = row.add("button", undefined, "OK", {name: "ok"});
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
        sleep: 90
    });
    task.addEventListener("onIdle", function () {
        try {
            if (!w.visible) {
                stopPrepDance();
                return;
            }
            canvas.fwFrame = sim.step();
            try {
                canvas.notify("onDraw");
            } catch (eN) {
                canvas.visible = false;
                canvas.visible = true;
            }
        } catch (eTick) {
            stopPrepDance();
        }
    });

    w.center();
    w.show();
}

function showReportDialog(reportText) {
    persistPrepReport(reportText);
    stopPrepDance();
    if (isSilentPreparatorRun()) {
        try { $.writeln(reportText); } catch (eLog) {}
        return;
    }
    if (reportIsAllOk(reportText)) {
        try {
            showAllOkDanceDialog(reportText);
            return;
        } catch (eDance) {
            stopPrepDance();
        }
    }
    try {
        var w = new Window("dialog", "Terminal Preparator");
        w.orientation = "column";
        w.alignChildren = ["fill", "fill"];
        w.margins = 12;
        w.spacing = 8;

        // 1.47: уже и ниже, высота по числу строк.
        // 1.48: короткий отчёт — statictext (без скроллбара).
        // 1.49: ещё уже, чтобы окно было скорее вертикальным.

        var lineCount = 1;
        try {
            lineCount = String(reportText).split("\n").length;
        } catch (eLc) {}

        var lineH = 18;
        var padH = 28;
        var boxW = 340;
        var maxH = 420;
        try {
            if (typeof $.screens !== "undefined" && $.screens && $.screens.length > 0) {
                var scr = $.screens[0];
                var scrH = scr.bottom - scr.top;
                var scrW = scr.right - scr.left;
                if (scrW > 0) boxW = Math.min(360, Math.max(300, Math.floor(scrW * 0.22)));
                if (scrH > 0) maxH = Math.min(420, Math.floor(scrH * 0.42));
            }
        } catch (eScr) {}

        var visualLines = lineCount;
        try {
            var charsPerLine = Math.max(28, Math.floor(boxW / 7));
            var rawLines = String(reportText).split("\n");
            visualLines = 0;
            for (var li = 0; li < rawLines.length; li++) {
                var lineLen = rawLines[li].length;
                visualLines += lineLen <= 0 ? 1 : Math.max(1, Math.ceil(lineLen / charsPerLine));
            }
        } catch (eVl) {
            visualLines = lineCount;
        }
        var neededH = padH + visualLines * lineH;

        var needsScroll = neededH > maxH;
        var boxH = needsScroll ? maxH : Math.max(90, neededH);

        // Win ScriptUI: у multiline edittext скроллбар часто есть всегда.
        // Короткий отчёт — statictext (без полосы). Простыня — edittext со скроллом.
        var et;
        if (needsScroll) {
            et = w.add("edittext", undefined, reportText, {
                multiline: true,
                readonly: true,
                scrolling: true
            });
        } else {
            et = w.add("statictext", undefined, reportText, {multiline: true});
        }
        et.preferredSize = [boxW, boxH];
        et.minimumSize = [Math.min(360, boxW), needsScroll ? 80 : boxH];
        et.alignment = ["fill", "top"];

        var row = w.add("group");
        row.alignment = ["right", "bottom"];
        row.add("button", undefined, "OK", {name: "ok"});

        w.center();
        w.show();
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

// 3. Формируем предупреждения
var report = "";

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
            report += "QR-код " + qrName + "\n";
            for (var j = 0; j < errors.length; j++) {
                report += errors[j] + "\n";
            }
            report += "\n";
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
    report += "⚠ В макете есть слетевшие или отсутствующие линки:\n";
    for (var i = 0; i < missingLinks.length; i++) {
        report += "   • " + missingLinks[i] + "\n";
    }
    report += "\n";
}

if (REPORT_LINKS_NOT_IN_FOLDER && notInLinksFolder.length > 0) {
    report += formatNotInLinksReport(notInLinksFolder, normalizedLinksFolder, 5);
    report += "\n";
}

if (comparisonDetails.length > 0) {
    report += '\nПроверка каждой картинки относительно папки Links:\n';
    for (var i = 0; i < comparisonDetails.length; i++) {
        report += '   ' + comparisonDetails[i] + '\n';
    }
}

if (
    hasPPIWarning ||
    hasFileSizeWarning ||
    bleedWarning ||
    problematicFontsFound ||
    hasLegalWithoutAutosize ||
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
    systemVariablesFixedCount > 0 ||
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
        report += mixedBlackReport;
    }
    
    if (bleedWarning) {
        report += "⚠ Отсутствуют блиды! Добавьте, если это не ценники или наклейка\n\n";
    }

    if (systemVariablesFixedCount > 0) {
        report += "⚠ Найдены и исправлены опечатки в системных переменных:\n" + fixedSystemVariablesReport + "\n";
    }

    if (repeatedWordsFound.length > 0) {
        report += "⚠ Найдены повторяющиеся слова или фразы:\n";
        for (var i = 0; i < repeatedWordsFound.length; i++) {
            report += "   • " + repeatedWordsFound[i] + "\n";
        }
        report += "\n";
    }

    if (qrNameMistakes.length > 0) {
        report += "⚠ Обнаружены объекты, похожие на переменные Терминала, но без поддерживаемого хэштега #qr или #link:\n";
        for (var i = 0; i < qrNameMistakes.length; i++) {
            var name = qrNameMistakes[i];
            report += "   • Кажется, в макете есть объект с названием «" + name + "», но в нем нет хэштега #qr или #link\n";
        }
        report += "\n";
    }

    if (linkVariableWithoutLinkErrors.length > 0) {
        report += "⚠ Обнаружены link-переменные без привязанного файла:\n";
        for (var i = 0; i < linkVariableWithoutLinkErrors.length; i++) {
            report += "   • Для объекта «" + linkVariableWithoutLinkErrors[i] + "» нужен размещенный файл-линк\n";
        }
        report += "\n";
    }

    if (missingSwatchErrors.length > 0) {
        report += "⚠ Обнаружены QR-объекты, для которых отсутствуют одноименные свотчи:\n";
        for(var i = 0; i < missingSwatchErrors.length; i++) {
            var objName = missingSwatchErrors[i];
            var swatchName = objName.slice(1, -1);
            report += "   • Для объекта «" + objName + "» не найден свотч с именем «" + swatchName + "»\n";
        }
        report += "\n";
    }

    if (variablesOnHiddenLayers.length > 0) {
        report += "⚠ На скрытых слоях или в скрытых группах найдены переменные, которые лучше удалить:\n";
        for (var i = 0; i < variablesOnHiddenLayers.length; i++) {
            report += "   • " + variablesOnHiddenLayers[i] + "\n";
        }
        report += "\n";
    }

    if (problematicFontsFound) {
        report += "⚠ В макете используются проблемные шрифты:\n";
        for (var font in problematicFonts) {
            if (problematicFonts[font]) {
                report += "   • " + font + " - замените этот шрифт\n";
            }
        }
        report += "\n";
    }

    if (missingFontsFound) {
        report += "⚠ В макете отсутствуют шрифты. Установите их или замените:\n";
        for (var fontName in missingFontsData) {
            if (missingFontsData.hasOwnProperty(fontName)) {
                var snippets = missingFontsData[fontName];
                if (snippets.length > 0) {
                    report += "   • " + fontName + "\n";
                    for (var i = 0; i < snippets.length; i++) {
                        report += "     - " + snippets[i] + "\n";
                    }
                }
            }
        }
        report += "\n";
    }

    // Выводим сообщения об отсутствии auto-size
    if (hasLegalWithoutAutosize) {
        report += "⚠ У лигала не включен авто-сайз\n\n";
    }

    if (legalFramesWithoutHyphenation.length > 0) {
        report += "⚠ В лигале не включены переносы:\n";
        for (var i = 0; i < legalFramesWithoutHyphenation.length; i++) {
            report += "Фрагмент: «" + legalFramesWithoutHyphenation[i].fragment + "»\n";
        }
        report += "\n";
    }

    if (legalFramesWithoutRussianLanguage.length > 0) {
        report += "⚠ В лигале найден текст не на русском языке:\n";
        for (var i = 0; i < legalFramesWithoutRussianLanguage.length; i++) {
            report += "Фрагмент: «" + legalFramesWithoutRussianLanguage[i].fragment + "»\n";
            report += "Язык сейчас: " + legalFramesWithoutRussianLanguage[i].language + "\n";
        }
        report += "\n";
    }
    
    if (framesWithoutAutosize.length > 0) {
        // Создаем объект для отслеживания уникальных переменных
        var uniqueVariables = {};
        for (var i = 0; i < framesWithoutAutosize.length; i++) {
            uniqueVariables[framesWithoutAutosize[i]] = true;
        }
        
        // Выводим сообщения для каждой уникальной переменной
        for (var variable in uniqueVariables) {
            report += "⚠ У блока с переменной " + variable + " нет авто-сайза\n";
        }
    }

    if (invalidVariables.length > 0) {
        report += "⚠ В названии переменных не поддерживаются пробел, дефис, тире, нижнее подчеркивание, запятые и амперсанд: " + invalidVariables.join(", ") + "\n\n";
    }
    if (invalidTypeOrDotVariables.length > 0) {
        report += "⚠ Переменная должна быть только типа country, company, branch, pack, layout или terminal и дальше должна быть точка. Тут ошибка: " + invalidTypeOrDotVariables.join(", ") + "\n\n";
    }
    if (disallowedBranchVariables.length > 0) {
        report += "⚠ Недопустимые branch.* переменные. Разрешены только: [branch.addressShort], [branch.addressDetailsCity], [branch.addressDetailsStreetTypeDecrease], [branch.addressDetailsStreetTypeName], [branch.addressDetailsStreetName], [branch.addressDetailsHouseNumber], [branch.publicWiFiPassword], [branch.publicWiFiName], [branch.vk], [branch.instagram], [branch.workingTime].\n";
        for (var i = 0; i < disallowedBranchVariables.length; i++) {
            report += "   • " + disallowedBranchVariables[i] + "\n";
        }
        report += "\n";
    }
    if (disallowedCountryVariables.length > 0) {
        report += "⚠ Недопустимые country.* переменные. Разрешены только: [country.currencySign], [country.mainWebsite], [country.phone], [country.hrWebsite], [country.hrPhone].\n";
        for (var i = 0; i < disallowedCountryVariables.length; i++) {
            report += "   • " + disallowedCountryVariables[i] + "\n";
        }
        report += "\n";
    }
    if (disallowedCompanyVariables.length > 0) {
        report += "⚠ Недопустимые company.* переменные. Разрешены только: [company.name], [company.legalAddress], [company.stateNumber], [company.stateNumberLong].\n";
        for (var i = 0; i < disallowedCompanyVariables.length; i++) {
            report += "   • " + disallowedCompanyVariables[i] + "\n";
        }
        report += "\n";
    }
    if (unknownSystemVariables.length > 0) {
        report += "⚠ Обнаружены неизвестные системные переменные (возможно, опечатка): " + unknownSystemVariables.join(", ") + "\n\n";
    }
    if (multipleDotsVariables.length > 0) {
        report += "⚠ В переменной может быть только одна точка, разделяющая тип и название. У вас найдена ошибка: " + multipleDotsVariables.join(", ") + ". Переменная должна начинаться с одного из типов: country., company., branch., pack., layout. или terminal.\n\n";
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
        report += "⚠ Обнаружены переменные, содержащие 'website'. Сайт Додо Пиццы должен задаваться через системную переменную [country.mainWebsite].\n";
        report += "   Найденные переменные: " + uniqueWebsiteKeys.join(", ") + "\n\n";
    }
    if (ppiReport) {
        report += "\n" + ppiReport;
    }
} else {
    report = "✓ Все ок\n\n" + report;
}

// Добавляем информацию о заменах для Беларуси
if (ogrnStateNumberLongCount > 0 || ogrnStateNumberCount > 0 || stateNumberCount > 0) {
    report += "✓ Произведена замена на [company.stateNumberLong]\n";
}

// В САМЫЙ КОНЕЦ: сайт, кавычки и пробелы после точек
if (angleCompanyReplaceCount > 0) {
    report += "\n✓ Плейсхолдеры <COMPANY_*> заменены на [company.name] / [company.stateNumber] / [company.legalAddress] (" + angleCompanyReplaceCount + ")\n";
}
if (leftoverAnglePlaceholders.length > 0) {
    report += "⚠ В тексте остались угловые плейсхолдеры — ферма их не подставит: " + leftoverAnglePlaceholders.join(", ") + "\n\n";
}
if (websiteReplaced) {
    report += "\n✓ Сайт dodopizza.ru заменен на переменную [country.mainWebsite]\n";
}
if (websiteSpacingFixed > 0) {
    report += "✓ Исправлены пробелы в адресах сайтов:\n";
    for (var i = 0; i < websiteSpacingFixes.length; i++) {
        report += "   " + websiteSpacingFixes[i] + "\n";
    }
}
if (quotesFixed > 0) {
    report += "✓ Исправлены " + quotesFixed + " пары кавычек\n";
}
if (innerQuotesFixed > 0) {
    report += "✓ Исправлены " + innerQuotesFixed + " внутренние пары кавычек\n";
}
// Универсальное сообщение про пробелы и ошибки после точек
if (dotsFixed > 0) {
    report += "✓ Исправлены пробелы и ошибки после точек:\n";
    for (var i = 0; i < dotFixDetails.length; i++) {
        report += "   " + dotFixDetails[i].before + " → " + dotFixDetails[i].after;
        if (dotFixDetails[i].count > 1) {
            report += " (" + dotFixDetails[i].count + ")";
        }
        report += "\n";
    }
}

// Добавляем информацию о включении overprint stroke
if (cutlineLayerFound && !cutlineLayerHasObjects) {
    report += "⚠ В слое cutline нет объектов\n";
} else if (hasOverprintFixed) {
    report += "✓ Включен Overprint stroke для объектов в слое cutline\n";
}

if (legalFramesWithWidthAutoSize.length > 0) {
    report += "⚠ У лигала включён авто-сайз только по ширине. Лучше задать ширину вручную, а высоту автосайз — так текст заполнит нужное пространство по вертикали." + "\n\n";
}

if (possibleLegalNoAutoSize.length > 0) {
    report += "⚠ Кажется, я нашёл лигалы в макете, у которых не включён авто-сайз. Проверьте эти блоки:\n";
    var uniquePossibleLegalNoAutoSize = {};
    for (var i = 0; i < possibleLegalNoAutoSize.length; i++) {
        uniquePossibleLegalNoAutoSize[possibleLegalNoAutoSize[i]] = true;
    }
    for (var text in uniquePossibleLegalNoAutoSize) {
        report += "   • «" + text.replace(/\s+/g, ' ').substring(0, 70) + "...»\n";
    }
    report += "\n";
}
if (possibleLegalWidthAutoSize.length > 0) {
    report += "⚠ Кажется, я нашёл лигалы в макете, у которых авто-сайз только по ширине. Лучше задать ширину вручную, а высоту автосайз. Проверьте эти блоки:\n";
    var uniquePossibleLegalWidthAutoSize = {};
    for (var i = 0; i < possibleLegalWidthAutoSize.length; i++) {
        uniquePossibleLegalWidthAutoSize[possibleLegalWidthAutoSize[i]] = true;
    }
    for (var text in uniquePossibleLegalWidthAutoSize) {
        report += "   • «" + text.replace(/\s+/g, ' ').substring(0, 70) + "...»\n";
    }
    report += "\n";
}

var variablesWithoutBrackets = checkVariablesWithoutBrackets(doc);
if (variablesWithoutBrackets.length > 0) {
    report += "⚠ Найдены переменные без квадратных скобок: " + variablesWithoutBrackets.join(", ") + "\n\n";
}

if (systemVariablesFixedCount > 0) {
    report += "✓ Исправлены ошибки в системных переменных:\n" + fixedSystemVariablesReport;
}

if (pasteboardExpandInfo && pasteboardExpandInfo.error) {
    report += "⚠ Не удалось расширить pasteboard для #link: " + pasteboardExpandInfo.error + "\n\n";
} else if (pasteboardExpandInfo && pasteboardExpandInfo.changed) {
    report += "✓ Есть #link — pasteboard расширен, чтобы ферма смогла подставить картинку (value set)\n";
    report += "   " + round1(pasteboardExpandInfo.fromH) + "×" + round1(pasteboardExpandInfo.fromV) +
        " → " + round1(pasteboardExpandInfo.toH) + "×" + round1(pasteboardExpandInfo.toV) + " pt\n";
    var pbDetails = pasteboardExpandInfo.details || [];
    for (var pbi = 0; pbi < pbDetails.length; pbi++) {
        var d = pbDetails[pbi];
        var bits = [];
        if (d.overTop > 0.5) bits.push("верх " + round1(d.overTop) + " pt");
        if (d.overBottom > 0.5) bits.push("низ " + round1(d.overBottom) + " pt");
        if (d.overLeft > 0.5) bits.push("лево " + round1(d.overLeft) + " pt");
        if (d.overRight > 0.5) bits.push("право " + round1(d.overRight) + " pt");
        report += "   • " + d.name + ": вылет " + bits.join(", ") + "\n";
    }
    report += "   Страница и бlid не менялись. Фрейм картинки подрезать не надо.\n";
}

showReportDialog(report);

