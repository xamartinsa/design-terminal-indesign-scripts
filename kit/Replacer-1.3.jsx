/*
 * Design Terminal → InDesign: замена [pack.*] значениями из вставки.
 * Версия: 1.3 (2026-08-18)
 *
 * 1) В браузере: «Скопировать данные в InDesign»
 * 2) Здесь: «Вставить из буфера» → «Замена»
 * Меняет текущий документ на месте (без копии разворота).
 * __ → Shift+Tab (Right Indent Tab).
 */

#target "InDesign"

(function () {
  if (app.documents.length === 0) {
    alert("Откройте документ InDesign.");
    return;
  }

  function readClipboard() {
    if (File.fs !== "Windows") return "";
    try {
      var t = app.doScript(
        'On Error Resume Next\nCreateObject("htmlfile").ParentWindow.ClipboardData.GetData("text")',
        ScriptLanguage.visualBasic
      );
      if (t === null || typeof t === "undefined") return "";
      return String(t);
    } catch (e) {
      return "";
    }
  }

  function parseItems(raw) {
    if (raw) {
      raw = raw.replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
    }
    if (!raw) return null;
    if (/^\s*\[/.test(raw) && raw.indexOf("ITEMS") === -1) {
      raw = "var ITEMS = " + raw;
      if (raw.charAt(raw.length - 1) !== ";") raw += ";";
    }
    var ITEMS;
    try {
      eval(raw);
    } catch (ex) {
      throw new Error("Не разобрать текст: " + ex);
    }
    if (typeof ITEMS === "undefined" || !ITEMS || !ITEMS.length) return null;
    return ITEMS;
  }

  function normalizeReplace(val) {
    if (val === "Empty string" || val === null || typeof val === "undefined") return "";
    var s = String(val);
    s = s.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
    s = s.replace(/\^/g, "^^");
    s = s.split("__").join("^y");
    return s;
  }

  var dlg = new Window("dialog", "Design Terminal — замена");
  dlg.orientation = "column";
  dlg.alignChildren = ["fill", "top"];
  dlg.spacing = 10;
  dlg.margins = 16;

  dlg.add(
    "statictext",
    undefined,
    "Скопируй данные кнопкой в Терминале, вставь сюда, нажми Замена. Макет меняется на месте. __ → Shift+Tab.",
    { multiline: true }
  );

  var et = dlg.add("edittext", undefined, "", { multiline: true, scrolling: true });
  et.preferredSize = [560, 260];
  et.active = true;

  var g = dlg.add("group");
  g.alignment = "right";
  var btnPaste = g.add("button", undefined, "Вставить из буфера");
  var btnOk = g.add("button", undefined, "Замена");
  g.add("button", undefined, "Отмена", { name: "cancel" });

  btnPaste.onClick = function () {
    var clip = readClipboard();
    if (!clip) {
      alert("Буфер пустой. Сначала кнопка в Терминале, либо Ctrl+V в поле.");
      return;
    }
    et.text = clip;
  };

  btnOk.onClick = function () {
    dlg.close(1);
  };

  dlg.center();
  if (dlg.show() !== 1) return;

  var ITEMS;
  try {
    ITEMS = parseItems(et.text);
  } catch (ex) {
    alert(String(ex));
    return;
  }
  if (!ITEMS) {
    alert("В поле нет ITEMS. Нажми «Вставить из буфера» или вставь Ctrl+V.");
    return;
  }

  var doc = app.activeDocument;
  var oldRedraw = app.scriptPreferences.enableRedraw;
  app.scriptPreferences.enableRedraw = false;

  function run() {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
    try {
      app.findChangeTextOptions.includeMasterPages = true;
      app.findChangeTextOptions.includeHiddenLayers = true;
      app.findChangeTextOptions.includeLockedLayersForFind = false;
      app.findChangeTextOptions.includeLockedStoriesForFind = false;
    } catch (optEx) {}

    var i, found, isTextSuffix, replaceVal, kindHits;
    var hitKinds = 0;
    var totalKinds = 0;
    var miss = [];
    var tabKinds = 0;

    for (i = 0; i < ITEMS.length; i++) {
      if (!ITEMS[i] || typeof ITEMS[i].find === "undefined") {
        throw new Error("Элемент " + (i + 1) + " без find/replace.");
      }
      isTextSuffix = ITEMS[i].find.indexOf("#text]") !== -1;
      if (!isTextSuffix) totalKinds++;
      replaceVal = ITEMS[i].replace;
      if (replaceVal && String(replaceVal).indexOf("__") !== -1) tabKinds++;

      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findTextPreferences.findWhat = ITEMS[i].find;
      app.changeTextPreferences.changeTo = normalizeReplace(replaceVal);
      kindHits = 0;
      try {
        found = doc.changeText();
        if (found && found.length) kindHits = found.length;
      } catch (chEx) {}

      if (kindHits > 0) {
        if (!isTextSuffix) hitKinds++;
      } else if (!isTextSuffix) {
        miss.push(ITEMS[i].find);
      }
    }

    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;

    var msg = "Замена: " + hitKinds + " из " + totalKinds;
    if (tabKinds) msg += "\n__ → Shift+Tab: " + tabKinds;
    if (miss.length) {
      var shown = miss.slice(0, 12).join("\n");
      if (miss.length > 12) shown += "\n… ещё " + (miss.length - 12);
      msg += "\n\nНе найдены:\n" + shown;
    }
    alert(msg);
  }

  try {
    app.doScript(run, ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, "DT Replace Variables");
  } catch (runEx) {
    alert(String(runEx));
  } finally {
    app.scriptPreferences.enableRedraw = oldRedraw;
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
  }
})();
