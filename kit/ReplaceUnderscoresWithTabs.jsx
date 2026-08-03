// ReplaceUnderscoresWithTabs.jsx
// Версия: 1.2
// Дата: 15.05.2026
// Постобработка текста меню TR в InDesign после вставки из Design Terminal / Slack.
//
// Заменяет литеральные маркеры в тексте (два символа: обратный слэш + буква):
//   \r  → конец абзаца (Enter) — разрыв между позициями / товарами
//   \n  → принудительный перенос (Shift+Enter) — строки внутри одной группы в столбце
//   __  → Right Indent Tab (~y) — выравнивание цен вправо
//
// Важно: в исходнике от агента текст отдаётся ОДНОЙ сплошной строкой с литеральными \n и \r,
// без настоящих переносов абзаца. После вставки в InDesign — запустить этот скрипт.
// @targetengine "session"

Main();

function Main() {
    if (app.documents.length === 0) {
        alert("Пожалуйста, откройте документ!");
        return;
    }

    var doc = app.activeDocument;
    var totalFound = 0;

    // Порядок: сначала \r, потом \n, потом __ (цены не трогаем раньше времени)
    var replacements = [
        { find: "\\\\r", change: "\\r", description: "Текст '\\r' → конец абзаца (Enter)" },
        { find: "\\\\n", change: "\\n", description: "Текст '\\n' → Shift+Enter" },
        { find: "__", change: "~y", description: "Два подчеркивания (__) → Right Indent Tab (~y)" }
    ];

    var reportLines = [];

    for (var i = 0; i < replacements.length; i++) {
        app.findGrepPreferences = null;
        app.changeGrepPreferences = null;
        app.findGrepPreferences.findWhat = replacements[i].find;
        app.changeGrepPreferences.changeTo = replacements[i].change;

        var foundItems = doc.changeGrep();
        var count = foundItems.length;
        reportLines.push(replacements[i].description + ": " + count);
        totalFound += count;
    }

    app.findGrepPreferences = null;
    app.changeGrepPreferences = null;

    if (totalFound > 0) {
        alert(
            "Замена выполнена.\nВсего: " + totalFound + "\n\n" +
            reportLines.join("\n") +
            "\n\nЕсли \\n или \\r = 0: в тексте должны быть литеральные символы \\ и n/r," +
            " а не настоящие переносы строк. См. rules.md §2."
        );
    } else {
        alert(
            "Маркеры не найдены.\n\n" +
            "Проверьте: текст вставлен одной строкой с литеральными \\n, \\r и __.\n" +
            "Не используйте Enter/Shift+Enter вручную до запуска скрипта."
        );
    }
}
