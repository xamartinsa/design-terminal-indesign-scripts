#target "InDesign"

(function () {
    function alertErr(msg) {
        alert("Publisher\n\n" + msg);
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

    function writeJob(inddPath, target) {
        var job = new File(Folder.temp.fsName + "/dt-publish-" + Date.now() + ".json");
        job.encoding = "UTF-8";
        if (!job.open("w")) {
            throw new Error("\u043d\u0435 \u0441\u043c\u043e\u0433 \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c job \u0432 Temp");
        }
        var body = '{"indd":"' + escapeJson(inddPath) + '"';
        if (target) body += ',"target":"' + target + '"';
        body += "}";
        job.write(body);
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

    function layoutCodeOf(name) {
        var m = String(name).match(/P[0-9]+\.L[0-9]+/i);
        if (!m) return "";
        return String(m[0]).toUpperCase();
    }

    function packNumOf(name) {
        var s = String(name);
        if (/^P[0-9]+\.L[0-9]+\b/i.test(s)) return "";
        var m = s.match(/^P([0-9]+)\b/i);
        return m ? String(m[1]) : "";
    }

    function packOfLayout(code) {
        var m = String(code).match(/^P([0-9]+)\.L/i);
        return m ? String(m[1]) : "";
    }

    function inspectPath(inddPath) {
        var f = new File(inddPath);
        var folder = f.parent;
        var info = {
            fileCode: layoutCodeOf(f.name),
            fileName: String(f.name),
            folderCode: folder ? layoutCodeOf(folder.name) : "",
            folderName: folder ? String(folder.name) : "",
            packCode: "",
            packName: ""
        };
        var p = folder;
        var guard = 0;
        while (p && guard < 16) {
            var skip = info.folderCode && String(p.fsName) === String(folder.fsName);
            if (!skip) {
                var n = packNumOf(p.name);
                if (n) {
                    info.packCode = n;
                    info.packName = String(p.name);
                    break;
                }
            }
            if (!p.parent || String(p.parent.fsName) === String(p.fsName)) break;
            p = p.parent;
            guard++;
        }
        return info;
    }

    function mismatchKind(info) {
        if (info.fileCode && info.folderCode && info.fileCode !== info.folderCode) return "codes";
        if (info.folderCode && info.packCode && packOfLayout(info.folderCode) !== info.packCode) return "pack";
        if (!info.folderCode && info.fileCode && info.packCode && packOfLayout(info.fileCode) !== info.packCode) return "pack";
        return "";
    }

    function clip(s) {
        s = String(s || "");
        if (s.length <= 88) return s;
        return s.substring(0, 85) + "...";
    }

    function addLine(parent, text) {
        var t = parent.add("statictext", undefined, text);
        t.preferredSize.width = 460;
        return t;
    }

    function askWhere(info, kind) {
        var w = new Window("dialog", "Publisher");
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 6;
        w.margins = 16;

        addLine(w, "\u0421\u0442\u0440\u0430\u043d\u043d\u043e: \u0438\u043c\u044f \u0444\u0430\u0439\u043b\u0430 \u0438 \u043f\u0430\u043f\u043a\u0438 \u043d\u0435 \u043f\u0440\u043e \u043e\u0434\u0438\u043d \u043f\u0430\u043a.");
        addLine(w, "\u0424\u0430\u0439\u043b " + (info.fileCode || "\u2014"));
        addLine(w, clip(info.fileName));
        addLine(w, "\u041f\u0430\u043f\u043a\u0430 " + (info.folderCode || "\u2014"));
        addLine(w, clip(info.folderName));
        addLine(w, "\u041f\u0430\u043a P" + (info.packCode || "\u2014"));
        addLine(w, clip(info.packName));

        var folderPack = packOfLayout(info.folderCode);
        var filePack = packOfLayout(info.fileCode);
        var hint = "";
        if (kind === "codes" && info.folderCode && info.packCode && info.packCode === folderPack && info.packCode !== filePack) {
            hint = "\u0413\u043e\u043b\u043e\u0432\u043d\u0430\u044f \u043f\u0430\u043f\u043a\u0430 \u043f\u0430\u043a\u0430 \u0442\u043e\u0436\u0435 P" + info.packCode + ". \u041f\u043e\u0445\u043e\u0436\u0435, \u0438\u043c\u044f \u0444\u0430\u0439\u043b\u0430 \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043e\u0442 \u0434\u0440\u0443\u0433\u043e\u0433\u043e \u043f\u0430\u043a\u0430.";
        } else if (kind === "codes" && info.fileCode && info.packCode && info.packCode === filePack && info.packCode !== folderPack) {
            hint = "\u0413\u043e\u043b\u043e\u0432\u043d\u0430\u044f \u043f\u0430\u043f\u043a\u0430 \u043f\u0430\u043a\u0430 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442 \u0441 \u0438\u043c\u0435\u043d\u0435\u043c \u0444\u0430\u0439\u043b\u0430 (P" + info.packCode + "), \u0430 \u043f\u0430\u043f\u043a\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u0430 \u2014 \u0434\u0440\u0443\u0433\u0430\u044f.";
        } else if (kind === "codes" && info.fileCode && info.folderCode && filePack === folderPack) {
            hint = "\u041f\u0430\u043a \u043e\u0434\u0438\u043d, \u043d\u043e\u043c\u0435\u0440\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u043e\u0432 \u0440\u0430\u0437\u043d\u044b\u0435.";
        } else if (kind === "pack") {
            hint = "\u0413\u043e\u043b\u043e\u0432\u043d\u0430\u044f \u043f\u0430\u043f\u043a\u0430 \u043f\u0430\u043a\u0430 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442 \u0441 \u043b\u0435\u0439\u0430\u0443\u0442\u043e\u043c.";
        }
        if (hint) addLine(w, hint);
        addLine(w, "\u041a\u0443\u0434\u0430 \u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c?");

        var g = w.add("group");
        g.orientation = "column";
        g.alignChildren = ["fill", "top"];
        var choice = "";
        var preferFile = kind === "codes" && info.packCode && info.packCode === filePack && info.packCode !== folderPack;
        var folderBtn = null;
        var fileBtn = null;
        if (kind === "codes" && info.folderCode) {
            folderBtn = g.add("button", undefined, "\u0412 \u043f\u0430\u043f\u043a\u0443 " + info.folderCode);
            folderBtn.onClick = function () { choice = "folder"; w.close(); };
        }
        if (kind === "codes" && info.fileCode) {
            fileBtn = g.add("button", undefined, "\u041a\u0430\u043a \u0432 \u0444\u0430\u0439\u043b\u0435 " + info.fileCode);
            fileBtn.onClick = function () { choice = "file"; w.close(); };
        }
        if (kind === "pack") {
            var yesCode = info.folderCode || info.fileCode;
            var yesTarget = info.folderCode ? "folder" : "file";
            var yesBtn = g.add("button", undefined, "\u0412\u0441\u0451 \u0440\u0430\u0432\u043d\u043e " + yesCode);
            yesBtn.onClick = function () { choice = yesTarget; w.close(); };
            w.defaultElement = yesBtn;
        } else if (preferFile && fileBtn) {
            w.defaultElement = fileBtn;
        } else if (folderBtn) {
            w.defaultElement = folderBtn;
        }
        var cancelBtn = g.add("button", undefined, "\u041e\u0442\u043c\u0435\u043d\u0430");
        cancelBtn.onClick = function () { choice = ""; w.close(); };
        w.cancelElement = cancelBtn;
        w.show();
        return choice;
    }

    function titleCode(info, target) {
        if (target === "file" && info.fileCode) return info.fileCode;
        if (info.folderCode && target !== "file") return info.folderCode;
        if (info.fileCode) return info.fileCode;
        return "Publisher";
    }

    function launchDetached(toolDir, jobFile, title) {
        var cmdFile = new File(toolDir.fsName + "/publish-detached.cmd");
        if (!cmdFile.exists) {
            throw new Error("\u043d\u0435\u0442 publish-detached.cmd \u0440\u044f\u0434\u043e\u043c \u0441 publish.py");
        }
        var launcher = new File(Folder.temp.fsName + "/dt-publish-run.cmd");
        launcher.encoding = "UTF-8";
        if (!launcher.open("w")) {
            throw new Error("\u043d\u0435 \u0441\u043c\u043e\u0433 \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c launcher \u0432 Temp");
        }
        launcher.writeln("@echo off");
        launcher.writeln("title " + title);
        launcher.writeln("call \"" + cmdFile.fsName + "\" --job \"" + jobFile.fsName + "\"");
        launcher.close();
        noteLog(toolDir, "[" + new Date().toString() + "] jsx -> " + launcher.fsName);
        if (!launcher.execute()) {
            throw new Error("File.execute \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b " + launcher.fsName);
        }
    }

    if (app.documents.length === 0) {
        alertErr("\u041d\u0435\u0442 \u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0433\u043e \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430.");
        return;
    }

    var doc = app.activeDocument;
    if (!doc.saved || !doc.fullName) {
        alertErr("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0438 INDD \u0432 \u043f\u0430\u043f\u043a\u0443 \u041c\u0430\u043a\u0435\u0442\u043e\u0432 (Pxxx.Ly \u2026).");
        return;
    }

    var toolDir = findToolDir();
    if (!toolDir) {
        alertErr("\u041d\u0435 \u043d\u0430\u0448\u0451\u043b publish.py. \u041d\u0443\u0436\u043d\u044b Python \u0438 login.bat \u0438\u0437 \u043f\u0430\u043f\u043a\u0438 Template Publisher, \u0437\u0430\u0442\u0435\u043c Copy-Latest.bat \u0438\u043b\u0438 Update-DT-Scripts.");
        return;
    }

    var inddPath = doc.fullName.fsName;
    var info = inspectPath(inddPath);
    var kind = mismatchKind(info);
    var target = "";
    if (kind) {
        target = askWhere(info, kind);
        if (!target) return;
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

        var job = writeJob(doc.fullName.fsName, target);
        launchDetached(toolDir, job, titleCode(info, target));
    } catch (e) {
        alertErr("\u041d\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u043b: " + e);
        return;
    }
})();
