#target "InDesign"

(function () {
    function alertErr(msg) {
        alert("Publish template\n\n" + msg);
    }

    function escapeJson(s) {
        return String(s)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
    }

    function readToolDir(cfg) {
        if (!cfg.exists) return null;
        cfg.open("r");
        var line = cfg.readln();
        cfg.close();
        line = String(line).replace(/^\s+|\s+$/g, "");
        var dir = new Folder(line);
        if (dir.exists) return dir;
        return null;
    }

    function findToolDir() {
        var here = File($.fileName).parent;
        var py = new File(here.fsName + "/publish.py");
        if (py.exists) return here;
        var names = [
            "/zzz Technical/tool-dir.txt",
            "/Technical/tool-dir.txt",
            "/tool-dir.txt"
        ];
        var i;
        for (i = 0; i < names.length; i++) {
            var dir = readToolDir(new File(here.fsName + names[i]));
            if (dir) return dir;
        }
        return null;
    }

    function writeJob(inddPath) {
        var job = new File(Folder.temp.fsName + "/dt-publish-" + Date.now() + ".json");
        job.encoding = "UTF-8";
        if (!job.open("w")) {
            throw new Error("не смог написать job в Temp");
        }
        job.write('{"indd":"' + escapeJson(inddPath) + '"}');
        job.close();
        return job;
    }

    function noteLog(toolDir, msg) {
        var dir = new Folder(toolDir.fsName + "/logs");
        if (!dir.exists) dir.create();
        var f = new File(dir.fsName + "/latest.log");
        f.encoding = "UTF-8";
        f.open("a");
        f.writeln(msg);
        f.close();
    }

    function launchDetached(toolDir, jobFile) {
        var cmdFile = new File(toolDir.fsName + "/publish-detached.cmd");
        if (!cmdFile.exists) {
            throw new Error("нет publish-detached.cmd рядом с publish.py");
        }
        // cmd /c "path with spaces\x.cmd" args — InDesign/WScript глотает аргументы.
        // Батник в Temp без пробелов, его File.execute().
        var launcher = new File(Folder.temp.fsName + "/dt-publish-run.cmd");
        launcher.encoding = "UTF-8";
        if (!launcher.open("w")) {
            throw new Error("не смог написать launcher в Temp");
        }
        launcher.writeln("@echo off");
        launcher.writeln("title DT-Publish");
        launcher.writeln("call \"" + cmdFile.fsName + "\" --job \"" + jobFile.fsName + "\"");
        launcher.close();
        noteLog(toolDir, "[" + new Date().toString() + "] jsx -> " + launcher.fsName);
        if (!launcher.execute()) {
            throw new Error("File.execute не запустил " + launcher.fsName);
        }
    }

    if (app.documents.length === 0) {
        alertErr("Нет открытого документа.");
        return;
    }

    var doc = app.activeDocument;
    if (!doc.saved || !doc.fullName) {
        alertErr("Сначала сохрани INDD в папку Макетов (Pxxx.Ly …).");
        return;
    }

    var toolDir = findToolDir();
    if (!toolDir) {
        alertErr("Не нашёл publish.py. Нужны Python и login.bat из папки Template Publisher, затем Copy-Latest.bat или Update-DT-Scripts.");
        return;
    }

    try {
        doc.save();
        var stem = String(doc.name).replace(/\.indd$/i, "");
        var idml = new File(doc.filePath.fsName + "/" + stem + ".idml");
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        try {
            doc.exportFile(ExportFormat.INDESIGN_MARKUP, idml);
        } finally {
            app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;
        }

        var job = writeJob(doc.fullName.fsName);
        launchDetached(toolDir, job);
    } catch (e) {
        alertErr("Не отправил: " + e);
        return;
    }
})();
