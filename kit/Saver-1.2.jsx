// SaveAsInddAndIdml-1.2.jsx
// Save .indd и export .idml рядом в той же папке.
// 1.0: базовый save + export.
// 1.1: имя без размножения расширения. Было: у документа с именем
// "leaflet.indd.indd" снимался только один ".indd", и Saver сохранял
// "leaflet.indd.indd" дальше. Теперь снимаются все хвосты .indd/.idml,
// и повторный Save не создаёт .indd.indd.
// 1.2: всё сохранилось — окна нет, Saver молчит. Окно только при ошибке.
// Было: после каждого Save окно с именами, а имена закодированы как в
// ссылке ("P588.L1%20BY%20%E2%80%94..."), потому что File.name отдаёт их так.
// Теперь в окне ошибки имя читается нормально ("P588.L1 BY — ...").

(function () {
    if (app.documents.length === 0) {
        alert("Нет открытых документов.");
        return;
    }

    var doc = app.activeDocument;
    var filePath;
    try {
        filePath = doc.filePath;
        if (!filePath) {
            alert("Сначала сохрани документ.");
            return;
        }
    } catch (ePath) {
        alert("Сначала сохрани документ.");
        return;
    }

    // "leaflet.indd.indd" -> "leaflet", "leaflet.idml" -> "leaflet".
    // Снимаем все повторяющиеся хвосты .indd/.idml, не один.
    function baseNameWithoutExt(name) {
        var base = String(name || "");
        while (true) {
            var lower = base.toLowerCase();
            if (lower.length > 5 && lower.substring(lower.length - 5) === ".indd") {
                base = base.substring(0, base.length - 5);
                continue;
            }
            if (lower.length > 5 && lower.substring(lower.length - 5) === ".idml") {
                base = base.substring(0, base.length - 5);
                continue;
            }
            break;
        }
        return base;
    }

    // File.name отдаёт "P588%20BY%20%E2%80%94..." — для человека раскодируем.
    function readableName(file) {
        try {
            return File.decode(file.name);
        } catch (eDecode) {
            return String(file.name);
        }
    }

    var base = baseNameWithoutExt(doc.name);
    if (!base) {
        alert("Не понял имя документа: " + doc.name);
        return;
    }

    var inddFile = new File(filePath + "/" + base + ".indd");
    var idmlFile = new File(filePath + "/" + base + ".idml");

    try {
        doc.save(inddFile);
    } catch (eSave) {
        alert("Не сохранился .indd:\n" + readableName(inddFile) + "\n\n" + eSave);
        return;
    }

    try {
        doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
    } catch (eIdml) {
        alert(".indd сохранён, а .idml не вышел:\n" + readableName(idmlFile) + "\n\n" + eIdml);
        return;
    }

    // Оба файла на месте — молчим.
})();
