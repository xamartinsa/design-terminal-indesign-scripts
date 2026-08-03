// CharacterStylesSetup-1.0.jsx
// Описание: Создаёт или обновляет символьные стили Auto/Hide, Auto/No Break и Auto/Break,
// а также добавляет GREP-стиль в [Basic Paragraph] для скрытия текста в [скобках].
// Префикс Auto/ — аналог [Auto]; квадратные скобки в именах стилей InDesign запрещены.

(function () {
    if (app.documents.length === 0) {
        alert("Нет открытых документов. Пожалуйста, откройте документ и попробуйте снова.");
        return;
    }

    var doc = app.activeDocument;
    var messages = [];
    var errors = [];
    var STYLE_PREFIX = "Auto/";

    function autoStyleName(shortName) {
        return STYLE_PREFIX + shortName;
    }

    function getNoneSwatch() {
        var names = ["[None]", "None"];
        for (var i = 0; i < names.length; i++) {
            var swatch = doc.swatches.itemByName(names[i]);
            if (swatch.isValid) {
                return swatch;
            }
        }
        return NothingEnum.NOTHING;
    }

    function ensureCharacterStyle(styleName, applySettings) {
        var style = doc.characterStyles.itemByName(styleName);
        var created = false;

        if (!style.isValid) {
            style = doc.characterStyles.add({ name: styleName });
            created = true;
        }

        try {
            applySettings(style);
            messages.push((created ? "Создан" : "Обновлён") + " символьный стиль '" + styleName + "'.");
        } catch (e) {
            errors.push("Стиль '" + styleName + "': " + e.message);
        }

        return style;
    }

    var hideStyleName = autoStyleName("Hide");
    var noBreakStyleName = autoStyleName("No Break");
    var breakStyleName = autoStyleName("Break");

    var hideStyle = ensureCharacterStyle(hideStyleName, function (style) {
        style.horizontalScale = 1;
        style.verticalScale = 1;
        style.fillColor = getNoneSwatch();
    });

    ensureCharacterStyle(noBreakStyleName, function (style) {
        style.noBreak = true;
    });

    ensureCharacterStyle(breakStyleName, function (style) {
        style.noBreak = false;
    });

    var basicParagraphStyleName = "[Basic Paragraph]";
    var paraStyle = doc.paragraphStyles.itemByName(basicParagraphStyleName);

    if (!paraStyle.isValid) {
        errors.push("Стиль абзаца '" + basicParagraphStyleName + "' не найден.");
    } else if (!(paraStyle instanceof ParagraphStyle)) {
        errors.push("Объект '" + basicParagraphStyleName + "' не является стилем абзаца.");
    } else if (!hideStyle || !hideStyle.isValid) {
        errors.push("Символьный стиль '" + hideStyleName + "' недоступен — GREP не добавлен.");
    } else {
        // Содержимое между [ и ближайшей ] (без самих скобок)
        var hideGrepExpression = "(?<=\\[)[^\\]]*(?=\\])";
        var grepAdded = false;
        var grepExists = false;

        try {
            if (!(paraStyle.nestedGrepStyles && typeof paraStyle.nestedGrepStyles.add === "function")) {
                errors.push("Свойство nestedGrepStyles недоступно у '" + basicParagraphStyleName + "'.");
            } else {
                for (var i = 0; i < paraStyle.nestedGrepStyles.length; i++) {
                    if (paraStyle.nestedGrepStyles[i].grepExpression === hideGrepExpression &&
                        paraStyle.nestedGrepStyles[i].appliedCharacterStyle.id === hideStyle.id) {
                        grepExists = true;
                        break;
                    }
                }

                if (!grepExists) {
                    paraStyle.nestedGrepStyles.add({
                        appliedCharacterStyle: hideStyle,
                        grepExpression: hideGrepExpression
                    });
                    grepAdded = true;
                }
            }
        } catch (e) {
            errors.push("GREP для '" + basicParagraphStyleName + "': " + e.message);
        }

        if (grepExists) {
            messages.push("GREP-стиль '" + hideStyleName + "' для […] уже есть в '" + basicParagraphStyleName + "'.");
        } else if (grepAdded) {
            messages.push("GREP-стиль '" + hideStyleName + "' для […] добавлен в '" + basicParagraphStyleName + "'.");
        }
    }

    var finalMessage = "";
    if (messages.length > 0) {
        finalMessage += messages.join("\n");
    }
    if (errors.length > 0) {
        finalMessage += (finalMessage ? "\n\n" : "") + "Ошибки:\n" + errors.join("\n");
    }

    alert(finalMessage || "Не было выполнено никаких действий.");
})();
