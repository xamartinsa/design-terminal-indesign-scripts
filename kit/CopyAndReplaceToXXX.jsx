#targetengine "session";

(function() {
    if (app.documents.length === 0) {
        alert("Пожалуйста, откройте документ InDesign.", "Ошибка", true);
        return;
    }

    var doc = app.activeDocument;
    var docPath;

    try {
        docPath = doc.filePath;
        if (doc.modified) {
            doc.save();
        }
    } catch (e) {
        alert("Документ должен быть сохранен хотя бы один раз перед запуском скрипта.", "Ошибка", true);
        return;
    }

    var docName = doc.name.replace(/\.indd$/, '');
    var tempDocName = docName + " — Edit.indd";
    var tempDocFile = new File(docPath + "/" + tempDocName);

    if (tempDocFile.exists) {
        tempDocFile.remove();
    }

    try {
        doc.saveACopy(tempDocFile);
    } catch (e) {
        alert("Не удалось сохранить временную копию файла.\n" + e, "Ошибка", true);
        return;
    }

    var tempDoc;
    try {
        tempDoc = app.open(tempDocFile, false); // Открываем невидимо
    } catch (e) {
        alert("Не удалось открыть временную копию файла.\n" + e, "Ошибка", true);
        if (tempDocFile.exists) {
            tempDocFile.remove();
        }
        return;
    }

    try {
        app.findGrepPreferences = null;
        app.changeGrepPreferences = null;
        
        app.findGrepPreferences.findWhat = "\\[[^\\]]+\\]";
        app.changeGrepPreferences.changeTo = "XXX";
        tempDoc.changeGrep();

        app.findGrepPreferences = null;
        app.changeGrepPreferences = null;

        var packageFolderName = docName + " — Edit";
        var parentDir = docPath.parent;
        var packageFolder = new Folder(parentDir + "/" + packageFolderName);

        var packaged = tempDoc.packageForPrint(
            packageFolder,
            true,    // copyingFonts
            true,    // copyingLinkedGraphics
            true,    // copyingProfiles
            true,    // updatingGraphics
            false,   // includingHiddenLayers
            true,    // ignorePreflightErrors
            false,   // creatingReport
            true,    // includeIdml
            false    // includePdf
        );

        if (packaged) {
            alert("Готово! Упакованная папка создана на уровень выше.", "Успех");
            packageFolder.execute();
        } else {
            alert("Упаковка была отменена или не удалась.", "Информация");
        }

    } catch (e) {
        alert("Произошла ошибка при обработке файла:\n" + e, "Ошибка", true);
    } finally {
        if (tempDoc) {
            tempDoc.close(SaveOptions.NO);
        }
        if (tempDocFile.exists) {
            tempDocFile.remove();
        }
    }
})();
