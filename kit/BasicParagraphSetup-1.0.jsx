// Terminal/AddGrepStyleToBasicParagraph.jsx
// Описание: Добавляет или обновляет GREP-стиль в стиле абзаца "[Basic Paragraph]",
// который применяет символьный стиль "No Break" к тексту, соответствующему "*.ru".

// Добавляет GREP-стиль и настраивает переносы и выключку для стиля абзаца [Basic Paragraph]

(function() {
    if (app.documents.length === 0) {
        alert("Нет открытых документов. Пожалуйста, откройте документ и попробуйте снова.");
        return;
    }

    var doc = app.activeDocument;
    
    var basicParagraphStyleName = "[Basic Paragraph]";
    var paraStyle = doc.paragraphStyles.itemByName(basicParagraphStyleName);

    if (!paraStyle.isValid) {
        alert("Стиль абзаца с именем '" + basicParagraphStyleName + "' не найден в документе.");
        return;
    }

    if (!(paraStyle instanceof ParagraphStyle)) {
        var objectType = "Неизвестный тип";
        try { objectType = paraStyle.constructor.name; } catch(e){}
        alert("Найденный объект с именем '" + basicParagraphStyleName + "' является '" + objectType + "', а не стилем абзаца. Пожалуйста, убедитесь, что у вас есть стиль абзаца (а не группа стилей) с именем '" + basicParagraphStyleName + "'. Скрипт не может продолжить.");
        return;
    }

    // --- Определение переменных для GREP-стиля --- 
    var noBreakCharStyleName = "No Break";
    var charStyle = doc.characterStyles.itemByName(noBreakCharStyleName);
    if (!charStyle.isValid) {
        charStyle = doc.characterStyles.add({ name: noBreakCharStyleName });
        charStyle.noBreak = true;
    } else {
        if (charStyle.noBreak !== true) {
            charStyle.noBreak = true;
        }
    }

    var grepExpression = ".\\.[\\l\\u]|\\<[\\l\\u][\\l\\u]\\s|\\<[\\l\\u]\\s|\\s—|\\<[\\l\\u]\\.\\s"; // Заданный GREP-шаблон
    var existingGrepStyle = null; // Для проверки существующего GREP-стиля

    // --- Установка настроек переноса для стиля абзаца ---
    var settingsApplied = [];
    var settingsFailed = [];

    function setStyleProperty(propName, value, section) {
        try {
            paraStyle[propName] = value;
            settingsApplied.push("[" + section + "] " + propName + " = " + value);
        } catch (e) {
            settingsFailed.push("[" + section + "] " + propName + ": " + e.message);
        }
    }

    // Переносы (hyphenation на Basic не включаем — лигал чинит LegalParagraphSetup)
    // setStyleProperty("hyphenation", true, "Переносы");
    setStyleProperty("hyphenateWordsLongerThan", 6, "Переносы");
    setStyleProperty("hyphenateAfterFirst", 3, "Переносы");
    setStyleProperty("hyphenateBeforeLast", 3, "Переносы");

    // --- Установка настроек выключки (Justification) ---
    setStyleProperty("minimumWordSpacing", 90, "Выключка");
    setStyleProperty("desiredWordSpacing", 100, "Выключка");
    setStyleProperty("maximumWordSpacing", 110, "Выключка");
    setStyleProperty("minimumLetterSpacing", -10, "Выключка");
    setStyleProperty("desiredLetterSpacing", 0, "Выключка");
    setStyleProperty("maximumLetterSpacing", 10, "Выключка");
    setStyleProperty("minimumGlyphScaling", 90, "Выключка");
    setStyleProperty("desiredGlyphScaling", 100, "Выключка");
    setStyleProperty("maximumGlyphScaling", 110, "Выключка");

    // --- Применение GREP-стиля ---
    var grepStyleApplied = false;
    var grepStyleExisted = false;
    var grepError = "";
    try {
        if (!(paraStyle.nestedGrepStyles && typeof paraStyle.nestedGrepStyles.add === 'function')) {
            grepError = "Свойство 'nestedGrepStyles' недоступно или некорректно.";
        } else {
            for (var i = 0; i < paraStyle.nestedGrepStyles.length; i++) {
                if (paraStyle.nestedGrepStyles[i].grepExpression === grepExpression && 
                    paraStyle.nestedGrepStyles[i].appliedCharacterStyle.id === charStyle.id) {
                    existingGrepStyle = paraStyle.nestedGrepStyles[i];
                    grepStyleExisted = true;
                    break;
                }
            }
            if (!grepStyleExisted) {
                paraStyle.nestedGrepStyles.add({
                    appliedCharacterStyle: charStyle,
                    grepExpression: grepExpression
                });
                grepStyleApplied = true;
            }
        }
    } catch (e) {
        grepError = e.message;
    }

    // --- Формирование и вывод итогового сообщения ---
    var finalMessage = "";
    if (settingsApplied.length > 0) {
        finalMessage += "Успешно применены настройки:\n" + settingsApplied.join("\n");
    }
    if (settingsFailed.length > 0) {
        finalMessage += (finalMessage ? "\n\n" : "") + "Не удалось установить настройки:\n" + settingsFailed.join("\n");
    }

    if (grepStyleExisted) {
        finalMessage += (finalMessage ? "\n\n" : "") + "GREP-стиль с выражением '" + grepExpression + "' и символьным стилем '" + noBreakCharStyleName + "' уже существует в стиле '" + basicParagraphStyleName + "'.";
    } else if (grepStyleApplied) {
        finalMessage += (finalMessage ? "\n\n" : "") + "GREP-стиль с выражением '" + grepExpression + "' и символьным стилем '" + noBreakCharStyleName + "' успешно добавлен в стиль '" + basicParagraphStyleName + "'.";
    } else if (grepError) {
        finalMessage += (finalMessage ? "\n\n" : "") + "Ошибка при работе с GREP-стилем для стиля '" + basicParagraphStyleName + "': " + grepError;
    }

    if (finalMessage) {
        alert(finalMessage);
    } else {
        alert("Не было выполнено никаких действий или нечего сообщить.");
    }

})(); 