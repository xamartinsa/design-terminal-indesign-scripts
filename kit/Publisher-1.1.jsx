#target "InDesign"

(function () {
    var TEXT_WIDTH = 540;
    var TREE_CHARS = 72;
    var TREE_STEP = 26;

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

    // File.name / Folder.name come URI-encoded (%20, %E2%80%94); people need the real name.
    function plainName(item) {
        var raw = String(item.name);
        try {
            return String(File.decode(raw));
        } catch (e) {}
        try {
            return String(item.displayName);
        } catch (e2) {}
        return raw;
    }

    function sameItem(a, b) {
        return !!(a && b && String(a.fsName) === String(b.fsName));
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

    function layoutNumOf(code) {
        var m = String(code).match(/\.L([0-9]+)$/i);
        return m ? String(m[1]) : "";
    }

    function inspectPath(inddPath) {
        var f = new File(inddPath);
        var folder = f.parent;
        var info = {
            fileCode: "",
            fileName: plainName(f),
            folderCode: "",
            folderName: folder ? plainName(folder) : "",
            packCode: "",
            packName: "",
            packFolder: null,
            chain: []
        };
        info.fileCode = layoutCodeOf(info.fileName);
        info.folderCode = info.folderName ? layoutCodeOf(info.folderName) : "";
        var walked = [];
        var p = folder;
        var guard = 0;
        while (p && guard < 16) {
            walked.push(p);
            var skip = info.folderCode && sameItem(p, folder);
            if (!skip) {
                var name = plainName(p);
                var n = packNumOf(name);
                if (n) {
                    info.packCode = n;
                    info.packName = name;
                    info.packFolder = p;
                    break;
                }
            }
            if (!p.parent || sameItem(p.parent, p)) break;
            p = p.parent;
            guard++;
        }
        var i;
        if (info.packFolder) {
            for (i = walked.length - 1; i >= 0; i--) info.chain.push(walked[i]);
        } else if (folder) {
            info.chain.push(folder);
        }
        return info;
    }

    function mismatchKind(info) {
        if (info.fileCode && info.folderCode && info.fileCode !== info.folderCode) return "codes";
        if (info.folderCode && info.packCode && packOfLayout(info.folderCode) !== info.packCode) return "pack";
        if (!info.folderCode && info.fileCode && info.packCode && packOfLayout(info.fileCode) !== info.packCode) return "pack";
        return "";
    }

    // Where the layout can go: folder name, file name, head pack folder.
    // One code = one option. The one that agrees with the head pack folder comes first.
    function targetOptions(info) {
        var list = [];
        function add(code, target, source) {
            if (!code) return;
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i].code === code) {
                    list[i].sources.push(source);
                    return;
                }
            }
            list.push({ code: code, target: target, sources: [source] });
        }
        add(info.folderCode, "folder", "\u043f\u0430\u043f\u043a\u0435 \u043b\u0435\u0439\u0430\u0443\u0442\u0430");
        add(info.fileCode, "file", "\u0438\u043c\u0435\u043d\u0438 \u0444\u0430\u0439\u043b\u0430");
        var j;
        var packAgrees = false;
        for (j = 0; j < list.length; j++) {
            if (info.packCode && packOfLayout(list[j].code) === info.packCode) packAgrees = true;
        }
        var num = layoutNumOf(info.folderCode || info.fileCode);
        if (info.packCode && num && !packAgrees) {
            add("P" + info.packCode + ".L" + num, "pack", "\u043f\u0430\u043f\u043a\u0435 \u043f\u0430\u043a\u0430");
        }
        if (info.packCode) {
            for (j = 0; j < list.length; j++) {
                if (packOfLayout(list[j].code) === info.packCode) {
                    if (j > 0) list.unshift(list.splice(j, 1)[0]);
                    break;
                }
            }
        }
        return list;
    }

    function findPackFolder(parent, num) {
        if (!parent || !num) return null;
        var items;
        try {
            items = parent.getFiles("P" + num + "*");
        } catch (e) {
            return null;
        }
        var i;
        for (i = 0; i < items.length; i++) {
            if (items[i] instanceof Folder && packNumOf(plainName(items[i])) === num) return items[i];
        }
        return null;
    }

    // Other packs the codes point to, if their folders sit next to the head pack folder.
    function otherPacks(info, options) {
        var found = [];
        if (!info.packFolder || !info.packFolder.parent) return found;
        var seen = {};
        seen[info.packCode] = true;
        var i;
        for (i = 0; i < options.length; i++) {
            var num = packOfLayout(options[i].code);
            if (!num || seen[num]) continue;
            seen[num] = true;
            var dir = findPackFolder(info.packFolder.parent, num);
            if (dir) found.push({ num: num, name: plainName(dir) });
        }
        return found;
    }

    function clipTo(s, max) {
        s = String(s || "");
        if (max < 12) max = 12;
        if (s.length <= max) return s;
        return s.substring(0, max - 1) + "\u2026";
    }

    // Row = fixed-width cells (\u2502 / \u251c\u2500 / \u2514\u2500 / empty) + name. Cells keep nesting straight in any font.
    function renderNode(node, prefix, last, isRoot, out) {
        var cells = prefix.slice(0);
        if (!isRoot) cells.push(last ? "\u2514\u2500" : "\u251c\u2500");
        out.push({ cells: cells, name: clipTo(node.name, TREE_CHARS - 3 * cells.length) });
        var next = isRoot ? [] : prefix.concat([last ? "" : "\u2502"]);
        var i;
        for (i = 0; i < node.kids.length; i++) {
            renderNode(node.kids[i], next, i === node.kids.length - 1, false, out);
        }
    }

    function rowText(row) {
        var s = "";
        var i;
        for (i = 0; i < row.cells.length; i++) s += row.cells[i] ? row.cells[i] + " " : "   ";
        return s + row.name;
    }

    function treeRows(info, others) {
        var node = { name: info.fileName, kids: [] };
        var i;
        for (i = info.chain.length - 1; i >= 0; i--) {
            node = { name: plainName(info.chain[i]), kids: [node] };
        }
        var top = info.chain.length ? info.chain[0] : null;
        var root = node;
        if (top && top.parent && !sameItem(top.parent, top)) {
            root = { name: plainName(top.parent), kids: [] };
            var items = [{ num: info.packCode ? Number(info.packCode) : -1, node: node }];
            for (i = 0; i < others.length; i++) {
                items.push({ num: Number(others[i].num), node: { name: others[i].name, kids: [] } });
            }
            items.sort(function (a, b) { return a.num - b.num; });
            for (i = 0; i < items.length; i++) root.kids.push(items[i].node);
        }
        var out = [];
        renderNode(root, [], true, true, out);
        return out;
    }

    function headline(info, kind) {
        if (kind === "codes") {
            return "\u0424\u0430\u0439\u043b \u043d\u0430\u0437\u044b\u0432\u0430\u0435\u0442\u0441\u044f " + info.fileCode + ", \u0430 \u043f\u0430\u043f\u043a\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u0430 \u2014 " + info.folderCode + ".";
        }
        return "\u041b\u0435\u0439\u0430\u0443\u0442 " + (info.folderCode || info.fileCode) + " \u043b\u0435\u0436\u0438\u0442 \u0432 \u043f\u0430\u043f\u043a\u0435 \u043f\u0430\u043a\u0430 P" + info.packCode + ".";
    }

    function hintLines(info, kind, options, others) {
        var lines = [];
        var filePack = packOfLayout(info.fileCode);
        var folderPack = packOfLayout(info.folderCode);
        var pack = info.packCode;
        if (kind === "codes") {
            if (pack && pack === folderPack && pack !== filePack) {
                lines.push("\u041f\u0430\u043f\u043a\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u0430 \u0438 \u043f\u0430\u043a \u2014 P" + pack + ". \u0418\u043c\u044f \u0444\u0430\u0439\u043b\u0430, \u043f\u043e\u0445\u043e\u0436\u0435, \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043e\u0442 \u0434\u0440\u0443\u0433\u043e\u0433\u043e \u043f\u0430\u043a\u0430.");
            } else if (pack && pack === filePack && pack !== folderPack) {
                lines.push("\u0418\u043c\u044f \u0444\u0430\u0439\u043b\u0430 \u0438 \u043f\u0430\u043a \u2014 P" + pack + ". \u041f\u0430\u043f\u043a\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u0430, \u043f\u043e\u0445\u043e\u0436\u0435, \u043e\u0442 \u0434\u0440\u0443\u0433\u043e\u0433\u043e \u043f\u0430\u043a\u0430.");
            } else if (filePack && filePack === folderPack) {
                lines.push("\u041f\u0430\u043a \u043e\u0434\u0438\u043d, \u0430 \u043d\u043e\u043c\u0435\u0440\u0430 \u043b\u0435\u0439\u0430\u0443\u0442\u043e\u0432 \u0440\u0430\u0437\u043d\u044b\u0435.");
            }
        }
        var i;
        var j;
        for (i = 0; i < options.length; i++) {
            var num = packOfLayout(options[i].code);
            for (j = 0; j < others.length; j++) {
                if (others[j].num === num) {
                    lines.push(options[i].code + " \u2014 \u043b\u0435\u0439\u0430\u0443\u0442 \u0434\u0440\u0443\u0433\u043e\u0433\u043e \u043f\u0430\u043a\u0430: " + others[j].name + ".");
                }
            }
        }
        return lines;
    }

    function buttonLabel(option) {
        return "\u0412 " + option.code + " \u2014 \u043f\u043e " + option.sources.join(" \u0438 ");
    }

    function addText(parent, text, width) {
        var t = parent.add("statictext", undefined, text);
        t.preferredSize.width = width || TEXT_WIDTH;
        return t;
    }

    function addTreeRow(parent, row) {
        var r = parent.add("group");
        r.orientation = "row";
        r.alignChildren = ["left", "center"];
        r.spacing = 0;
        r.margins = 0;
        var i;
        for (i = 0; i < row.cells.length; i++) addText(r, row.cells[i], TREE_STEP);
        addText(r, row.name, TEXT_WIDTH - TREE_STEP * row.cells.length);
    }

    function addBlock(parent, spacing) {
        var g = parent.add("group");
        g.orientation = "column";
        g.alignChildren = ["fill", "top"];
        g.spacing = spacing;
        return g;
    }

    function askWhere(info, kind) {
        var options = targetOptions(info);
        var others = otherPacks(info, options);

        var w = new Window("dialog", "Publisher");
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 12;
        w.margins = 16;

        addText(w, headline(info, kind));

        var tree = addBlock(w, 0);
        tree.alignChildren = ["left", "top"];
        var rows = treeRows(info, others);
        var i;
        for (i = 0; i < rows.length; i++) addTreeRow(tree, rows[i]);

        var hints = hintLines(info, kind, options, others);
        if (hints.length) {
            var hintBox = addBlock(w, 4);
            for (i = 0; i < hints.length; i++) addText(hintBox, hints[i]);
        }

        addText(w, "\u041a\u0443\u0434\u0430 \u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c?");

        var g = addBlock(w, 6);
        var choice = null;
        function bind(btn, option) {
            btn.onClick = function () {
                choice = option;
                w.close();
            };
        }
        for (i = 0; i < options.length; i++) {
            var btn = g.add("button", undefined, buttonLabel(options[i]));
            bind(btn, options[i]);
            if (i === 0) w.defaultElement = btn;
        }
        var cancelBtn = g.add("button", undefined, "\u041e\u0442\u043c\u0435\u043d\u0430");
        cancelBtn.onClick = function () {
            choice = null;
            w.close();
        };
        w.cancelElement = cancelBtn;
        w.show();
        return choice;
    }

    function vbsString(s) {
        return String(s).replace(/"/g, '""');
    }

    function launchDetached(toolDir, jobFile, title) {
        var pyTxt = new File(toolDir.fsName + "/python-exe.txt");
        if (!pyTxt.exists) {
            throw new Error("\u043d\u0435\u0442 python-exe.txt. \u0417\u0430\u043f\u0443\u0441\u0442\u0438 Copy-Latest.bat");
        }
        pyTxt.open("r");
        var python = String(pyTxt.readln()).replace(/^\s+|\s+$/g, "");
        pyTxt.close();
        if (!python || !(new File(python)).exists) {
            throw new Error("Python \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d: " + python);
        }
        var publishPy = new File(toolDir.fsName + "/publish.py");
        if (!publishPy.exists) {
            throw new Error("\u043d\u0435\u0442 publish.py");
        }
        var launcher = new File(Folder.temp.fsName + "/dt-publish-run-" + Date.now() + ".vbs");
        if (!launcher.open("w")) {
            throw new Error("\u043d\u0435 \u0441\u043c\u043e\u0433 \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c launcher \u0432 Temp");
        }
        var cmd = '"' + python + '" "' + publishPy.fsName + '" --job "' + jobFile.fsName + '"';
        launcher.writeln('Set shell = CreateObject("WScript.Shell")');
        launcher.writeln('shell.CurrentDirectory = "' + vbsString(toolDir.fsName) + '"');
        launcher.writeln('shell.Run "' + vbsString(cmd) + '", 0, False');
        launcher.close();
        noteLog(toolDir, "[" + new Date().toString() + "] hidden " + title + " -> " + launcher.fsName);
        if (!launcher.execute()) {
            throw new Error("\u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b \u0441\u043a\u0440\u044b\u0442\u0443\u044e \u0437\u0430\u043b\u0438\u0432\u043a\u0443");
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
    var chosen = null;
    if (kind) {
        chosen = askWhere(info, kind);
        if (!chosen) return;
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

        var job = writeJob(doc.fullName.fsName, chosen ? chosen.target : "");
        var title = chosen ? chosen.code : (info.folderCode || info.fileCode || "Publisher");
        launchDetached(toolDir, job, title);
    } catch (e) {
        alertErr("\u041d\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u043b: " + e);
        return;
    }
})();
