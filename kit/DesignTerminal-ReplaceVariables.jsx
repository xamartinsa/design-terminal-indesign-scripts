/*
 * Design Terminal → InDesign: замена текста [имя.переменной] на значения из буфера.
 *
 * ГДЕ ЛЕЖИТ ФАЙЛ (копия в проекте)
 *   FigmaToIndd\scripts\indesign\DesignTerminal-ReplaceVariables.jsx
 *
 * КУДА СКОПИРОВАТЬ ДЛЯ ПАНЕЛИ «СЦЕНАРИИ»
 *   %APPDATA%\Adobe\InDesign\<версия, напр. Version 20.0-RU>\Scripts\Scripts Panel\
 *
 * КАК ПОЛЬЗОВАТЬСЯ
 *   1) В браузере (Tampermonkey) — «Копировать в буфер».
 *   2) В InDesign откройте нужный разворот, запустите сценарий из панели «Сценарии».
 *   3) В окне вставьте var ITEMS = … и нажмите «Копия разворота + замена».
 *      Сначала создаётся копия активного разворота; подстановка только на копии,
 *      исходный разворот с плейсхолдерами [имя] не меняется.
 *
 * В макете плейсхолдеры вида [pack.title] — как в поле find из буфера.
 */

#target "InDesign"

(function () {
  if (app.documents.length === 0) {
    alert("Откройте документ InDesign.");
    return;
  }

  var doc = app.activeDocument;

  var dlg = new Window("dialog", "Design Terminal — вставка ITEMS");
  dlg.orientation = "column";
  dlg.alignChildren = ["fill", "top"];
  dlg.spacing = 10;
  dlg.margins = 16;

  dlg.add(
    "statictext",
    undefined,
    "Вставьте блок из браузера (var ITEMS = …). Будет создана копия текущего разворота; подстановка только на копии, оригинал не меняется.",
    { multiline: true }
  );

  var et = dlg.add("edittext", undefined, "", { multiline: true, scrolling: true });
  et.preferredSize = [560, 280];
  et.active = true;

  var g = dlg.add("group");
  g.alignment = "right";
  var btnOk = g.add("button", undefined, "Копия разворота + замена");
  var btnCancel = g.add("button", undefined, "Отмена");

  btnOk.onClick = function () {
    dlg.close(1);
  };
  btnCancel.onClick = function () {
    dlg.close(2);
  };

  dlg.center();
  if (dlg.show() !== 1) {
    return;
  }

  var raw = et.text;
  if (raw) {
    raw = raw.replace(/^\uFEFF/, "");
    raw = raw.replace(/^\s+|\s+$/g, "");
  }

  if (!raw || raw.length === 0) {
    alert("Поле пустое. Вставьте блок из Tampermonkey и запустите сценарий снова.");
    return;
  }

  // Если вставили только массив [...] без "var ITEMS ="
  if (/^\s*\[/.test(raw) && raw.indexOf("ITEMS") === -1) {
    raw = "var ITEMS = " + raw;
    if (raw.charAt(raw.length - 1) !== ";") {
      raw += ";";
    }
  }

  var ITEMS;
  try {
    eval(raw);
  } catch (ex) {
    alert("Не удалось разобрать вставку.\n\nПроверьте, что скопирован полный блок из браузера.\n\nОшибка: " + ex);
    return;
  }

  if (typeof ITEMS === "undefined") {
    alert("В тексте нет объявления ITEMS.\nВставьте строки вида:\nvar ITEMS = [\n  { find: \"[...]\", replace: \"...\" },\n  ...\n];");
    return;
  }

  if (!ITEMS || ITEMS.length === 0) {
    alert("Массив ITEMS пуст.");
    return;
  }

  var win = doc.layoutWindows[0];
  if (!win) {
    alert("Нет окна макета.");
    return;
  }

  var sourceSpread = win.activeSpread;
  if (!sourceSpread) {
    alert("Не удалось определить активный разворот.");
    return;
  }

  var dupSpread;
  try {
    dupSpread = sourceSpread.duplicate(LocationOptions.AFTER, sourceSpread);
  } catch (dupEx) {
    alert("Не удалось скопировать разворот:\n" + dupEx);
    return;
  }

  if (!dupSpread) {
    dupSpread = doc.spreads[sourceSpread.index + 1];
  }
  if (!dupSpread) {
    alert("Копия разворота не найдена после дублирования.");
    return;
  }

  try {
    win.activeSpread = dupSpread;
  } catch (navEx) {}

  function collectStoriesOnSpread(spread) {
    var seen = {};
    var list = [];
    var tfs = spread.textFrames;
    var t, st, key;
    for (t = 0; t < tfs.length; t++) {
      try {
        st = tfs[t].parentStory;
        key = String(st.id);
        if (!seen[key]) {
          seen[key] = true;
          list.push(st);
        }
      } catch (ignore) {}
    }
    return list;
  }

  var stories = collectStoriesOnSpread(dupSpread);
  if (stories.length === 0) {
    alert(
      "На копии разворота нет текстовых рамок (или не удалось их прочитать).\nДубликат разворота создан; замены не выполнялись."
    );
    return;
  }

  function normalizeReplace(val) {
    if (val === "Empty string") {
      return "";
    }
    return val;
  }

  var i, j;
  for (i = 0; i < ITEMS.length; i++) {
    if (!ITEMS[i] || typeof ITEMS[i].find === "undefined") {
      alert("Неверный формат: элемент " + (i + 1) + " должен содержать поля find и replace.");
      return;
    }
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
    app.findTextPreferences.findWhat = ITEMS[i].find;
    app.changeTextPreferences.changeTo = normalizeReplace(ITEMS[i].replace);
    for (j = 0; j < stories.length; j++) {
      try {
        stories[j].changeText();
      } catch (chEx) {}
    }
  }

  alert(
    "Готово.\n• Исходный разворот не менялся (плейсхолдеры как были).\n• Создана копия; на ней выполнено " +
      ITEMS.length +
      " видов замен по списку ITEMS.\n\nЕсли текст «перетекает» на другой разворот по связи, замена может затронуть и его — разорвите связь или держите сюжет в одном развороте."
  );
})();
