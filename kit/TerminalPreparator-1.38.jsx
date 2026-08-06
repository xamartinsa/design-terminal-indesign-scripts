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

// Функция для определения минимального PPI по площади
function getMinPPI(area) {
    if (area <= 62370) return 300;
    if (area <= 124740) return 256;
    if (area <= 249480) return 182;
    if (area <= 499554) return 129;
    if (area <= 999949) return 92;
    return 65; // для площадей больше 999949
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

app.findGrepPreferences = NothingEnum.nothing;
app.findGrepPreferences.findWhat = "\\[.*?\\]";

var found = doc.findGrep();
for (var i = 0; i < found.length; i++) {
    var textFrame = found[i].parentTextFrames[0];
    if (textFrame) {
        var variableName = found[i].contents;
        var frameText = textFrame.contents;
        var isLegalFrame = frameText.match(/\[company\.(name|stateNumberLong|stateNumber|legalAddress)\]/);
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

// Определяем необходимый PPI для макета по площади
var docWidth = doc.documentPreferences.pageWidth;
var docHeight = doc.documentPreferences.pageHeight;
var docArea = Math.round(docWidth * docHeight);
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
var allowedPrefixes = ["country.", "company.", "branch.", "pack.", "layout."];
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
            } else if (linksFolderDiag && imageFolder !== linksFolderDiag) {
                $.writeln("⚠ Не в папке Links (" + imageFolder + ")");
            }
            if (imageFolder !== linksFolder) {
                notInLinksFolder.push(link.name + ' (' + imageFolder + ')');
            }
            usedLinkNames[link.name] = true;
        } catch(e) {
            notInLinksFolder.push(link.name + ' (ошибка: ' + e + ')');
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
var allowedPrefixes = ["country.", "company.", "branch.", "pack.", "layout."];
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
            qrErrorMap[objName].push("⚠ Имя объекта QR-кода должно быть только типа country, company, branch, pack или layout и содержать точку: " + objName);
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

// --- ДОБАВЛЕНО: Явные предупреждения по линкам и папке Links ---
if (missingLinks.length > 0) {
    report += "⚠ В макете есть слетевшие или отсутствующие линки:\n";
    for (var i = 0; i < missingLinks.length; i++) {
        report += "   • " + missingLinks[i] + "\n";
    }
    report += "\n";
}

if (notInLinksFolder.length > 0) {
    report += "⚠ Обнаружены изображения не из папки Links (или её подпапок):\n";
    for (var i = 0; i < notInLinksFolder.length; i++) {
        report += "   • " + notInLinksFolder[i] + "\n";
    }
    if (normalizedLinksFolder) {
        report += "\nОжидаемая папка Links: " + normalizedLinksFolder + "\n";
    }
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
    notInLinksFolder.length > 0 ||
    hasWrongLinks ||
    websiteVariablesFound.length > 0 ||
    qrNameMistakes.length > 0 ||
    linkVariableWithoutLinkErrors.length > 0 ||
    missingSwatchErrors.length > 0 ||
    missingFontsFound ||
    repeatedWordsFound.length > 0
) {
    //report = "⚠ Файл не готов к Терминалу!\n\n";
    
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
        report += "⚠ Переменная должна быть только типа country, company, branch, pack или layout и дальше должна быть точка. Тут ошибка: " + invalidTypeOrDotVariables.join(", ") + "\n\n";
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
        report += "⚠ В переменной может быть только одна точка, разделяющая тип и название. У вас найдена ошибка: " + multipleDotsVariables.join(", ") + ". Переменная должна начинаться с одного из типов: country., company., branch., pack. или layout.\n\n";
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
if (websiteReplaced) {
    report += "\n✓ Сайт dodopizza.ru заменен на переменную [country.mainWebsite]\n";
}
if (websiteSpacingFixed > 0) {
    report += "✓ Исправлены пробелы в адресах сайтов:\n";
    for (var i = 0; i < websiteSpacingFixes.length; i++) {
        report += "   " + websiteSpacingFixes[i] + "\n";
    }
}
if (legalFramesCheckedCount > 0 && legalFramesWithoutHyphenation.length === 0) {
    report += "✓ Переносы в лигале проверены и включены\n";
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

alert(report);

