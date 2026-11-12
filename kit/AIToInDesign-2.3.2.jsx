#target illustrator

(function () {
    var SCRIPT_NAME = "AIToInDesign";
    var EXPORT_VERSION = "2.3.2";

    // Кит Design Terminal ставит скрипт в панель Scripts InDesign (папка "AI to InDesign",
    // рядом paste-vectors.ps1 и extract-embedded-psd.py). Клик там → отдаём этот же файл Иллюстратору.
    if (!/illustrator/i.test(String(app.name))) {
        var selfPath = "";
        try { selfPath = new File($.fileName).fsName.replace(/\\/g, "/"); } catch (selfPathError) {}
        if (!selfPath || !BridgeTalk.getSpecifier("illustrator")) {
            alert("AIToInDesign runs in Illustrator.\nIllustrator is not installed on this computer.");
            return;
        }
        if (!BridgeTalk.isRunning("illustrator")) {
            alert("AIToInDesign: open Illustrator and the .ai file first, then run this script again.");
            return;
        }
        var handoff = new BridgeTalk();
        handoff.target = "illustrator";
        handoff.body = "$.evalFile(new File(" + selfPath.toSource() + "));";
        BridgeTalk.bringToFront("illustrator");
        handoff.send();
        return;
    }

    // Канон лежит в sandbox. Рядом с ним ищутся paste-vectors.ps1 и extract-embedded-psd.py,
    // а копия запущенного скрипта (AIToInDesign_used.jsx) уходит в папку сессии рядом с логами.
    // Запускатель на рабочем столе вызывает этот файл через $.evalFile.
    var SCRIPT_SOURCE_PATH = (function () {
        var canon = "C:/Users/Karen/Desktop/gitlab/design-terminal/sandbox/scripts/Illustrator - AIToInDesign/AIToInDesign.jsx";
        try { if (new File(canon).exists) { return canon; } } catch (canonError) {}
        try { return new File($.fileName).fsName.replace(/\\/g, "/"); } catch (selfError) {}
        return canon;
    })();
    var MM_PER_PT = 0.352777778;
    var PT_PER_MM = 1 / MM_PER_PT;
    var MAX_INLINE_PAYLOAD_CHARS = 180000;
    var BRIDGETALK_WAIT_SECONDS = 300;

    function main() {
        if (!app.documents.length) {
            alert("Open an Illustrator document first.");
            return;
        }

        var doc = app.activeDocument;
        // В режиме изоляции всё вне группы заблокировано: копирование векторов падает.
        // Выходим из него (это режим просмотра, рисунок не меняется).
        try { app.executeMenuCommand("exitFocus"); } catch (isolationError) {}
        var dialogResult = showArtboardDialog(doc);
        if (!dialogResult) {
            return;
        }

        var session = createSession(doc, dialogResult.artboardIndex);
        var report = createEmptyReport(doc, dialogResult.artboardIndex, session);
        var payload;
        initializeLog(session, doc, dialogResult.artboardIndex);
        logSession(session, "Start run.");
        copyScriptToSessionIfConfigured(session);
        createProgressUI(session);
        updateProgressUI(session, 0, "Preparing transfer...", 5);

        try {
            logSession(session, "Building payload...");
            updateProgressUI(session, 1, "Reading Illustrator objects...", 20);
            payload = buildPayload(doc, dialogResult.artboardIndex, report, session);
            logSession(session, "Payload built. textFrames=" + payload.textFrames.length + ", vectorItems=" + payload.vectorItems.length + ", imageItems=" + payload.imageItems.length);
            updateProgressUI(session, 2, "Connecting to InDesign...", 35);
            // Основной путь: Illustrator-driven action pipeline.
            // Он не отправляет огромный JSON в тело BridgeTalk (что часто даёт Syntax error),
            // а выполняет initDocument/createTextFrame/placeAsset/finalize по шагам.
            report.transportMode = "Illustrator-driven action pipeline";
            var target = BridgeTalk.getSpecifier("indesign");
            if (!target) {
                logSession(session, "InDesign specifier not found. Trying to launch InDesign.");
                BridgeTalk.launch("indesign");
                waitForBridgeTarget("indesign", session, 20);
                target = BridgeTalk.getSpecifier("indesign");
            }
            if (!target) {
                logSession(session, "Failed to resolve InDesign target.");
                throw new Error("InDesign is not available.");
            }
            logSession(session, "BridgeTalk target resolved: " + target);
            updateProgressUI(session, 3, "Starting text transfer...", 45);
            launchInDesignImport(session, report, payload);
        } catch (error) {
            logSession(session, "Fatal error in Illustrator: " + error.message);
            closeProgressUI(session);
            showSessionDialog(session, "Transfer failed", "The transfer failed. Open the temp folder for logs.");
        }
    }

    function readPresetArtboardIndex() {
        try {
            var flag = new File(Folder.temp.fsName + "/AIToInDesign_artboard.txt");
            if (!flag.exists) {
                return null;
            }
            flag.encoding = "UTF-8";
            flag.open("r");
            var text = flag.read();
            flag.close();
            try { flag.remove(); } catch (removeError) {}
            var index = parseInt(text, 10);
            if (isNaN(index)) {
                return null;
            }
            return index;
        } catch (error) {
            return null;
        }
    }

    function showArtboardDialog(doc) {
        var preset = readPresetArtboardIndex();
        if (preset !== null && preset >= 0 && preset < doc.artboards.length) {
            return {
                artboardIndex: preset
            };
        }

        var artboards = doc.artboards;
        var items = [];
        var i;

        for (i = 0; i < artboards.length; i++) {
            var ab = artboards[i];
            var rect = normalizeRect(ab.artboardRect);
            items.push((i + 1) + ". " + getArtboardName(ab, i) + " (" + round2(ptToMm(rect.width)) + " x " + round2(ptToMm(rect.height)) + " mm)");
        }

        var win = new Window("dialog", SCRIPT_NAME);
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];

        win.add("statictext", undefined, "Choose the artboard to transfer to InDesign:");
        var list = win.add("dropdownlist", undefined, items);
        list.selection = 0;

        var buttons = win.add("group");
        buttons.alignment = "right";
        var cancel = buttons.add("button", undefined, "Cancel");
        var ok = buttons.add("button", undefined, "Run", { name: "ok" });

        cancel.onClick = function () {
            win.close(0);
        };
        ok.onClick = function () {
            if (!list.selection) {
                alert("Choose an artboard.");
                return;
            }
            win.close(1);
        };

        if (win.show() !== 1) {
            return null;
        }

        return {
            artboardIndex: list.selection.index
        };
    }

    function createSession(doc, artboardIndex) {
        var stamp = buildTimestamp();
        var baseFolder = new Folder(Folder.temp.fsName + "/" + SCRIPT_NAME + "_" + sanitizeFileName(doc.name.replace(/\.[^\.]+$/, "")) + "_" + stamp + "_ab" + artboardIndex);
        var assetsFolder = new Folder(baseFolder.fsName + "/assets");

        ensureFolder(baseFolder);
        ensureFolder(assetsFolder);

        return {
            stamp: stamp,
            baseFolder: baseFolder,
            assetsFolder: assetsFolder,
            jsonFile: new File(baseFolder.fsName + "/payload.json"),
            actionScriptFile: new File(baseFolder.fsName + "/indesign-action.jsx"),
            logFile: new File(baseFolder.fsName + "/illustrator.log"),
            inDesignLogFile: new File(baseFolder.fsName + "/indesign.log"),
            cancelFile: new File(baseFolder.fsName + "/cancel.flag"),
            progressUI: null
        };
    }

    function createEmptyReport(doc, artboardIndex, session) {
        return {
            sourceDocument: doc.name,
            artboardIndex: artboardIndex,
            sessionFolder: session.baseFolder.fsName,
            exportedTextFrames: 0,
            exportedPathTextFrames: 0,
            exportedVectorItems: 0,
            exportedImageItems: 0,
            nativeVectorCandidates: 0,
            assetFallbacks: 0,
            skippedHidden: 0,
            skippedOutsideArtboard: 0,
            skippedUnsupported: 0,
            transportMode: "pending",
            transportFallbackUsed: false,
            warnings: []
        };
    }

    function buildPayload(doc, artboardIndex, report, session) {
        var artboard = doc.artboards[artboardIndex];
        var artboardRect = normalizeRect(artboard.artboardRect);
        var payload = {
            version: EXPORT_VERSION,
            sourceApplication: "Illustrator",
            sourceDocument: doc.name,
            generatedAt: new Date().toUTCString(),
            document: {
                colorSpace: doc.documentColorSpace == DocumentColorSpace.CMYK ? "CMYK" : "RGB",
                unit: "Millimeters"
            },
            artboard: {
                index: artboardIndex,
                name: getArtboardName(artboard, artboardIndex),
                left: ptToMm(artboardRect.left),
                top: ptToMm(artboardRect.top),
                width: ptToMm(artboardRect.width),
                height: ptToMm(artboardRect.height)
            },
            orderedItems: [],
            textFrames: [],
            vectorItems: [],
            imageItems: [],
            warnings: report.warnings,
            stats: report
        };

        logIllustratorLayerAudit(doc, artboardRect, session);
        ensureEmbeddedPsdIndex(session, doc);

        var pageItems = doc.pageItems;
        var i;
        for (i = 0; i < pageItems.length; i++) {
            var item = pageItems[i];
            if (!shouldProcessAsExportRoot(item)) {
                continue;
            }

            if (isHiddenItem(item)) {
                report.skippedHidden++;
                continue;
            }

            var itemBounds = getPreferredBounds(item);
            if (!itemBounds || !rectIntersects(itemBounds, artboardRect)) {
                report.skippedOutsideArtboard++;
                continue;
            }

            try {
                processExportItem(item, artboardRect, payload, report, session, i);
            } catch (exportError) {
                report.skippedUnsupported++;
                pushWarning(report, "Export failed for pageItem " + i + " (" + item.typename + "): " + exportError.message);
                logSession(session, "Export failed for pageItem " + i + " type=" + item.typename + ": " + exportError.message);
            }
        }

        return payload;
    }

    function logIllustratorLayerAudit(doc, artboardRect, session) {
        try {
            logSession(session, "=== Illustrator layer/pageItem audit start ===");
            logSession(session, "Artboard rect pt: left=" + round2(artboardRect.left) + ", top=" + round2(artboardRect.top) + ", right=" + round2(artboardRect.right) + ", bottom=" + round2(artboardRect.bottom));

            var layers = doc.layers;
            var li;
            for (li = 0; li < layers.length; li++) {
                var layer = layers[li];
                var layerLine = "LAYER[" + li + "] name=\"" + safeString(layer.name) + "\"";
                try { layerLine += " visible=" + safeBoolean(layer.visible); } catch (eVisible) {}
                try { layerLine += " locked=" + safeBoolean(layer.locked); } catch (eLocked) {}
                try { layerLine += " pageItems=" + layer.pageItems.length; } catch (eCount) {}
                logSession(session, layerLine);
            }

            var pageItems = doc.pageItems;
            var i;
            for (i = 0; i < pageItems.length; i++) {
                var item = pageItems[i];
                var debug = buildPageItemAuditLine(item, i, artboardRect);
                logSession(session, debug);
            }
            logSession(session, "=== Illustrator layer/pageItem audit end ===");
        } catch (error) {
            logSession(session, "Layer audit failed: " + error.message);
        }
    }

    function buildPageItemAuditLine(item, sourcePageItemIndex, artboardRect) {
        var parts = [];
        parts.push("ITEM[" + sourcePageItemIndex + "]");
        parts.push("type=" + safeString(item && item.typename));
        parts.push("name=\"" + safeItemName(item) + "\"");
        parts.push("layer=\"" + safeString(getItemLayerName(item)) + "\"");
        parts.push("parentPath=\"" + safeString(getItemParentPath(item)) + "\"");
        parts.push("hidden=" + safeBoolean(isHiddenItem(item)));
        parts.push("isRootCandidate=" + safeBoolean(shouldProcessAsExportRoot(item)));
        parts.push("skipReason=\"" + safeString(getExportRootSkipReason(item)) + "\"");

        var bounds = null;
        try {
            bounds = getPreferredBounds(item);
        } catch (eBounds) {}
        if (bounds) {
            var intersects = rectIntersects(bounds, artboardRect);
            parts.push("intersectsArtboard=" + safeBoolean(intersects));
            parts.push("boundsPt=[" + round2(bounds.left) + "," + round2(bounds.top) + "," + round2(bounds.right) + "," + round2(bounds.bottom) + "]");
        } else {
            parts.push("intersectsArtboard=false");
            parts.push("boundsPt=<none>");
        }

        try {
            if (item.typename == "GroupItem") {
                parts.push("groupClipped=" + safeBoolean(item.clipped));
                parts.push("containsRaster=" + safeBoolean(groupContainsRaster(item)));
                parts.push("nestedItems=" + item.pageItems.length);
            }
        } catch (eGroup) {}

        try {
            if (item.typename == "PlacedItem") {
                var hasFile = !!(item.file && item.file.exists);
                parts.push("placedHasLinkedFile=" + safeBoolean(hasFile));
                if (hasFile) {
                    parts.push("placedFile=\"" + safeString(item.file.fsName) + "\"");
                } else {
                    parts.push("placedFile=\"<embedded-or-missing>\"");
                }
            }
        } catch (ePlaced) {}

        return parts.join(" | ");
    }

    function getItemLayerName(item) {
        try {
            if (item && item.layer && item.layer.name !== undefined) {
                return item.layer.name;
            }
        } catch (error) {}
        return "";
    }

    function getItemParentPath(item) {
        var parts = [];
        var current = item;
        var guard = 0;
        while (current && current.parent && current.parent.typename && guard < 50) {
            guard++;
            var p = current.parent;
            parts.push(p.typename + ":" + safeString(p.name));
            current = p;
            if (p.typename == "Document") {
                break;
            }
        }
        return parts.join(" > ");
    }

    function getExportRootSkipReason(item) {
        if (!item || !item.typename) {
            return "invalid_item";
        }
        if (hasAncestorType(item, "CompoundPathItem")) {
            return "inside_compound_path";
        }
        if (insideClippedVectorGroup(item)) {
            return "inside_clipped_vector_group";
        }
        if (item.typename == "GroupItem") {
            return isClippedVectorGroup(item) ? "ok" : "group_container";
        }
        if (item.typename == "PathItem") {
            try {
                if (item.guides) return "guide_path";
                if (item.clipping) return "clipping_path";
            } catch (error) {}
        }
        return "ok";
    }

    function shouldProcessAsExportRoot(item) {
        if (!item || !item.typename) {
            return false;
        }

        if (hasAncestorType(item, "CompoundPathItem")) {
            return false;
        }

        // Векторы внутри маски, которая копируется целиком, отдельно не идут.
        if (insideClippedVectorGroup(item)) {
            return false;
        }

        // Контейнер группы не экспортируем: дети идут сами. Иначе один PSD внутри запекает всю группу в PNG.
        // Исключение — группа под маской только из векторов: её копируем целиком вместе с маской.
        if (item.typename == "GroupItem") {
            return isClippedVectorGroup(item);
        }

        if (item.typename == "PathItem" && (item.guides || item.clipping)) {
            return false;
        }

        return true;
    }

    function isInvisiblePath(item) {
        try {
            return item.typename == "PathItem" && !item.filled && !item.stroked && !item.clipping && !item.guides;
        } catch (error) {
            return false;
        }
    }

    function processExportItem(item, artboardRect, payload, report, session, sourcePageItemIndex) {
        var unlockState = unlockChain(item);
        try {
            switch (item.typename) {
                case "TextFrame":
                    var textItem = serializeTextFrame(item, artboardRect, report);
                    textItem.sourcePageItemIndex = sourcePageItemIndex;
                    if (isPathTextFrame(item) && !textItem.textOnPath) {
                        serializeVectorClipboardItem(item, artboardRect, payload, report, sourcePageItemIndex);
                        pushWarning(report, "Path text copied by paste because its path could not be read.");
                        break;
                    }
                    if (textItem.textOnPath) {
                        report.exportedPathTextFrames++;
                    }
                    payload.textFrames.push(textItem);
                    payload.orderedItems.push({
                        kind: "text",
                        id: textItem.id
                    });
                    report.exportedTextFrames++;
                    break;
                case "PathItem":
                    // Контур без заливки и обводки (служебная рамка под вылеты) копировать нечего:
                    // Иллюстратор не кладёт его в буфер, и раньше на его место вставлялся прошлый объект.
                    if (isInvisiblePath(item)) {
                        report.skippedHidden++;
                        logSession(session, "Skip invisible path (no fill, no stroke): pageItem " + sourcePageItemIndex + " " + safeItemName(item));
                        break;
                    }
                    serializeVectorClipboardItem(item, artboardRect, payload, report, sourcePageItemIndex);
                    break;
                case "CompoundPathItem":
                case "SymbolItem":
                case "MeshItem":
                case "PluginItem":
                case "GraphItem":
                    serializeVectorClipboardItem(item, artboardRect, payload, report, sourcePageItemIndex);
                    break;
                case "GroupItem":
                    if (isClippedVectorGroup(item)) {
                        serializeVectorClipboardItem(item, artboardRect, payload, report, sourcePageItemIndex);
                    }
                    break;
                case "RasterItem":
                case "PlacedItem":
                    // Картинка — только исходником: связанный файл как есть или те же пиксели из .ai.
                    // Перерендера (PNG) больше нет: если исходника нет — пропуск и [Mismatch] в логе.
                    serializeImageItem(item, artboardRect, payload, report, session);
                    break;
                default:
                    report.skippedUnsupported++;
                    pushWarning(report, "Skipped unsupported item type: " + item.typename);
                    break;
            }
        } finally {
            restoreUnlockChain(unlockState);
        }
    }

    function serializeTextFrame(textFrame, artboardRect, report) {
        // Текст в рамке ставится по самой рамке: её visibleBounds у Иллюстратора выше рамки
        // (на A1 на 1,2 мм), и первая строка уезжала вверх.
        var bounds = null;
        try {
            if (textFrame.kind == TextType.AREATEXT) {
                bounds = getGeometricBounds(textFrame);
            }
        } catch (kindError) {}
        if (!bounds) {
            bounds = getPreferredBounds(textFrame);
        }
        var textRange = null;
        var contents = "";
        var kind = null;
        var rotation = 0;
        var opacity = 100;
        var blendMode = null;
        try { textRange = textFrame.textRange; } catch (rangeError) {}
        try { contents = String(textFrame.contents); } catch (contentsError) {}
        try { kind = safeEnum(textFrame.kind); } catch (kindError) {}
        rotation = rotationFromItem(textFrame);
        try { opacity = safeNumber(textFrame.opacity, 100); } catch (opacityError) {}
        try { blendMode = safeEnum(textFrame.blendingMode); } catch (blendError) {}
        var manualKerning = [];
        var areaFrame = serializeAreaFrame(textFrame, artboardRect, rotation);
        var thread = readThreadInfo(textFrame);
        return {
            id: buildItemId("text"),
            name: safeItemName(textFrame),
            itemType: "TextFrame",
            frameKind: kind,
            textType: kind,
            // Важно: передаём текст в безопасной ASCII-форме, иначе BridgeTalk/ExtendScript
            // иногда портит кириллицу/казахский при передаче между приложениями.
            contents: encodeURIComponent(contents),
            bounds: boundsToMm(bounds, artboardRect),
            unrotatedWidth: areaFrame && areaFrame.width ? areaFrame.width : readUnrotatedMm(textFrame, "width"),
            unrotatedHeight: areaFrame && areaFrame.height ? areaFrame.height : readUnrotatedMm(textFrame, "height"),
            textOnPath: serializeTextOnPath(textFrame, artboardRect, report),
            anchor: readPointTextAnchor(textFrame, artboardRect),
            matrix: readItemMatrix(textFrame),
            orientation: readTextOrientation(textFrame),
            areaFrame: areaFrame,
            thread: thread,
            groups: readGroupChain(textFrame, artboardRect, false),
            aiOverset: !!(areaFrame && !(thread && thread.hasNext) && isTextOversetInIllustrator(textFrame, contents)),
            rotation: rotation,
            shear: 0,
            opacity: opacity,
            blendMode: blendMode,
            defaultCharacterStyle: serializeCharacterAttributes(textRange, report),
            paragraphStyles: serializeParagraphAttributes(textFrame, report),
            characterRuns: serializeCharacterRuns(textFrame, report, manualKerning),
            manualKerning: manualKerning,
            note: "Text is transferred with best-effort character and paragraph attributes."
        };
    }

    function readItemMatrix(item) {
        try {
            var m = item.matrix;
            return { a: Number(m.mValueA), b: Number(m.mValueB), c: Number(m.mValueC), d: Number(m.mValueD) };
        } catch (matrixError) {
            return null;
        }
    }

    function readTextOrientation(textFrame) {
        try {
            if (textFrame.orientation == TextOrientation.VERTICAL) {
                return "VERTICAL";
            }
        } catch (orientationError) {}
        return "HORIZONTAL";
    }

    // Рамка текста в рамке: колонки, отступ, первая строка и форма (контур в мм страницы,
    // уже без поворота рамки — поворот ставится отдельно). Для точечного текста и текста по контуру — null.
    function serializeAreaFrame(textFrame, artboardRect, rotation) {
        var kindOk = false;
        try { kindOk = textFrame.kind == TextType.AREATEXT; } catch (kindError) {}
        if (!kindOk) {
            return null;
        }
        var result = {
            columnCount: readNumAttr(textFrame, "columnCount"),
            columnGutterMm: readMeasureMm(textFrame, "columnGutter"),
            rowCount: readNumAttr(textFrame, "rowCount"),
            rowGutterMm: readMeasureMm(textFrame, "rowGutter"),
            insetMm: readMeasureMm(textFrame, "spacing"),
            firstBaseline: safeEnum(readAttr(textFrame, "firstBaseline")),
            firstBaselineMinMm: readMeasureMm(textFrame, "firstBaselineMin"),
            points: null,
            isRect: false,
            width: null,
            height: null
        };
        var pts = null;
        try { pts = textFrame.textPath.pathPoints; } catch (pathError) { pts = null; }
        if (!pts || !pts.length) {
            return result;
        }
        // Снимаем поворот рамки вокруг центра её габаритов: получаем форму «как до поворота».
        var raw = [];
        var i;
        for (i = 0; i < pts.length; i++) {
            try {
                raw.push({
                    anchor: pointToMm(pts[i].anchor, artboardRect),
                    leftDirection: pointToMm(pts[i].leftDirection, artboardRect),
                    rightDirection: pointToMm(pts[i].rightDirection, artboardRect)
                });
            } catch (pointError) {}
        }
        if (!raw.length) {
            return result;
        }
        var minX = raw[0].anchor.x, maxX = minX, minY = raw[0].anchor.y, maxY = minY;
        for (i = 0; i < raw.length; i++) {
            minX = Math.min(minX, raw[i].anchor.x); maxX = Math.max(maxX, raw[i].anchor.x);
            minY = Math.min(minY, raw[i].anchor.y); maxY = Math.max(maxY, raw[i].anchor.y);
        }
        var center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        var spin = (typeof rotation === "number" && isFinite(rotation)) ? rotation : 0;
        var flat = [];
        for (i = 0; i < raw.length; i++) {
            flat.push({
                anchor: unrotateMm(raw[i].anchor, center, spin),
                leftDirection: unrotateMm(raw[i].leftDirection, center, spin),
                rightDirection: unrotateMm(raw[i].rightDirection, center, spin)
            });
        }
        result.points = flat;
        result.center = center;
        var fx0 = flat[0].anchor.x, fx1 = fx0, fy0 = flat[0].anchor.y, fy1 = fy0;
        var corners = true;
        for (i = 0; i < flat.length; i++) {
            fx0 = Math.min(fx0, flat[i].anchor.x); fx1 = Math.max(fx1, flat[i].anchor.x);
            fy0 = Math.min(fy0, flat[i].anchor.y); fy1 = Math.max(fy1, flat[i].anchor.y);
            if (Math.abs(flat[i].leftDirection.x - flat[i].anchor.x) > 0.01 || Math.abs(flat[i].leftDirection.y - flat[i].anchor.y) > 0.01 ||
                Math.abs(flat[i].rightDirection.x - flat[i].anchor.x) > 0.01 || Math.abs(flat[i].rightDirection.y - flat[i].anchor.y) > 0.01) {
                corners = false;
            }
        }
        result.width = fx1 - fx0;
        result.height = fy1 - fy0;
        if (corners && flat.length == 4) {
            var onEdges = true;
            for (i = 0; i < 4; i++) {
                var px = flat[i].anchor.x, py = flat[i].anchor.y;
                if (!((Math.abs(px - fx0) < 0.05 || Math.abs(px - fx1) < 0.05) && (Math.abs(py - fy0) < 0.05 || Math.abs(py - fy1) < 0.05))) {
                    onEdges = false;
                }
            }
            result.isRect = onEdges;
        }
        return result;
    }

    // Поворот против часовой (как в Иллюстраторе) в мм страницы, где y растёт вниз; снимаем его.
    function unrotateMm(p, c, degrees) {
        var rad = -degrees * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var dx = p.x - c.x, dy = p.y - c.y;
        return { x: c.x + dx * cos + dy * sin, y: c.y - dx * sin + dy * cos };
    }

    function textFrameSignature(textFrame) {
        var b = textFrame.geometricBounds;
        return Math.round(b[0] * 10) + ":" + Math.round(b[1] * 10) + ":" + Math.round(b[2] * 10) + ":" + Math.round(b[3] * 10);
    }

    // Связанные рамки: ключ цепочки (габариты первой рамки) и номер рамки в ней.
    // У последней рамки Иллюстратор возвращает nextFrame = она сама.
    function readThreadInfo(textFrame) {
        var kindOk = false;
        try { kindOk = textFrame.kind == TextType.AREATEXT; } catch (kindError) {}
        if (!kindOk) {
            return null;
        }
        var mine = null, prev = null, next = null, hasNext = false;
        try { mine = textFrameSignature(textFrame); } catch (sigError) { return null; }
        try { prev = textFrame.previousFrame; } catch (prevError) { prev = null; }
        try { next = textFrame.nextFrame; } catch (nextError) { next = null; }
        try { hasNext = !!next && textFrameSignature(next) != mine; } catch (nextSigError) { hasNext = false; }
        if (!prev && !hasNext) {
            return null;
        }
        var head = textFrame;
        var index = 0;
        var guard = 0;
        while (guard < 500) {
            guard++;
            var p = null;
            try { p = head.previousFrame; } catch (walkError) { p = null; }
            if (!p) {
                break;
            }
            head = p;
            index++;
        }
        var key = mine;
        try { key = textFrameSignature(head); } catch (headError) {}
        return { key: key, index: index, hasNext: hasNext };
    }

    // Текст не влез в рамку уже в Иллюстраторе: видимые строки короче содержимого.
    // Тогда в InDesign рамку не растим — лишнее так и остаётся скрытым, как в макете.
    function isTextOversetInIllustrator(textFrame, contents) {
        var visible = 0;
        var paragraphs = 1;
        try {
            var lines = textFrame.lines;
            var i;
            for (i = 0; i < lines.length; i++) {
                visible += lines[i].length;
            }
        } catch (linesError) {
            return false;
        }
        try { paragraphs = textFrame.paragraphs.length; } catch (paragraphsError) {}
        return visible + paragraphs < String(contents).length;
    }

    function isPathTextFrame(textFrame) {
        try {
            if (textFrame.kind == TextType.PATHTEXT) {
                return true;
            }
        } catch (error) {}
        var kind = null;
        try { kind = safeEnum(textFrame.kind); } catch (kindError) {}
        return !!(kind && String(kind).toUpperCase().indexOf("PATH") !== -1);
    }

    function serializeTextOnPath(textFrame, artboardRect, report) {
        if (!isPathTextFrame(textFrame)) {
            return null;
        }

        var textPath = null;
        try {
            textPath = textFrame.textPath;
        } catch (error) {
            textPath = null;
        }
        if (!textPath) {
            pushWarning(report, "Path text has no textPath. It will be placed as a regular text frame.");
            return null;
        }

        var pathPoints = null;
        try {
            pathPoints = textPath.pathPoints;
        } catch (error2) {
            pathPoints = null;
        }
        if (!pathPoints || !pathPoints.length) {
            pushWarning(report, "Path text geometry is empty. It will be placed as a regular text frame.");
            return null;
        }

        var points = [];
        var i;
        for (i = 0; i < pathPoints.length; i++) {
            try {
                points.push({
                    anchor: pointToMm(pathPoints[i].anchor, artboardRect),
                    leftDirection: pointToMm(pathPoints[i].leftDirection, artboardRect),
                    rightDirection: pointToMm(pathPoints[i].rightDirection, artboardRect),
                    pointType: safeEnum(pathPoints[i].pointType)
                });
            } catch (pointError) {}
        }

        var closed = false;
        var polarity = null;
        var stroked = false;
        var filled = false;
        var strokeWidth = 0;
        try { closed = !!textPath.closed; } catch (errorClosed) {}
        try { polarity = safeEnum(textPath.polarity); } catch (errorPolarity) {}
        try { stroked = !!textPath.stroked; } catch (errorStroked) {}
        try { filled = !!textPath.filled; } catch (errorFilled) {}
        try { strokeWidth = safeNumber(textPath.strokeWidth, 0); } catch (errorWidth) {}

        return {
            // Где на контуре начинается и кончается текст: целая часть — номер сегмента, дробная — доля в нём.
            startT: readNumAttr(textFrame, "startTValue"),
            endT: readNumAttr(textFrame, "endTValue"),
            closed: closed,
            polarity: polarity,
            stroked: stroked,
            filled: filled,
            strokeWidthMm: ptToMm(strokeWidth || 0),
            strokeColor: stroked ? serializeColor(textPath.strokeColor, report) : null,
            fillColor: filled ? serializeColor(textPath.fillColor, report) : null,
            points: points
        };
    }

    function hasGroupAncestor(item) {
        var parent = item ? item.parent : null;
        var guard = 0;
        while (parent && parent.typename && guard < 50) {
            guard++;
            if (parent.typename == "GroupItem") {
                return true;
            }
            if (parent.typename == "Layer" || parent.typename == "Document") {
                return false;
            }
            parent = parent.parent;
        }
        return false;
    }

    function groupHasVectorArtwork(item) {
        if (!item || !item.typename) {
            return false;
        }
        if (item.typename == "TextFrame") {
            return false;
        }
        if (item.typename == "GroupItem") {
            var i;
            for (i = 0; i < item.pageItems.length; i++) {
                if (groupHasVectorArtwork(item.pageItems[i])) {
                    return true;
                }
            }
            return false;
        }
        if (item.typename == "PathItem") {
            try {
                if (item.guides || item.clipping) {
                    return false;
                }
            } catch (error) {}
        }
        return true;
    }

    function itemContainsTextFrame(item) {
        if (!item || !item.typename) {
            return false;
        }
        if (item.typename == "TextFrame") {
            return true;
        }
        if (item.typename != "GroupItem") {
            return false;
        }
        var i;
        for (i = 0; i < item.pageItems.length; i++) {
            if (itemContainsTextFrame(item.pageItems[i])) {
                return true;
            }
        }
        return false;
    }

    function removeTextFramesDeep(item) {
        if (!item || item.typename != "GroupItem") {
            return;
        }
        var i;
        for (i = item.pageItems.length - 1; i >= 0; i--) {
            var child = item.pageItems[i];
            if (!child || !child.typename) {
                continue;
            }
            if (child.typename == "TextFrame") {
                try { child.remove(); } catch (error) {}
            } else if (child.typename == "GroupItem") {
                removeTextFramesDeep(child);
            }
        }
    }

    // Раны одинаковых атрибутов по символам. Индексы — как у Иллюстратора (UTF-16: эмодзи = 2 символа).
    // Ручной кернинг собирается отдельно в kerningOut: у Иллюстратора он стоит на символе ПОСЛЕ пары,
    // в InDesign — на символе ДО пары; переводит импорт.
    function serializeCharacterRuns(textFrame, report, kerningOut) {
        var characters = null;
        var runs = [];
        try { characters = textFrame.textRange.characters; } catch (charactersError) { return runs; }
        if (!characters || !characters.length) {
            return runs;
        }

        var firstCharacter = null;
        try { firstCharacter = characters[0]; } catch (firstError) { return runs; }
        if (!firstCharacter) {
            return runs;
        }

        var startIndex = 0;
        var previous = serializeCharacterAttributes(firstCharacter, report);
        var i;
        for (i = 1; i < characters.length; i++) {
            var character = null;
            try { character = characters[i]; } catch (characterError) { break; }
            if (!character) {
                break;
            }
            if (kerningOut) {
                // Без ручного кернинга Иллюстратор бросает «There is no manual kerning amount set».
                try {
                    var manual = character.kerning;
                    if (isFinite(manual)) {
                        kerningOut.push({ index: i, value: Number(manual) });
                    }
                } catch (noManualKerning) {}
            }
            var current = serializeCharacterAttributes(character, report);
            if (!areObjectsEqual(previous, current)) {
                runs.push({
                    start: startIndex,
                    end: i - 1,
                    attributes: previous
                });
                startIndex = i;
                previous = current;
            }
        }

        runs.push({
            start: startIndex,
            end: characters.length - 1,
            attributes: previous
        });

        return runs;
    }

    // Атрибуты абзацев. start — смещение первого символа абзаца внутри этой рамки (как у Иллюстратора):
    // по нему импорт находит абзац, а не по номеру — Иллюстратор считает Shift+Enter (U+0003)
    // концом абзаца, а InDesign — переводом строки внутри абзаца.
    // У пустого абзаца Иллюстратор бросает Illegal Argument на любом атрибуте — такие пропускаем.
    function serializeParagraphAttributes(textFrame, report) {
        var paragraphs = null;
        var result = [];
        var i;
        try { paragraphs = textFrame.paragraphs; } catch (paragraphsError) { return result; }
        if (!paragraphs) {
            return result;
        }
        var count = 0;
        try { count = paragraphs.length; } catch (countError) { return result; }
        var frameStart = 0;
        try { frameStart = textFrame.textRange.characterOffset - 1; } catch (offsetError) { frameStart = 0; }

        for (i = 0; i < count; i++) {
            var p = null;
            try { p = paragraphs[i]; } catch (paragraphError) { continue; }
            if (!p) {
                continue;
            }
            var length = 0;
            try { length = p.length; } catch (lengthError) { length = 0; }
            if (!(length > 0)) {
                continue;
            }
            var start = null;
            try { start = p.characterOffset - 1 - frameStart; } catch (startError) { start = null; }
            var attrs = null;
            try {
                attrs = p.paragraphAttributes;
            } catch (error) {
                attrs = null;
            }

            if (!attrs) {
                continue;
            }

            result.push({
                index: i,
                start: start,
                length: length,
                attributes: {
                    justification: safeEnum(readAttr(attrs, "justification")),
                    firstLineIndent: readNumAttr(attrs, "firstLineIndent"),
                    leftIndent: readNumAttr(attrs, "leftIndent"),
                    rightIndent: readNumAttr(attrs, "rightIndent"),
                    spaceBefore: readNumAttr(attrs, "spaceBefore"),
                    spaceAfter: readNumAttr(attrs, "spaceAfter"),
                    autoLeadingAmount: readNumAttr(attrs, "autoLeadingAmount"),
                    hyphenation: readBoolAttr(attrs, "hyphenation"),
                    hyphenateCapitalizedWords: readBoolAttr(attrs, "hyphenateCapitalizedWords"),
                    hyphenationZoneMm: readMeasureMm(attrs, "hyphenationZone"),
                    maximumConsecutiveHyphens: readNumAttr(attrs, "maximumConsecutiveHyphens"),
                    minimumBeforeHyphen: readNumAttr(attrs, "minimumBeforeHyphen"),
                    minimumAfterHyphen: readNumAttr(attrs, "minimumAfterHyphen"),
                    minimumHyphenatedWordSize: readNumAttr(attrs, "minimumHyphenatedWordSize"),
                    everyLineComposer: readBoolAttr(attrs, "everyLineComposer"),
                    desiredWordSpacing: readNumAttr(attrs, "desiredWordSpacing"),
                    minimumWordSpacing: readNumAttr(attrs, "minimumWordSpacing"),
                    maximumWordSpacing: readNumAttr(attrs, "maximumWordSpacing"),
                    desiredLetterSpacing: readNumAttr(attrs, "desiredLetterSpacing"),
                    minimumLetterSpacing: readNumAttr(attrs, "minimumLetterSpacing"),
                    maximumLetterSpacing: readNumAttr(attrs, "maximumLetterSpacing"),
                    desiredGlyphScaling: readNumAttr(attrs, "desiredGlyphScaling"),
                    minimumGlyphScaling: readNumAttr(attrs, "minimumGlyphScaling"),
                    maximumGlyphScaling: readNumAttr(attrs, "maximumGlyphScaling"),
                    singleWordJustification: safeEnum(readAttr(attrs, "singleWordJustification")),
                    tabStops: serializeTabStops(readAttr(attrs, "tabStops"))
                }
            });
        }

        return result;
    }

    // Табуляция: позиция в pt от левого края рамки, выключка, заполнитель, символ для «по символу».
    function serializeTabStops(stops) {
        var result = [];
        if (!stops) {
            return result;
        }
        var count = 0;
        try { count = stops.length; } catch (countError) { return result; }
        var i;
        for (i = 0; i < count; i++) {
            var stop = null;
            try { stop = stops[i]; } catch (stopError) { continue; }
            if (!stop) {
                continue;
            }
            result.push({
                alignment: safeEnum(readAttr(stop, "alignment")),
                positionPt: readNumAttr(stop, "position"),
                leader: safeString(readAttr(stop, "leader")),
                decimalCharacter: safeString(readAttr(stop, "decimalCharacter"))
            });
        }
        return result;
    }

    function readBoolAttr(obj, name) {
        try {
            var value = obj[name];
            if (value === true || value === false) {
                return value;
            }
        } catch (error) {}
        return null;
    }

    function readNumAttr(obj, name) {
        try {
            var value = obj[name];
            if (isFinite(value)) {
                return Number(value);
            }
        } catch (error) {}
        return null;
    }

    function readMeasureMm(obj, name) {
        var points = readNumAttr(obj, name);
        if (points === null) {
            return null;
        }
        return ptToMm(points);
    }

    function readAttr(obj, name) {
        try {
            return obj[name];
        } catch (error) {
            return null;
        }
    }

    function serializeCharacterAttributes(textRangeLike, report) {
        var attrs = null;
        try {
            attrs = textRangeLike.characterAttributes;
        } catch (error) {
            attrs = null;
        }

        if (!attrs) {
            return {};
        }

        var fontFamily = null;
        var fontStyle = null;
        var fontName = null;
        try {
            if (attrs.textFont) {
                fontName = safeString(attrs.textFont.name);
                // Как в AiToJSON: family и style через decodeURIComponent для совместимости с InDesign itemByName
                fontFamily = attrs.textFont.family != null ? decodeURIComponent(String(attrs.textFont.family)) : null;
                fontStyle = attrs.textFont.style != null ? decodeURIComponent(String(attrs.textFont.style)) : null;
            }
        } catch (error2) {}

        // Ручной кернинг сюда не входит: он между парой символов, его собирает serializeCharacterRuns.
        return {
            fontName: fontName,
            fontFamily: fontFamily,
            fontStyle: fontStyle,
            variableAxes: parseVariableAxes(fontName, fontStyle),
            fontSize: safeNumber(readAttr(attrs, "size")),
            leading: safeNumber(readAttr(attrs, "leading")),
            autoLeading: safeBoolean(readAttr(attrs, "autoLeading")),
            tracking: safeNumber(readAttr(attrs, "tracking")),
            kerningMethod: safeEnum(readAttr(attrs, "kerningMethod")),
            horizontalScale: safeNumber(readAttr(attrs, "horizontalScale")),
            verticalScale: safeNumber(readAttr(attrs, "verticalScale")),
            baselineShift: safeNumber(readAttr(attrs, "baselineShift")),
            baselinePosition: safeEnum(readAttr(attrs, "baselinePosition")),
            openTypePosition: safeEnum(readAttr(attrs, "openTypePosition")),
            capitalization: safeEnum(readAttr(attrs, "capitalization")),
            ligature: safeBoolean(readAttr(attrs, "ligature")),
            discretionaryLigature: safeBoolean(readAttr(attrs, "discretionaryLigature")),
            contextualLigature: safeBoolean(readAttr(attrs, "contextualLigature")),
            fractions: safeBoolean(readAttr(attrs, "fractions")),
            ordinals: safeBoolean(readAttr(attrs, "ordinals")),
            swash: safeBoolean(readAttr(attrs, "swash")),
            titling: safeBoolean(readAttr(attrs, "titling")),
            stylisticAlternates: safeBoolean(readAttr(attrs, "stylisticAlternates")),
            figureStyle: safeEnum(readAttr(attrs, "figureStyle")),
            noBreak: safeBoolean(readAttr(attrs, "noBreak")),
            characterRotation: safeNumber(readAttr(attrs, "rotation")),
            underline: safeBoolean(readAttr(attrs, "underline")),
            strikeThrough: safeBoolean(readAttr(attrs, "strikeThrough")),
            language: safeEnum(readAttr(attrs, "language")),
            fillColor: serializeColor(readAttr(attrs, "fillColor"), report),
            strokeColor: serializeColor(readAttr(attrs, "strokeColor"), report),
            strokeWeight: safeNumber(readAttr(attrs, "strokeWeight")),
            overprintFill: safeBoolean(readAttr(attrs, "overprintFill")),
            overprintStroke: safeBoolean(readAttr(attrs, "overprintStroke"))
        };
    }

    function serializePathOrFallback(item, artboardRect, payload, report, session, sourcePageItemIndex) {
        skipVectorExport(item, report);
    }

    function parseVariableAxes(fontName, fontStyle) {
        var axes = {};
        var source = safeString(fontName) || "";
        var regex = /([0-9]+(?:\.[0-9]+)?)(wght|wdth|slnt|ital|opsz)/ig;
        var match;

        while ((match = regex.exec(source)) !== null) {
            axes[String(match[2]).toLowerCase()] = Number(match[1]);
        }

        if (axes.wght === undefined) {
            var inferredWeight = inferWeightFromStyle(fontStyle);
            if (inferredWeight !== null) {
                axes.wght = inferredWeight;
            }
        }

        if (axes.wdth === undefined) {
            var inferredWidth = inferWidthFromStyle(fontStyle);
            if (inferredWidth !== null) {
                axes.wdth = inferredWidth;
            }
        }

        return hasOwnKeys(axes) ? axes : null;
    }

    function inferWeightFromStyle(fontStyle) {
        var style = String(fontStyle || "").toLowerCase();
        if (!style) return null;
        if (style.indexOf("thin") !== -1) return 100;
        if (style.indexOf("extralight") !== -1 || style.indexOf("extra light") !== -1) return 200;
        if (style.indexOf("light") !== -1) return 300;
        if (style.indexOf("regular") !== -1 || style.indexOf("normal") !== -1) return 400;
        if (style.indexOf("medium") !== -1) return 500;
        if (style.indexOf("semibold") !== -1 || style.indexOf("semi bold") !== -1 || style.indexOf("demibold") !== -1) return 600;
        if (style.indexOf("bold") !== -1) return 700;
        if (style.indexOf("extrabold") !== -1 || style.indexOf("extra bold") !== -1) return 800;
        if (style.indexOf("black") !== -1 || style.indexOf("heavy") !== -1) return 900;
        return null;
    }

    function inferWidthFromStyle(fontStyle) {
        var style = String(fontStyle || "").toLowerCase();
        if (!style) return null;
        if (style.indexOf("narrow") !== -1) return 200;
        if (style.indexOf("condensed") !== -1) return 200;
        if (style.indexOf("expanded") !== -1) return 120;
        return null;
    }

    function hasOwnKeys(obj) {
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                return true;
            }
        }
        return false;
    }

    function serializeCompoundPathOrFallback(item, artboardRect, payload, report, session, sourcePageItemIndex) {
        skipVectorExport(item, report);
    }

    function serializeClippingGroupOrFallback(group, artboardRect, payload, report, session, sourcePageItemIndex) {
        // Если в группе есть растр (в том числе внутри clipped group), переносим группу как linked asset.
        // Иначе такие элементы теряются на raster-этапе и скрипт сразу предлагает векторы.
        if (groupContainsRaster(group)) {
            serializeDirectPlacedAsset(group, artboardRect, payload, report, session, "psd", "raster_group", false);
            return;
        }

        skipVectorExport(group, report);
    }

    function serializeRasterOrFallback(item, artboardRect, payload, report, session, format, sourcePageItemIndex) {
        // Всегда выводим растр во временный файл и переносим как linked asset.
        // Это покрывает как linked, так и embedded исходники из Illustrator.
        serializeDirectPlacedAsset(item, artboardRect, payload, report, session, format, "raster_item", false);
    }

    function skipVectorExport(item, report) {
        // Векторный экспорт отключён: элемент намеренно пропускается без предупреждения.
    }

    // Градиент заливки. Через буфер (AICB) InDesign получает форму без заливки, а прозрачные точки
    // Иллюстратор вообще растрирует. Поэтому описываем градиент целиком и в InDesign ставим его нативно:
    // те же цвета и точки, начало/угол/длина в мм страницы, прозрачность точек — растушёвкой.
    function readFillGradient(item, artboardRect, report) {
        var path = item;
        try {
            if (item.typename == "CompoundPathItem") {
                path = item.pathItems.length ? item.pathItems[0] : null;
            }
            if (!path || path.typename != "PathItem" || !path.filled) {
                return null;
            }
            var gc = path.fillColor;
            if (!gc || gc.typename != "GradientColor") {
                return null;
            }
            var gradient = gc.gradient;
            var radial = false;
            try { radial = gradient.type == GradientType.RADIAL; } catch (typeError) {}
            var origin = [gc.origin[0], gc.origin[1]];
            var lengthPt = safeNumber(gc.length, 0);
            var rad = safeNumber(gc.angle, 0) * Math.PI / 180;
            var end = [origin[0] + Math.cos(rad) * lengthPt, origin[1] + Math.sin(rad) * lengthPt];
            var matrixApplied = false;
            try {
                var m = gc.matrix;
                var identity = Math.abs(m.mValueA - 1) < 1e-6 && Math.abs(m.mValueB) < 1e-6 && Math.abs(m.mValueC) < 1e-6 &&
                    Math.abs(m.mValueD - 1) < 1e-6 && Math.abs(m.mValueTX) < 1e-6 && Math.abs(m.mValueTY) < 1e-6;
                if (!identity) {
                    origin = [m.mValueA * origin[0] + m.mValueC * origin[1] + m.mValueTX, m.mValueB * origin[0] + m.mValueD * origin[1] + m.mValueTY];
                    end = [m.mValueA * end[0] + m.mValueC * end[1] + m.mValueTX, m.mValueB * end[0] + m.mValueD * end[1] + m.mValueTY];
                    matrixApplied = true;
                }
            } catch (matrixError) {}
            var o = pointToMm(origin, artboardRect);
            var e = pointToMm(end, artboardRect);
            var stops = [];
            var hasOpacity = false;
            var k;
            for (k = 0; k < gradient.gradientStops.length; k++) {
                var stop = gradient.gradientStops[k];
                var stopOpacity = safeNumber(stop.opacity, 100);
                if (stopOpacity < 99.5) {
                    hasOpacity = true;
                }
                stops.push({
                    ramp: safeNumber(stop.rampPoint, 0),
                    mid: safeNumber(stop.midPoint, 50),
                    opacity: stopOpacity,
                    color: serializeColor(stop.color, report)
                });
            }
            if (stops.length < 2) {
                return null;
            }
            return {
                type: radial ? "radial" : "linear",
                origin: o,
                angle: Math.atan2(-(e.y - o.y), e.x - o.x) * 180 / Math.PI,
                length: Math.sqrt((e.x - o.x) * (e.x - o.x) + (e.y - o.y) * (e.y - o.y)),
                stops: stops,
                hasOpacity: hasOpacity,
                matrixApplied: matrixApplied
            };
        } catch (error) {
            pushWarning(report, "Gradient fill unreadable for " + safeItemName(item) + ": " + error.message);
            return null;
        }
    }

    function readPointTextAnchor(textFrame, artboardRect) {
        try {
            if (textFrame.kind != TextType.POINTTEXT) {
                return null;
            }
            var anchor = textFrame.anchor;
            if (!anchor || anchor.length < 2) {
                return null;
            }
            return pointToMm(anchor, artboardRect);
        } catch (error) {
            return null;
        }
    }

    function serializeVectorClipboardItem(item, artboardRect, payload, report, sourcePageItemIndex) {
        var sourceUuid = null;
        try {
            sourceUuid = item.uuid ? String(item.uuid) : null;
        } catch (uuidError) {
            sourceUuid = null;
        }

        var rotation = 0;
        var opacity = 100;
        var blendMode = null;
        try { rotation = safeNumber(item.rotation, 0); } catch (rotationError) {}
        try { opacity = safeNumber(item.opacity, 100); } catch (opacityError) {}
        try { blendMode = safeEnum(item.blendingMode); } catch (blendError) {}

        var vectorRef = {
            id: buildItemId("vectorRef"),
            itemType: "VectorClipboardItem",
            sourcePageItemIndex: sourcePageItemIndex,
            sourceUuid: sourceUuid,
            sourceType: item.typename,
            // У группы под маской InDesign вставляет уже обрезанное — габариты по контуру маски.
            bounds: boundsToMm(clippedGroupBounds(item) || getGeometricBounds(item) || getPreferredBounds(item), artboardRect),
            visibleBounds: boundsToMm(clippedGroupBounds(item) || getPreferredBounds(item) || getGeometricBounds(item), artboardRect),
            unrotatedWidth: readUnrotatedMm(item, "width"),
            unrotatedHeight: readUnrotatedMm(item, "height"),
            rotation: rotation,
            opacity: opacity,
            blendMode: blendMode,
            name: safeItemName(item),
            groups: readGroupChain(item, artboardRect, false),
            fillGradient: readFillGradient(item, artboardRect, report)
        };

        payload.vectorItems.push(vectorRef);
        payload.orderedItems.push({
            kind: "vector",
            id: vectorRef.id
        });
        report.exportedVectorItems++;
    }

    function serializeAssetFallback(item, artboardRect, payload, report, session, format, reason) {
        if (!session.allowAssetFallback) {
            report.skippedUnsupported++;
            pushWarning(report, "Asset fallback disabled for " + safeItemName(item) + " (" + reason + ")");
            return;
        }

        var assetInfo = exportItemAsset(item, session, format, report, reason);
        if (!assetInfo) {
            report.skippedUnsupported++;
            pushWarning(report, "Failed to export asset fallback for " + safeItemName(item) + " (" + reason + ")");
            return;
        }

        payload.imageItems.push({
            id: buildItemId("asset"),
            itemType: "PlacedAsset",
            assetType: "PSD",
            reason: reason,
            assetPath: assetInfo.file.fsName,
            bounds: boundsToMm(getPreferredBounds(item), artboardRect),
            rotation: safeNumber(item.rotation, 0),
            opacity: safeNumber(item.opacity, 100),
            blendMode: safeEnum(item.blendingMode)
        });
        payload.orderedItems.push({
            kind: "asset",
            id: payload.imageItems[payload.imageItems.length - 1].id
        });

        report.assetFallbacks++;
        report.exportedImageItems++;
    }

    function readTextFile(file) {
        file.encoding = "UTF-8";
        file.open("r");
        var text = file.read();
        file.close();
        return text;
    }

    function ensureEmbeddedPsdIndex(session, doc) {
        if (session.embeddedPsdIndex) {
            return session.embeddedPsdIndex;
        }
        session.embeddedPsdIndex = [];
        var pySource = new File(String(SCRIPT_SOURCE_PATH).replace(/[^\/]+$/, "extract-embedded-psd.py"));
        if (!pySource.exists) {
            logSession(session, "Embedded PSD assembler missing: " + pySource.fsName);
            return session.embeddedPsdIndex;
        }
        var aiPath = "";
        try { aiPath = doc.fullName.fsName; } catch (pathError) {}
        if (!aiPath) {
            logSession(session, "Document is unsaved, embedded pixels cannot be read.");
            return session.embeddedPsdIndex;
        }
        var pyLocal = new File(session.baseFolder.fsName + "/extract-embedded-psd.py");
        pySource.copy(pyLocal.fsName);
        var result = new File(session.baseFolder.fsName + "/embedded-images.json");
        if (result.exists) {
            try { result.remove(); } catch (removeError) {}
        }
        var args = new File(session.baseFolder.fsName + "/extract-args.txt");
        args.encoding = "UTF-8";
        args.open("w");
        args.writeln(aiPath);
        args.writeln(session.assetsFolder.fsName);
        args.writeln(result.fsName);
        args.close();
        var bat = new File(session.baseFolder.fsName + "/extract-psd.bat");
        bat.encoding = "UTF-8";
        bat.open("w");
        var pythonCommand = resolvePythonCommand();
        bat.writeln("@echo off");
        bat.writeln(pythonCommand + " \"" + pyLocal.fsName + "\" --args \"" + args.fsName + "\"");
        // Python нет или упал → сразу пустой ответ с ошибкой, а не ожидание 90 секунд.
        bat.writeln("if not exist \"" + result.fsName + "\" echo {\"images\":[],\"error\":\"python failed or not installed: " + pythonCommand.replace(/["\\]/g, "/") + "\"}> \"" + result.fsName + "\"");
        bat.close();
        logSession(session, "Assembling PSD from embedded pixels in " + aiPath + " (python: " + pythonCommand + ")");
        bat.execute();
        var i;
        for (i = 0; i < 180; i++) {
            if (result.exists && result.length > 2) {
                break;
            }
            $.sleep(500);
        }
        if (!result.exists) {
            logSession(session, "Embedded PSD assembler timed out.");
            return session.embeddedPsdIndex;
        }
        try {
            var parsed = eval("(" + readTextFile(result) + ")");
            session.embeddedPsdIndex = parsed && parsed.images ? parsed.images : [];
            if (parsed && parsed.error) {
                logSession(session, "Embedded PSD assembler error: " + parsed.error);
            }
        } catch (parseError) {
            logSession(session, "Embedded PSD index unreadable: " + parseError.message);
        }
        logSession(session, "Embedded PSD files: " + session.embeddedPsdIndex.length);
        return session.embeddedPsdIndex;
    }

    // Апдейтер кита находит Python с numpy (или ставит его) и пишет путь сюда.
    // Иллюстратор мог быть запущен до установки Python и не видеть его в PATH, поэтому путь, а не "python".
    function resolvePythonCommand() {
        try {
            var marker = new File($.getenv("LOCALAPPDATA") + "/DesignTerminal/python-path.txt");
            if (marker.exists) {
                var exePath = String(readTextFile(marker)).replace(/^\s+|\s+$/g, "");
                if (exePath && new File(exePath).exists) {
                    return "\"" + exePath + "\"";
                }
            }
        } catch (markerError) {}
        return "python";
    }

    function matchEmbeddedPsd(item, images) {
        var bounds = getPreferredBounds(item);
        if (!bounds || !(bounds.height > 0) || !images) {
            return null;
        }
        var aspect = bounds.width / bounds.height;
        var best = null;
        var bestDelta = 0.03;
        var i;
        for (i = 0; i < images.length; i++) {
            var image = images[i];
            if (!image || !(image.height > 0)) {
                continue;
            }
            var delta = Math.abs((image.width / image.height) - aspect);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = image;
            }
        }
        return best;
    }

    var PLACEABLE_EXTENSIONS = /\.(psd|psb|jpe?g|png|tiff?|gif|bmp|pdf|ai|eps|svg)$/i;

    function serializeImageItem(item, artboardRect, payload, report, session) {
        var name = safeItemName(item);
        var source = resolveImageSource(item, session, report);
        if (!source) {
            report.skippedUnsupported++;
            pushWarning(report, "Image skipped, its source pixels were not found: " + name);
            logSession(session, "[Mismatch] image " + name + ": no linked file and no embedded pixels matched; skipped (no re-render)");
            return false;
        }
        var gb = getGeometricBounds(item) || getPreferredBounds(item);
        var image = {
            id: buildItemId("asset"),
            name: name,
            itemType: "PlacedAsset",
            assetType: String(source.file.name).replace(/^.*\./, "").toUpperCase(),
            reason: source.how,
            assetPath: source.file.fsName,
            bounds: boundsToMm(gb, artboardRect),
            geometry: readImageGeometry(item, artboardRect),
            clip: readImageClip(item, artboardRect),
            rotation: 0,
            opacity: safeNumber(readAttr(item, "opacity"), 100),
            blendMode: safeEnum(readAttr(item, "blendingMode"))
        };
        image.groups = readGroupChain(item, artboardRect, !!image.clip);
        logSession(session, "Image " + name + ": " + source.how + " -> " + source.file.fsName);
        payload.imageItems.push(image);
        payload.orderedItems.push({ kind: "asset", id: image.id });
        report.exportedImageItems++;
        return true;
    }

    // Источник картинки: 1) связанный файл (ставим по его месту, без копии); 2) пиксели, встроенные в .ai
    // (сборщик отдал файл с тем же размером в пикселях, цветом и прозрачностью); 3) файл, из которого
    // картинку когда-то встроили, если он ещё на диске.
    function resolveImageSource(item, session, report) {
        if (item.typename == "PlacedItem") {
            var linked = null;
            try { linked = item.file; } catch (linkError) { linked = null; }
            if (linked && linked.exists && PLACEABLE_EXTENSIONS.test(linked.name)) {
                return { file: linked, how: "linked file" };
            }
        }
        var match = matchEmbeddedImage(item, session);
        if (match) {
            return { file: new File(match.file), how: "embedded pixels (pdf obj " + match.obj + ", " + match.width + "x" + match.height + " " + match.mode + (match.transparency ? " + alpha" : "") + ")" };
        }
        var original = null;
        try { original = item.file; } catch (originalError) { original = null; }
        if (original && original.exists && PLACEABLE_EXTENSIONS.test(original.name)) {
            pushWarning(report, "Embedded pixels not found, placed the original file it came from: " + original.fsName);
            return { file: original, how: "original file of the embedded image" };
        }
        return null;
    }

    function readRasterInfo(item) {
        if (item.typename != "RasterItem") {
            return null;
        }
        var bb = null;
        try { bb = item.boundingBox; } catch (bbError) { return null; }
        if (!bb) {
            return null;
        }
        var cs = "";
        try { cs = String(item.imageColorSpace).toUpperCase(); } catch (csError) {}
        var mode = cs.indexOf("CMYK") !== -1 ? "CMYK" : (cs.indexOf("RGB") !== -1 ? "RGB" : (cs.indexOf("GRAY") !== -1 ? "Gray" : ""));
        var alpha = false;
        try { alpha = !!item.transparent; } catch (alphaError) {}
        return {
            width: Math.round(Math.abs(bb[2] - bb[0])),
            height: Math.round(Math.abs(bb[1] - bb[3])),
            mode: mode,
            alpha: alpha
        };
    }

    // Встроенная картинка ↔ картинка из .ai: точный размер в пикселях, потом цветовая модель и прозрачность.
    // Раньше подбор был только по соотношению сторон — разные картинки одного формата путались.
    function matchEmbeddedImage(item, session) {
        var info = readRasterInfo(item);
        var images = session.embeddedPsdIndex || [];
        if (!info || !images.length) {
            return null;
        }
        session.usedEmbedded = session.usedEmbedded || {};
        var best = null;
        var bestScore = -1;
        var i;
        for (i = 0; i < images.length; i++) {
            var image = images[i];
            if (!image || Math.abs(image.width - info.width) > 1 || Math.abs(image.height - info.height) > 1) {
                continue;
            }
            var score = 0;
            if (info.mode && image.mode == info.mode) {
                score += 4;
            }
            if (!!image.transparency == info.alpha) {
                score += 2;
            }
            if (!session.usedEmbedded[image.file]) {
                score += 1;
            }
            if (score > bestScore) {
                bestScore = score;
                best = image;
            }
        }
        if (best) {
            session.usedEmbedded[best.file] = true;
        }
        return best;
    }

    // Как картинка лежит на странице: размер в своих единицах (пиксели / pt файла) и линейная часть
    // матрицы в pt страницы с осью y вниз; центр — центр габаритов (у любого поворота/отражения он общий).
    // У встроенной (RasterItem) — [a -c; -b d], у связанной (PlacedItem) — [a -c; b -d]
    // (проверено тестом: поворот 12° / 20°, отражения встроенной и связанной).
    function readImageGeometry(item, artboardRect) {
        try {
            var m = item.matrix;
            var bb = item.boundingBox;
            var w = Math.abs(bb[2] - bb[0]);
            var h = Math.abs(bb[1] - bb[3]);
            var raster = item.typename == "RasterItem";
            var gb = getGeometricBounds(item) || getPreferredBounds(item);
            var box = boundsToMm(gb, artboardRect);
            return {
                width: w,
                height: h,
                xx: Number(m.mValueA),
                xy: -Number(m.mValueC),
                yx: raster ? -Number(m.mValueB) : Number(m.mValueB),
                yy: raster ? Number(m.mValueD) : -Number(m.mValueD),
                center: { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            };
        } catch (geometryError) {
            return null;
        }
    }

    // Картинка в обтравочной маске, где кроме неё ничего нет: контур маски станет рамкой InDesign.
    function readImageClip(item, artboardRect) {
        var group = item.parent;
        try {
            if (!group || group.typename != "GroupItem" || !group.clipped) {
                return null;
            }
        } catch (parentError) {
            return null;
        }
        var clipPath = null;
        var others = 0;
        var i;
        for (i = 0; i < group.pageItems.length; i++) {
            var child = group.pageItems[i];
            var isClip = false;
            try { isClip = child.typename == "PathItem" && child.clipping; } catch (clipError) {}
            if (!isClip) {
                try {
                    if (child.typename == "CompoundPathItem" && child.pathItems.length && child.pathItems[0].clipping) {
                        isClip = true;
                    }
                } catch (compoundError) {}
            }
            if (isClip) {
                clipPath = child;
            } else {
                var same = false;
                try { same = String(child.uuid) == String(item.uuid); } catch (uuidError) { same = false; }
                if (!same) {
                    others++;
                }
            }
        }
        if (!clipPath || others > 0) {
            return null;
        }
        var path = clipPath.typename == "CompoundPathItem" ? clipPath.pathItems[0] : clipPath;
        var points = [];
        for (i = 0; i < path.pathPoints.length; i++) {
            var p = path.pathPoints[i];
            points.push({
                anchor: pointToMm(p.anchor, artboardRect),
                leftDirection: pointToMm(p.leftDirection, artboardRect),
                rightDirection: pointToMm(p.rightDirection, artboardRect)
            });
        }
        return {
            points: points,
            closed: !!path.closed,
            bounds: boundsToMm(getGeometricBounds(clipPath) || getPreferredBounds(clipPath), artboardRect)
        };
    }

    // Группы с прозрачностью или режимом наложения, в которых лежит объект (изнутри наружу).
    // Импорт после последнего объекта группы собирает их в группу InDesign с той же прозрачностью.
    // Обтравочные маски тоже идут в цепочку: импорт вставит объекты маски внутрь рамки с её контуром.
    // skipImmediateClip — у картинки, которая одна в своей маске: эту маску уже ставит сама картинка.
    function readGroupChain(item, artboardRect, skipImmediateClip) {
        var chain = [];
        var parent = null;
        try { parent = item.parent; } catch (parentError) { parent = null; }
        var guard = 0;
        while (parent && guard < 50) {
            guard++;
            var type = "";
            try { type = parent.typename; } catch (typeError) { break; }
            if (type != "GroupItem") {
                break;
            }
            var opacity = 100;
            var blend = null;
            var clipped = false;
            try { opacity = Number(parent.opacity); } catch (opacityError) {}
            try { blend = parent.blendingMode; } catch (blendError) {}
            try { clipped = !!parent.clipped; } catch (clippedError) {}
            if (clipped && guard == 1 && skipImmediateClip) {
                clipped = false;
            }
            var clip = clipped && artboardRect ? readClipPathPoints(parent, artboardRect) : null;
            var special = opacity < 99.95 || (blend !== null && blend != BlendModes.NORMAL) || !!clip;
            if (special) {
                var gid = "";
                try { gid = String(parent.uuid); } catch (uuidError) { gid = ""; }
                if (!gid) {
                    try { gid = textFrameSignature(parent); } catch (sigError) { gid = "g" + guard; }
                }
                chain.push({ id: "g" + gid, opacity: opacity, blendMode: safeEnum(blend), name: safeItemName(parent), clip: clip });
            }
            try { parent = parent.parent; } catch (upError) { break; }
        }
        return chain;
    }

    function clippedGroupBounds(item) {
        try {
            if (item.typename != "GroupItem" || !item.clipped) {
                return null;
            }
        } catch (typeError) {
            return null;
        }
        var i;
        for (i = 0; i < item.pageItems.length; i++) {
            var child = item.pageItems[i];
            try {
                if ((child.typename == "PathItem" && child.clipping) ||
                    (child.typename == "CompoundPathItem" && child.pathItems.length && child.pathItems[0].clipping)) {
                    return getGeometricBounds(child);
                }
            } catch (clipError) {}
        }
        return null;
    }

    function readClipPathPoints(group, artboardRect) {
        var i;
        for (i = 0; i < group.pageItems.length; i++) {
            var child = group.pageItems[i];
            var path = null;
            try {
                if (child.typename == "PathItem" && child.clipping) {
                    path = child;
                } else if (child.typename == "CompoundPathItem" && child.pathItems.length && child.pathItems[0].clipping) {
                    path = child.pathItems[0];
                }
            } catch (clipError) {}
            if (!path) {
                continue;
            }
            var points = [];
            var k;
            for (k = 0; k < path.pathPoints.length; k++) {
                var p = path.pathPoints[k];
                points.push({
                    anchor: pointToMm(p.anchor, artboardRect),
                    leftDirection: pointToMm(p.leftDirection, artboardRect),
                    rightDirection: pointToMm(p.rightDirection, artboardRect)
                });
            }
            return { points: points, closed: !!path.closed };
        }
        return null;
    }

    // Группа под маской только из векторов: копируется целиком, Иллюстратор отдаёт её с маской.
    var clippedVectorCache = {};
    function isClippedVectorGroup(item) {
        try {
            if (item.typename != "GroupItem" || !item.clipped) {
                return false;
            }
        } catch (typeError) {
            return false;
        }
        var key = "";
        try { key = String(item.uuid); } catch (uuidError) { key = ""; }
        if (key && clippedVectorCache.hasOwnProperty(key)) {
            return clippedVectorCache[key];
        }
        var result = groupIsVectorOnly(item);
        if (key) {
            clippedVectorCache[key] = result;
        }
        return result;
    }

    function groupIsVectorOnly(group) {
        var i;
        for (i = 0; i < group.pageItems.length; i++) {
            var child = group.pageItems[i];
            var t = child.typename;
            if (t == "TextFrame" || t == "RasterItem" || t == "PlacedItem" || t == "MeshItem" || t == "PluginItem" || t == "GraphItem") {
                return false;
            }
            if (t == "GroupItem" && !groupIsVectorOnly(child)) {
                return false;
            }
        }
        return true;
    }

    function insideClippedVectorGroup(item) {
        var parent = null;
        try { parent = item.parent; } catch (parentError) { return false; }
        var guard = 0;
        while (parent && guard < 50) {
            guard++;
            var type = "";
            try { type = parent.typename; } catch (typeError) { return false; }
            if (type != "GroupItem") {
                return false;
            }
            if (isClippedVectorGroup(parent)) {
                return true;
            }
            try { parent = parent.parent; } catch (upError) { return false; }
        }
        return false;
    }

    function placeAssembledPsd(item, artboardRect, payload, report, session) {
        var images = session.embeddedPsdIndex || [];
        var match = matchEmbeddedPsd(item, images);
        if (!match || !match.file) {
            return false;
        }
        var file = new File(match.file);
        if (!file.exists) {
            return false;
        }
        logSession(session, "PSD assembled from embedded pixels: " + file.fsName + " " + match.width + "x" + match.height);
        var full = getPreferredBounds(item);
        var clip = intersectRects(full, artboardRect) || full;
        payload.imageItems.push({
            id: buildItemId("asset"),
            itemType: "PlacedAsset",
            assetType: "PSD",
            reason: "embedded_pixels",
            assetPath: file.fsName,
            bounds: boundsToMm(clip, artboardRect),
            contentBounds: boundsToMm(full, artboardRect),
            unrotatedWidth: readUnrotatedMm(item, "width"),
            unrotatedHeight: readUnrotatedMm(item, "height"),
            rotation: rotationFromItem(item),
            opacity: safeNumber(item.opacity, 100),
            blendMode: safeEnum(item.blendingMode)
        });
        payload.orderedItems.push({
            kind: "asset",
            id: payload.imageItems[payload.imageItems.length - 1].id
        });
        report.exportedImageItems++;
        return true;
    }

    function serializeDirectPlacedAsset(item, artboardRect, payload, report, session, format, reason, countAsVector) {
        var assetInfo = exportItemAsset(item, session, format, report, reason);
        if (!assetInfo) {
            report.skippedUnsupported++;
            pushWarning(report, "Failed to export direct artwork asset for " + safeItemName(item) + " (" + reason + ")");
            return false;
        }

        logSession(session, "PSD kept: " + assetInfo.file.fsName);
        payload.imageItems.push({
            id: buildItemId("asset"),
            itemType: "PlacedAsset",
            assetType: "PSD",
            reason: reason,
            assetPath: assetInfo.file.fsName,
            bounds: boundsToMm(getPreferredBounds(item), artboardRect),
            unrotatedWidth: readUnrotatedMm(item, "width"),
            unrotatedHeight: readUnrotatedMm(item, "height"),
            rotation: rotationFromItem(item),
            opacity: safeNumber(item.opacity, 100),
            blendMode: safeEnum(item.blendingMode)
        });
        payload.orderedItems.push({
            kind: "asset",
            id: payload.imageItems[payload.imageItems.length - 1].id
        });

        if (countAsVector) {
            report.exportedVectorItems++;
        } else {
            report.exportedImageItems++;
        }
        return true;
    }

    function serializePathItem(item, artboardRect, report) {
        var points = [];
        var pathPoints = item.pathPoints;
        var i;

        for (i = 0; i < pathPoints.length; i++) {
            points.push({
                anchor: pointToMm(pathPoints[i].anchor, artboardRect),
                leftDirection: pointToMm(pathPoints[i].leftDirection, artboardRect),
                rightDirection: pointToMm(pathPoints[i].rightDirection, artboardRect),
                pointType: safeEnum(pathPoints[i].pointType)
            });
        }

        return {
            id: buildItemId("vector"),
            itemType: item.pathPoints.length == 2 && !item.closed ? "Line" : "Path",
            closed: !!item.closed,
            filled: !!item.filled,
            stroked: !!item.stroked,
            bounds: boundsToMm(getPreferredBounds(item), artboardRect),
            opacity: safeNumber(item.opacity, 100),
            blendMode: safeEnum(item.blendingMode),
            strokeWidth: safeNumber(item.strokeWidth),
            strokeDashes: serializeDashPattern(item.strokeDashes),
            strokeCap: safeEnum(item.strokeCap),
            strokeJoin: safeEnum(item.strokeJoin),
            fillColor: serializeColor(item.fillColor, report),
            strokeColor: serializeColor(item.strokeColor, report),
            points: points
        };
    }

    function serializeDashPattern(pattern) {
        if (!pattern) {
            return [];
        }

        var result = [];
        var i;
        for (i = 0; i < pattern.length; i++) {
            result.push(safeNumber(pattern[i], 0));
        }
        return result;
    }

    function isNativeVectorCandidate(item) {
        if (!item || item.typename != "PathItem") {
            return false;
        }

        if (item.guides || item.clipping) {
            return false;
        }

        if (!areNativeColors(item.fillColor, item.strokeColor)) {
            return false;
        }

        if (!item.closed && item.pathPoints.length !== 2) {
            return false;
        }

        return true;
    }

    function areNativeColors(fillColor, strokeColor) {
        return isNativeColor(fillColor) && isNativeColor(strokeColor);
    }

    function isNativeColor(color) {
        if (!color) {
            return true;
        }

        var type = color.typename;
        return type == "NoColor" || type == "RGBColor" || type == "CMYKColor" || type == "GrayColor" || type == "SpotColor";
    }

    function serializeColor(color, report) {
        if (!color) {
            return { type: "None" };
        }

        var colorType = "";
        try { colorType = color.typename; } catch (typeError) { return { type: "None" }; }

        switch (colorType) {
            case "NoColor":
                return { type: "None" };
            case "RGBColor":
                return {
                    type: "RGB",
                    red: safeNumber(readAttr(color, "red"), 0),
                    green: safeNumber(readAttr(color, "green"), 0),
                    blue: safeNumber(readAttr(color, "blue"), 0)
                };
            case "CMYKColor":
                return {
                    type: "CMYK",
                    cyan: safeNumber(readAttr(color, "cyan"), 0),
                    magenta: safeNumber(readAttr(color, "magenta"), 0),
                    yellow: safeNumber(readAttr(color, "yellow"), 0),
                    black: safeNumber(readAttr(color, "black"), 0)
                };
            case "GrayColor":
                return {
                    type: "Gray",
                    gray: safeNumber(readAttr(color, "gray"), 0)
                };
            case "SpotColor":
                var spotName = "Spot";
                var spotColor = null;
                try { if (color.spot) spotName = safeString(color.spot.name); } catch (spotNameError) {}
                try { if (color.spot) spotColor = color.spot.color; } catch (spotColorError) {}
                return {
                    type: "Spot",
                    name: spotName,
                    tint: safeNumber(readAttr(color, "tint"), 100),
                    base: serializeColor(spotColor, report)
                };
            case "GradientColor":
                // Градиент как цвет (текст, обводка): те же точки и цвета — импорт соберёт градиент InDesign.
                var gradientName = "Gradient";
                var gradientType = null;
                var gradientStops = [];
                try { if (color.gradient) gradientName = safeString(color.gradient.name); } catch (gradientError) {}
                try { gradientType = safeEnum(color.gradient.type); } catch (gradientTypeError) {}
                try {
                    var gs = color.gradient.gradientStops;
                    var gi;
                    for (gi = 0; gi < gs.length; gi++) {
                        if (gs[gi].color && gs[gi].color.typename == "GradientColor") {
                            continue;
                        }
                        gradientStops.push({
                            ramp: safeNumber(readAttr(gs[gi], "rampPoint"), 0),
                            mid: safeNumber(readAttr(gs[gi], "midPoint"), 50),
                            opacity: safeNumber(readAttr(gs[gi], "opacity"), 100),
                            color: serializeColor(gs[gi].color, report)
                        });
                    }
                } catch (stopsError) {}
                return {
                    type: "Gradient",
                    name: gradientName,
                    gradientType: gradientType,
                    angle: safeNumber(readAttr(color, "angle"), 0),
                    stops: gradientStops
                };
            default:
                pushWarning(report, "Unsupported color type: " + colorType);
                return {
                    type: safeString(colorType)
                };
        }
    }

    function groupContainsRaster(group) {
        var i;
        for (i = 0; i < group.pageItems.length; i++) {
            var item = group.pageItems[i];
            if (item.typename == "RasterItem" || item.typename == "PlacedItem") {
                return true;
            }
            if (item.typename == "GroupItem" && groupContainsRaster(item)) {
                return true;
            }
        }
        return false;
    }

    function intersectRects(a, b) {
        if (!a || !b) {
            return null;
        }
        var left = Math.max(a.left, b.left);
        var right = Math.min(a.right, b.right);
        var top = Math.min(a.top, b.top);
        var bottom = Math.max(a.bottom, b.bottom);
        if (right - left < 1 || top - bottom < 1) {
            return null;
        }
        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom,
            width: right - left,
            height: top - bottom
        };
    }

    function pngExportScale(bounds) {
        var longSide = Math.max(bounds.width, bounds.height);
        if (!(longSide > 1)) {
            return 100;
        }
        // Illustrator PNG scale is percent of 72 ppi: px = pt * scale / 100.
        // 82 MP (300% of a group bigger than the artboard) kills InDesign place via COM.
        var scale = Math.floor(4096 / longSide * 100);
        if (scale < 25) {
            scale = 25;
        }
        if (scale > 200) {
            scale = 200;
        }
        return scale;
    }

    function hideTextFrames(item) {
        if (!item || !item.typename) {
            return;
        }
        if (item.typename == "TextFrame") {
            try { item.hidden = true; } catch (hideError) {}
            return;
        }
        if (item.typename != "GroupItem") {
            return;
        }
        var i;
        for (i = item.pageItems.length - 1; i >= 0; i--) {
            hideTextFrames(item.pageItems[i]);
        }
    }

    function serializeRasterPng(item, artboardRect, payload, report, session) {
        var itemBounds = getPreferredBounds(item);
        var clip = intersectRects(itemBounds, artboardRect);
        if (!clip) {
            clip = itemBounds;
        }
        if (itemBounds && clip && (itemBounds.width - clip.width > 1 || itemBounds.height - clip.height > 1)) {
            logSession(session, "Overhang outside artboard: fullPt=" + round2(itemBounds.width) + "x" + round2(itemBounds.height) + " kept clipPt=" + round2(clip.width) + "x" + round2(clip.height) + ". Compare with layer Illustrator Reference.");
        }
        var file = exportItemPng(item, session, report, clip, itemBounds);
        if (!file) {
            report.skippedUnsupported++;
            pushWarning(report, "Failed to export photo for " + safeItemName(item));
            return;
        }
        var asset = {
            id: buildItemId("asset"),
            itemType: "PlacedAsset",
            assetType: "PNG",
            reason: "embedded_raster",
            assetPath: file.fsName,
            bounds: boundsToMm(clip, artboardRect),
            unrotatedWidth: readUnrotatedMm(item, "width"),
            unrotatedHeight: readUnrotatedMm(item, "height"),
            rotation: safeNumber(item.rotation, 0),
            opacity: safeNumber(item.opacity, 100),
            blendMode: safeEnum(item.blendingMode)
        };
        payload.imageItems.push(asset);
        payload.orderedItems.push({
            kind: "asset",
            id: asset.id
        });
        report.exportedImageItems++;
    }

    function exportItemPng(item, session, report, clipRect, originalBounds) {
        var previousInteraction = app.userInteractionLevel;
        var sourceDoc = null;
        try { sourceDoc = app.activeDocument; } catch (activeError) {}
        var temp = null;
        try {
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
            temp = app.documents.add(sourceDoc.documentColorSpace, 200, 200);
            var dup = item.duplicate(temp.layers[0], ElementPlacement.PLACEATBEGINNING);
            var dupBounds = null;
            try { dupBounds = normalizeRect(dup.visibleBounds); } catch (boundsError) {}
            if (!dupBounds) {
                try { dupBounds = normalizeRect(dup.geometricBounds); } catch (boundsError2) {}
            }
            var dx = 0;
            var dy = 0;
            if (dupBounds && originalBounds) {
                dx = dupBounds.left - originalBounds.left;
                dy = dupBounds.top - originalBounds.top;
            }
            hideTextFrames(dup);
            var exportRect = clipRect || dupBounds;
            if (exportRect) {
                temp.artboards[0].artboardRect = [
                    exportRect.left + dx,
                    exportRect.top + dy,
                    exportRect.right + dx,
                    exportRect.bottom + dy
                ];
            }
            var scale = pngExportScale(exportRect || dupBounds || { width: 100, height: 100 });
            var file = new File(session.assetsFolder.fsName + "/" + buildItemId("photo") + ".png");
            var options = new ExportOptionsPNG24();
            options.antiAliasing = true;
            options.artBoardClipping = true;
            options.transparency = true;
            options.horizontalScale = scale;
            options.verticalScale = scale;
            logSession(session, "PNG export scale=" + scale + " clipPt=" + round2(exportRect ? exportRect.width : 0) + "x" + round2(exportRect ? exportRect.height : 0));
            temp.exportFile(file, ExportType.PNG24, options);
            if (file.exists) {
                logSession(session, "PNG exported bytes=" + file.length + " path=" + file.fsName);
                return file;
            }
            pushWarning(report, "PNG export produced no file for " + safeItemName(item));
            return null;
        } catch (error) {
            pushWarning(report, "PNG export failed for " + safeItemName(item) + ": " + error.message);
            return null;
        } finally {
            if (temp) {
                try { temp.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) {}
            }
            try { if (sourceDoc) app.activeDocument = sourceDoc; } catch (restoreError) {}
            try { app.userInteractionLevel = previousInteraction; } catch (levelError) {}
        }
    }

    function exportItemAsset(item, session, format, report, reason) {
        // Строгий режим по требованию: только исходный linked файл или unembed embedded файла.
        // Никакого экспортного fallback.
        var placedSource = tryGetPlacedItemSourceFile(item, session, report, reason);
        if (placedSource && placedSource.exists && isPSDFile(placedSource)) {
            return {
                file: placedSource
            };
        }
        if (placedSource && placedSource.exists && !isPSDFile(placedSource)) {
            pushWarning(report, "Skipped non-PSD raster source: " + placedSource.fsName);
        }

        var unembeddedAny = tryUnembedAnyItemToFile(item, report);
        if (unembeddedAny && unembeddedAny.exists && isPSDFile(unembeddedAny)) {
            return {
                file: copyAssetFileToSession(unembeddedAny, session, reason, report, "unembedded_item")
            };
        }
        if (unembeddedAny && unembeddedAny.exists && !isPSDFile(unembeddedAny)) {
            pushWarning(report, "Unembed produced non-PSD file, skipped: " + unembeddedAny.fsName);
        }

        pushWarning(report, "PSD source is not available from linked/unembed; skipped: " + safeItemName(item));
        return null;
    }

    function isPSDFile(file) {
        if (!file) {
            return false;
        }
        var name = "";
        try {
            name = file.name || file.fsName || "";
        } catch (e) {}
        return /\.psd$/i.test(String(name));
    }

    function tryGetPlacedItemSourceFile(item, session, report, reason) {
        var placedItem = findPlacedItemDeep(item);
        if (!placedItem) {
            return null;
        }

        var sourceFile = null;
        try {
            if (placedItem.file && placedItem.file.exists) {
                sourceFile = placedItem.file;
            }
        } catch (readFileError) {}

        if (sourceFile && sourceFile.exists) {
            return copyAssetFileToSession(sourceFile, session, reason, report, "linked");
        }

        var unembeddedFile = tryUnembedPlacedItemToFile(placedItem, report);
        if (unembeddedFile && unembeddedFile.exists) {
            return copyAssetFileToSession(unembeddedFile, session, reason, report, "unembedded");
        }

        pushWarning(report, "Placed item source file is embedded and could not be extracted directly: " + safeItemName(item));
        return null;
    }

    function findPlacedItemDeep(item) {
        if (!item || !item.typename) {
            return null;
        }
        if (item.typename == "PlacedItem") {
            return item;
        }
        if (item.typename != "GroupItem") {
            return null;
        }

        var i;
        for (i = 0; i < item.pageItems.length; i++) {
            var nested = findPlacedItemDeep(item.pageItems[i]);
            if (nested) {
                return nested;
            }
        }
        return null;
    }

    function tryUnembedAnyItemToFile(item, report) {
        if (!item || !item.typename) {
            return null;
        }

        var sourceDoc = app.activeDocument;
        var tempDoc = null;
        var duplicated = null;
        var extracted = null;
        var i;
        var unembedCommands = [
            "Unembed",
            "unembed",
            "placedUnembed",
            "Adobe Place Object",
            "placedObjects"
        ];

        try {
            var bounds = getPreferredBounds(item);
            if (!bounds) {
                return null;
            }

            var width = Math.max(rectWidth(bounds), 1);
            var height = Math.max(rectHeight(bounds), 1);
            tempDoc = app.documents.add(sourceDoc.documentColorSpace, width, height);
            var top = tempDoc.artboards[0].artboardRect[1];
            duplicated = item.duplicate(tempDoc.layers[0], ElementPlacement.PLACEATBEGINNING);
            var dupBounds = getPreferredBounds(duplicated);
            if (dupBounds) {
                duplicated.translate(-dupBounds.left, top - dupBounds.top);
            }

            tempDoc.selection = null;
            duplicated.selected = true;

            for (i = 0; i < unembedCommands.length; i++) {
                try {
                    app.executeMenuCommand(unembedCommands[i]);
                } catch (menuError) {}

                extracted = findFirstPlacedFileInDocument(tempDoc);
                if (extracted && extracted.exists) {
                    break;
                }
            }
        } catch (error) {
            pushWarning(report, "Unembed from generic item failed: " + error.message);
        } finally {
            if (tempDoc) {
                try {
                    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
                } catch (closeError) {}
            }
            try {
                sourceDoc.activate();
            } catch (activateError) {}
        }

        return extracted;
    }

    function findFirstPlacedFileInDocument(doc) {
        if (!doc) {
            return null;
        }
        var i;
        for (i = 0; i < doc.pageItems.length; i++) {
            var file = findFirstPlacedFileDeep(doc.pageItems[i]);
            if (file && file.exists) {
                return file;
            }
        }
        return null;
    }

    function findFirstPlacedFileDeep(item) {
        if (!item || !item.typename) {
            return null;
        }
        if (item.typename == "PlacedItem") {
            try {
                if (item.file && item.file.exists) {
                    return item.file;
                }
            } catch (ePlaced) {}
        }
        if (item.typename == "GroupItem") {
            var i;
            for (i = 0; i < item.pageItems.length; i++) {
                var nested = findFirstPlacedFileDeep(item.pageItems[i]);
                if (nested && nested.exists) {
                    return nested;
                }
            }
        }
        return null;
    }

    function copyAssetFileToSession(sourceFile, session, reason, report, sourceLabel) {
        if (!sourceFile || !sourceFile.exists) {
            return null;
        }

        var sourceName = sourceFile.name || "asset.bin";
        var dot = sourceName.lastIndexOf(".");
        var extension = dot > -1 ? sourceName.substring(dot) : "";
        var target = new File(session.assetsFolder.fsName + "/" + sanitizeFileName(reason + "_" + buildItemId("src")) + extension);

        try {
            if (!sourceFile.copy(target.fsName)) {
                pushWarning(report, "Failed to copy " + sourceLabel + " placed asset file: " + sourceFile.fsName);
                return null;
            }
            return target;
        } catch (copyError) {
            pushWarning(report, "Error while copying " + sourceLabel + " placed asset file: " + copyError.message);
            return null;
        }
    }

    function tryUnembedPlacedItemToFile(item, report) {
        var sourceDoc = app.activeDocument;
        var tempDoc = null;
        var duplicated = null;
        var extracted = null;
        var i;

        // Команды unembed различаются между версиями/локалями Illustrator.
        var unembedCommands = [
            "Unembed",
            "unembed",
            "placedUnembed",
            "Adobe Place Object",
            "placedObjects"
        ];

        try {
            var bounds = getPreferredBounds(item);
            if (!bounds) {
                return null;
            }

            var width = Math.max(rectWidth(bounds), 1);
            var height = Math.max(rectHeight(bounds), 1);
            tempDoc = app.documents.add(sourceDoc.documentColorSpace, width, height);
            var top = tempDoc.artboards[0].artboardRect[1];
            duplicated = item.duplicate(tempDoc.layers[0], ElementPlacement.PLACEATBEGINNING);
            var dupBounds = getPreferredBounds(duplicated);
            if (dupBounds) {
                duplicated.translate(-dupBounds.left, top - dupBounds.top);
            }

            tempDoc.selection = null;
            duplicated.selected = true;

            for (i = 0; i < unembedCommands.length; i++) {
                try {
                    app.executeMenuCommand(unembedCommands[i]);
                } catch (menuError) {}

                try {
                    if (duplicated.file && duplicated.file.exists) {
                        extracted = duplicated.file;
                        break;
                    }
                } catch (fileError) {}
            }
        } catch (error) {
            pushWarning(report, "Embedded placed item extraction failed: " + error.message);
        } finally {
            if (tempDoc) {
                try {
                    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
                } catch (closeError) {}
            }
            try {
                sourceDoc.activate();
            } catch (activateError) {}
        }

        return extracted;
    }

    function launchInDesignImport(session, report, payload) {
        if (typeof BridgeTalk == "undefined") {
            logSession(session, "BridgeTalk is unavailable.");
            updateProgressUI(session, 2, "BridgeTalk unavailable.", 35);
            throw new Error("BridgeTalk is not available in this Illustrator session.");
        }

        var target = BridgeTalk.getSpecifier("indesign");
        if (!target) {
            logSession(session, "InDesign specifier not found. Trying to launch InDesign.");
            BridgeTalk.launch("indesign");
            waitForBridgeTarget("indesign", session, 20);
            target = BridgeTalk.getSpecifier("indesign");
        }

        if (!target) {
            logSession(session, "Failed to resolve InDesign target.");
            throw new Error("InDesign is not available.");
        }

        logSession(session, "BridgeTalk target resolved: " + target);
        updateProgressUI(session, 3, "Initializing InDesign document...", 45);
        report.transportMode = "Illustrator-driven action pipeline";

        var initResult = sendInDesignAction(target, session, "initDocument", {
            sessionId: session.stamp,
            sourceDocument: payload.sourceDocument,
            artboard: payload.artboard
        });
        if (!initResult.success) {
            closeProgressUI(session);
            showSessionDialog(session, "Transfer failed", "Could not initialize InDesign document. Open the temp folder for logs.");
            return;
        }

        var counts = countOrderedKinds(payload.orderedItems);
        updateProgressUI(session, 4, "Запускаю копирование векторов...", 70);
        var handed = startClipboardCopy(session, report, payload, counts);
        logSession(session, "Final export summary:\n" + buildExportSummary(report));
        closeProgressUI(session);
        if (!handed) {
            showSessionDialog(session, "Transfer failed", "Не удалось запустить копирование векторов. Лог в папке сессии.");
        }
    }

    function exportReferenceJpeg(payload, session) {
        var doc = null;
        var i;
        for (i = 0; i < app.documents.length; i++) {
            if (app.documents[i].name == payload.sourceDocument) {
                doc = app.documents[i];
            }
        }
        if (!doc) {
            return null;
        }
        var folder = new Folder(session.baseFolder.fsName + "/reference");
        ensureFolder(folder);
        var file = new File(folder.fsName + "/figma_reference_overlay.jpg");
        var previousInteraction = app.userInteractionLevel;
        var oldIndex = 0;
        try { oldIndex = doc.artboards.getActiveArtboardIndex(); } catch (indexError) {}
        try {
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
            app.activeDocument = doc;
            var artboardIndex = payload.artboard && isFinite(payload.artboard.index) ? payload.artboard.index : 0;
            try { doc.artboards.setActiveArtboardIndex(artboardIndex); } catch (setIndexError) {}
            var options = new ExportOptionsJPEG();
            options.antiAliasing = true;
            options.artBoardClipping = true;
            options.qualitySetting = 80;
            options.horizontalScale = 200;
            options.verticalScale = 200;
            if (file.exists) {
                file.remove();
            }
            doc.exportFile(file, ExportType.JPEG, options);
            if (file.exists) {
                logSession(session, "Reference JPEG: " + file.fsName);
                return file;
            }
        } catch (error) {
            logSession(session, "Reference JPEG failed: " + error.message);
        } finally {
            try { doc.artboards.setActiveArtboardIndex(oldIndex); } catch (restoreError) {}
            try { app.userInteractionLevel = previousInteraction; } catch (levelError) {}
        }
        return null;
    }

    function groupIdList(groups) {
        var ids = [];
        var i;
        if (!groups) {
            return ids;
        }
        for (i = 0; i < groups.length; i++) {
            ids.push(String(groups[i].id));
        }
        return ids;
    }

    function itemGroupsForRef(payload, ref) {
        if (!ref) {
            return [];
        }
        var it = null;
        if (ref.kind == "vector") {
            it = findItemById(payload.vectorItems, ref.id);
        } else if (ref.kind == "text") {
            it = findItemById(payload.textFrames, ref.id);
        } else if (ref.kind == "asset") {
            it = findItemById(payload.imageItems, ref.id);
        }
        return it && it.groups ? it.groups : [];
    }

    function startClipboardCopy(session, report, payload, counts) {
        // Одна очередь снизу вверх: вектор, текст и картинка идут вперемешку, как лежат в Иллюстраторе.
        // Каждый новый объект в InDesign ложится сверху, поэтому порядок создания = порядок слоёв.
        // Раньше все векторы вставлялись отдельным заходом до текста и картинок, и фото накрывало плашки.
        var ordered = payload.orderedItems || [];
        var vectors = [];
        var actionFiles = [];
        var steps = [];
        var i;
        for (i = ordered.length - 1; i >= 0; i--) {
            var ref = ordered[i];
            if (!ref || !ref.kind) {
                continue;
            }
            if (ref.kind == "vector") {
                var vectorItem = findItemById(payload.vectorItems, ref.id);
                if (!vectorItem) {
                    continue;
                }
                steps.push({ kind: "vector", index: vectors.length });
                vectors.push({
                    id: vectorItem.id,
                    sourceUuid: vectorItem.sourceUuid,
                    sourcePageItemIndex: vectorItem.sourcePageItemIndex,
                    sourceType: vectorItem.sourceType,
                    bounds: vectorItem.bounds,
                    visibleBounds: vectorItem.visibleBounds,
                    rotation: vectorItem.rotation,
                    opacity: vectorItem.opacity,
                    blendMode: vectorItem.blendMode,
                    name: vectorItem.name,
                    groups: groupIdList(vectorItem.groups),
                    opaqueGradient: !!(vectorItem.fillGradient && vectorItem.fillGradient.hasOpacity)
                });
                if (vectorItem.fillGradient) {
                    // Сразу после вставки: нативный градиент InDesign вместо потерянной заливки.
                    var styleFile = new File(session.baseFolder.fsName + "/step-" + actionFiles.length + ".jsx");
                    var previousStyleFile = session.actionScriptFile;
                    session.actionScriptFile = styleFile;
                    writeInDesignActionScript(session, "styleVector", {
                        sessionId: session.stamp,
                        item: vectorItem
                    });
                    session.actionScriptFile = previousStyleFile;
                    steps.push({ kind: "action", index: actionFiles.length });
                    actionFiles.push(styleFile.fsName);
                }
                pushGroupSteps(i);
                continue;
            }
            if (ref.kind != "text" && ref.kind != "asset") {
                continue;
            }
            var stepItem = ref.kind == "text" ? findItemById(payload.textFrames, ref.id) : findItemById(payload.imageItems, ref.id);
            if (!stepItem) {
                continue;
            }
            var stepFile = new File(session.baseFolder.fsName + "/step-" + actionFiles.length + ".jsx");
            var previousActionFile = session.actionScriptFile;
            session.actionScriptFile = stepFile;
            writeInDesignActionScript(session, ref.kind == "text" ? "createTextFrame" : "placeAsset", {
                sessionId: session.stamp,
                item: stepItem
            });
            session.actionScriptFile = previousActionFile;
            steps.push({ kind: "action", index: actionFiles.length });
            actionFiles.push(stepFile.fsName);
            pushGroupSteps(i);
        }

        // После верхнего объекта группы с прозрачностью — шаг, который соберёт её в InDesign.
        // Группа кончается, когда у следующего (выше) объекта её уже нет в цепочке.
        function pushGroupSteps(index) {
            var mine = itemGroupsForRef(payload, ordered[index]);
            if (!mine.length) {
                return;
            }
            var nextIds = index > 0 ? groupIdList(itemGroupsForRef(payload, ordered[index - 1])) : [];
            var g;
            for (g = 0; g < mine.length; g++) {
                var continues = false;
                var k;
                for (k = 0; k < nextIds.length; k++) {
                    if (nextIds[k] == String(mine[g].id)) {
                        continues = true;
                    }
                }
                if (continues) {
                    break;
                }
                var groupFile = new File(session.baseFolder.fsName + "/step-" + actionFiles.length + ".jsx");
                var previousGroupFile = session.actionScriptFile;
                session.actionScriptFile = groupFile;
                writeInDesignActionScript(session, "groupItems", {
                    sessionId: session.stamp,
                    group: mine[g],
                    outer: groupIdList(mine.slice(g + 1))
                });
                session.actionScriptFile = previousGroupFile;
                steps.push({ kind: "action", index: actionFiles.length });
                actionFiles.push(groupFile.fsName);
            }
        }

        var referenceFile = exportReferenceJpeg(payload, session);
        var queueFile = new File(session.baseFolder.fsName + "/copy-queue.json");
        writeJSON(queueFile, {
            sourceDocument: payload.sourceDocument,
            sessionId: session.stamp,
            vectors: vectors,
            actions: actionFiles,
            steps: steps,
            textCount: counts.text || 0,
            pathTextCount: report.exportedPathTextFrames || 0,
            referenceJpeg: referenceFile ? referenceFile.fsName : ""
        });

        var psSource = new File(String(SCRIPT_SOURCE_PATH).replace(/[^\/]+$/, "paste-vectors.ps1"));
        if (!psSource.exists) {
            logSession(session, "paste-vectors.ps1 not found: " + psSource.fsName);
            return false;
        }
        var psCopy = new File(session.baseFolder.fsName + "/paste-vectors.ps1");
        psSource.copy(psCopy);

        var bat = new File(session.baseFolder.fsName + "/run-paste.bat");
        bat.encoding = "UTF-8";
        bat.open("w");
        bat.writeln("@echo off");
        bat.writeln("powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0paste-vectors.ps1\" -Queue \"%~dp0copy-queue.json\"");
        bat.close();
        var started = bat.execute();
        logSession(session, "Clipboard copy started. vectors=" + vectors.length + " laterActions=" + actionFiles.length + " execute=" + started);
        return !!started;
    }

    function buildTransferDoneMessage(report, counts) {
        var lines = [];
        lines.push("Тексты: " + (counts.text || 0) + ", из них по контуру: " + (report.exportedPathTextFrames || 0));
        lines.push("Векторы: " + (counts.vector || 0));
        lines.push("Растры: " + (counts.asset || 0));
        if (report.warnings && report.warnings.length) {
            lines.push("");
            lines.push("Предупреждений: " + report.warnings.length + ". Подробности в логе сессии.");
        }
        return lines.join("\n");
    }

    function runBackToFrontTransfer(target, session, report, payload) {
        var ordered = payload && payload.orderedItems ? payload.orderedItems : [];
        var done = 0;
        var vectorFails = 0;

        // Сначала векторы и растры, потом текст. Иначе вставленная группа
        // оказывается сверху и закрывает буквы. Внутри прохода идём сзади вперёд.
        if (!transferOrderedPass(target, session, report, payload, ordered, "vector", done, vectorFails)) {
            return false;
        }
        done = payload._transferDone || done;
        vectorFails = payload._vectorFails || vectorFails;
        if (!transferOrderedPass(target, session, report, payload, ordered, "text", done, vectorFails)) {
            return false;
        }
        vectorFails = payload._vectorFails || vectorFails;

        if (vectorFails > 0) {
            pushWarning(report, "Vectors not pasted: " + vectorFails);
        }
        return true;
    }

    function transferOrderedPass(target, session, report, payload, ordered, passKind, done, vectorFails) {
        var total = ordered.length;
        var i;
        for (i = total - 1; i >= 0; i--) {
            if (isCancelled(session)) {
                logSession(session, "Transfer cancelled.");
                closeProgressUI(session);
                showSessionDialog(session, "Transfer cancelled", "The transfer was cancelled.");
                return false;
            }

            var itemRef = ordered[i];
            if (!itemRef || !itemRef.kind) {
                continue;
            }
            var isText = itemRef.kind == "text";
            var isVectorPassItem = itemRef.kind == "vector" || itemRef.kind == "asset";
            if (passKind == "text" && !isText) {
                continue;
            }
            if (passKind == "vector" && !isVectorPassItem) {
                continue;
            }
            done++;
            payload._transferDone = done;
            payload._vectorFails = vectorFails;
            var progressValue = 45 + Math.round((done / Math.max(total, 1)) * 50);

            if (itemRef.kind == "text") {
                var textItem = findItemById(payload.textFrames, itemRef.id);
                if (!textItem) {
                    pushWarning(report, "Missing text item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 3, "Текст " + done + " / " + total, progressValue);
                logSession(session, "Sending text item " + textItem.id + (textItem.textOnPath ? " (path)" : ""));
                var textResult = sendInDesignAction(target, session, "createTextFrame", {
                    sessionId: session.stamp,
                    item: textItem
                });
                if (!textResult.success) {
                    pushWarning(report, "Text action failed for " + textItem.id + ": " + textResult.body);
                }
                continue;
            }

            if (itemRef.kind == "vector") {
                var vectorItem = findItemById(payload.vectorItems, itemRef.id);
                if (!vectorItem) {
                    pushWarning(report, "Missing vector item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 4, "Вектор " + done + " / " + total, progressValue);
                if (!placeVectorPdf(target, session, report, payload, vectorItem)) {
                    vectorFails++;
                }
                continue;
            }

            if (itemRef.kind == "asset") {
                var assetItem = findItemById(payload.imageItems, itemRef.id);
                if (!assetItem) {
                    pushWarning(report, "Missing asset item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 4, "Растр " + done + " / " + total, progressValue);
                logSession(session, "Sending asset item " + assetItem.id + " path=" + assetItem.assetPath);
                var assetResult = sendInDesignAction(target, session, "placeAsset", {
                    sessionId: session.stamp,
                    item: assetItem
                });
                if (!assetResult.success || String(assetResult.body) != "OK") {
                    pushWarning(report, "Asset action failed for " + assetItem.id + ": " + assetResult.body);
                }
            }
        }

        payload._transferDone = done;
        payload._vectorFails = vectorFails;
        return true;
    }

    function placeVectorPdf(target, session, report, payload, vectorItem) {
        var pdfName = "vector-" + String(vectorItem.id).replace(/[^A-Za-z0-9_-]/g, "") + ".pdf";
        var pdfFile = new File(session.baseFolder.fsName + "/" + pdfName);
        logSession(session, "Exporting vector PDF " + vectorItem.id + " type=" + vectorItem.sourceType);
        if (!exportVectorPdf(payload.sourceDocument, vectorItem, pdfFile)) {
            pushWarning(report, "Vector PDF export failed for " + vectorItem.id);
            return false;
        }
        var placed = sendInDesignAction(target, session, "placeVectorPdf", {
            sessionId: session.stamp,
            item: {
                id: vectorItem.id,
                assetPath: pdfFile.fsName,
                bounds: vectorItem.bounds,
                opacity: vectorItem.opacity,
                blendMode: vectorItem.blendMode
            }
        });
        if (placed.success && String(placed.body) == "OK") {
            return true;
        }
        pushWarning(report, "Vector PDF place failed for " + vectorItem.id + ": " + placed.body);
        return false;
    }

    function exportVectorPdf(sourceDocumentName, vectorItem, pdfFile) {
        function findDocumentByName(docName) {
            var i;
            for (i = 0; i < app.documents.length; i++) {
                if (app.documents[i].name == docName) {
                    return app.documents[i];
                }
            }
            return null;
        }

        function findItemByUuid(doc, uuid) {
            if (!uuid) {
                return null;
            }
            var items = doc.pageItems;
            var i;
            for (i = 0; i < items.length; i++) {
                try {
                    if (String(items[i].uuid) == String(uuid)) {
                        return items[i];
                    }
                } catch (error) {}
            }
            return null;
        }

        var doc = findDocumentByName(sourceDocumentName);
        if (!doc) {
            return false;
        }
        var item = findItemByUuid(doc, vectorItem.sourceUuid);
        if (!item) {
            if (vectorItem.sourcePageItemIndex < 0 || vectorItem.sourcePageItemIndex >= doc.pageItems.length) {
                return false;
            }
            item = doc.pageItems[vectorItem.sourcePageItemIndex];
        }
        if (!item) {
            return false;
        }

        var previousInteraction = app.userInteractionLevel;
        var temp = null;
        var unlockState = unlockChain(item);
        try {
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
            app.activeDocument = doc;
            temp = app.documents.add(doc.documentColorSpace, 200, 200);
            var dup = item.duplicate(temp.layers[0], ElementPlacement.PLACEATBEGINNING);
            if (dup && dup.typename == "GroupItem") {
                removeTextFramesDeep(dup);
            }
            var bounds = null;
            try { bounds = dup.visibleBounds; } catch (boundsError) {}
            if (!bounds) {
                try { bounds = dup.geometricBounds; } catch (boundsError2) {}
            }
            if (bounds) {
                temp.artboards[0].artboardRect = bounds;
            }
            var options = new PDFSaveOptions();
            options.preserveEditability = false;
            options.generateThumbnails = false;
            try { options.viewAfterSaving = false; } catch (viewError) {}
            if (pdfFile.exists) {
                pdfFile.remove();
            }
            temp.saveAs(pdfFile, options);
            return pdfFile.exists;
        } catch (error) {
            return false;
        } finally {
            if (temp) {
                try { temp.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) {}
            }
            try { app.activeDocument = doc; } catch (activateError) {}
            try { app.userInteractionLevel = previousInteraction; } catch (levelError) {}
            restoreUnlockChain(unlockState);
        }
    }

    function copyVectorForPaste(sourceDocumentName, vectorItem) {
        function findDocumentByName(docName) {
            var i;
            for (i = 0; i < app.documents.length; i++) {
                if (app.documents[i].name == docName) {
                    return app.documents[i];
                }
            }
            return null;
        }

        function findItemByUuid(doc, uuid) {
            if (!uuid) {
                return null;
            }
            var items = doc.pageItems;
            var i;
            for (i = 0; i < items.length; i++) {
                try {
                    if (String(items[i].uuid) == String(uuid)) {
                        return items[i];
                    }
                } catch (error) {}
            }
            return null;
        }

        var doc = findDocumentByName(sourceDocumentName);
        if (!doc) {
            return false;
        }

        app.activeDocument = doc;
        var item = findItemByUuid(doc, vectorItem.sourceUuid);
        if (!item) {
            if (vectorItem.sourcePageItemIndex < 0 || vectorItem.sourcePageItemIndex >= doc.pageItems.length) {
                return false;
            }
            item = doc.pageItems[vectorItem.sourcePageItemIndex];
        }
        if (!item) {
            return false;
        }

        var unlockState = unlockChain(item);
        var duplicate = null;
        try {
            try { doc.selection = null; } catch (clearError) {}
            var copyTarget = item;
            if (item.typename == "GroupItem" && itemContainsTextFrame(item)) {
                duplicate = item.duplicate();
                removeTextFramesDeep(duplicate);
                copyTarget = duplicate;
            }
            copyTarget.selected = true;
            try { app.redraw(); } catch (redrawError) {}
            app.copy();
            $.sleep(250);
            return true;
        } catch (error) {
            return false;
        } finally {
            if (duplicate) {
                try { duplicate.remove(); } catch (removeError) {}
            }
            try { doc.selection = null; } catch (deselectError) {}
            restoreUnlockChain(unlockState);
        }
    }

    function countOrderedKinds(orderedItems) {
        var result = { text: 0, vector: 0, asset: 0 };
        if (!orderedItems) return result;
        var i;
        for (i = 0; i < orderedItems.length; i++) {
            if (!orderedItems[i] || !orderedItems[i].kind) continue;
            if (orderedItems[i].kind == "text") result.text++;
            else if (orderedItems[i].kind == "vector") result.vector++;
            else if (orderedItems[i].kind == "asset") result.asset++;
        }
        return result;
    }

    function runPipelineStage(target, session, report, payload, totalOrdered, kindToRun, stageCount, grandTotal) {
        if (!payload || !payload.orderedItems) return true;
        if (stageCount <= 0) return true;

        var i;
        var stageIndex = 0;
        for (i = 0; i < totalOrdered; i++) {
            if (isCancelled(session)) {
                logSession(session, "Transfer cancelled during stage: " + kindToRun);
                closeProgressUI(session);
                showSessionDialog(session, "Transfer cancelled", "The transfer was cancelled.");
                return false;
            }

            var itemRef = payload.orderedItems[i];
            if (!itemRef || itemRef.kind != kindToRun) {
                continue;
            }
            stageIndex++;
            var progressValue = 45 + Math.round(((stageIndex) / Math.max(grandTotal, 1)) * 50);

            if (kindToRun == "text") {
                var textItem = findItemById(payload.textFrames, itemRef.id);
                if (!textItem) {
                    pushWarning(report, "Missing text item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 3, "Text " + stageIndex + " / " + stageCount, progressValue);
                logSession(session, "Sending text item " + textItem.id);
                var textResult = sendInDesignAction(target, session, "createTextFrame", {
                    sessionId: session.stamp,
                    item: textItem
                });
                if (!textResult.success) {
                    pushWarning(report, "Text action failed for " + textItem.id + ": " + textResult.body);
                }
                continue;
            }

            if (kindToRun == "vector") {
                var vectorItem = findItemById(payload.vectorItems, itemRef.id);
                if (!vectorItem) {
                    pushWarning(report, "Missing vector item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 5, "Vector " + stageIndex + " / " + stageCount, progressValue);
                // Жёсткое подтверждение: следующий вектор делаем только когда InDesign вернул OK
                // ИЛИ когда пользователь явно сказал, что вектор в InDesign уже виден.
                // Если вернул SKIPPED/ошибку, повторяем copy->paste несколько раз через диалог.
                var pastedOk = false;
                while (!pastedOk) {
                    var attempt;
                    var maxAttempts = 3;
                    for (attempt = 1; attempt <= maxAttempts; attempt++) {
                        logSession(session, "Copying vector sourcePageItemIndex " + vectorItem.sourcePageItemIndex + " (attempt " + attempt + "/" + maxAttempts + ")");
                        if (!copyIllustratorItemByIndex(payload.sourceDocument, vectorItem.sourcePageItemIndex)) {
                            pushWarning(report, "Local Illustrator copy failed for sourcePageItemIndex " + vectorItem.sourcePageItemIndex);
                            continue;
                        }
                        // Даем clipboard “осесть”, иначе InDesign часто пишет Unable to paste current scrap item
                        $.sleep(1200);
                        try { BridgeTalk.pump(); } catch (ePump) {}

                        var vectorResult = sendInDesignAction(target, session, "pasteVector", {
                            sessionId: session.stamp,
                            item: vectorItem
                        });

                        if (!vectorResult.success) {
                            if (!vectorResult.completed) {
                                var decisionTimeout = showVectorDecisionPrompt(
                                    session,
                                    vectorItem,
                                    stageIndex,
                                    stageCount,
                                    "InDesign не ответил на вставку (долгий clipboard или модальный диалог).\n\n" +
                                    "Если в это время вектор уже появился в InDesign, нажмите \"Вектор есть\".\n\n" +
                                    "Если его нет, выберите: повторить или остановить."
                                );
                                if (decisionTimeout == "retry") {
                                    continue;
                                }
                                if (decisionTimeout == "confirm") {
                                    pastedOk = true;
                                    break;
                                }
                                // stop
                                logSession(session, "User stopped during vector timeout prompt. vectorId=" + vectorItem.id);
                                finalizeAndExit(target, session, report);
                                logSession(session, "Final export summary:\n" + buildExportSummary(report));
                                closeProgressUI(session);
                                showSessionDialog(session, "Transfer done", "Stopped during vector paste (timeout). Open the temp folder for logs.");
                                return false;
                            }
                            pushWarning(report, "Vector action failed for " + vectorItem.id + ": " + vectorResult.body);
                            $.sleep(500);
                            continue;
                        }

                        // BridgeTalk success != paste success. Body может быть OK или SKIPPED.
                        if (String(vectorResult.body) == "OK") {
                            pastedOk = true;
                            break;
                        }

                        // SKIPPED или другой ответ — спрашиваем пользователя, что делать дальше.
                        pushWarning(report, "Vector paste not confirmed for " + vectorItem.id + ": " + vectorResult.body);
                        var decisionSkipped = showVectorDecisionPrompt(
                            session,
                            vectorItem,
                            stageIndex,
                            stageCount,
                            "Не вставилось (InDesign вернул: " + vectorResult.body + ").\n\n" +
                            "Если вектор всё-таки появился в InDesign, нажмите \"Вектор есть\".\n\n" +
                            "Если его нет, выберите: повторить или остановить."
                        );
                        if (decisionSkipped == "retry") {
                            $.sleep(600);
                            continue;
                        }
                        if (decisionSkipped == "confirm") {
                            pastedOk = true;
                            break;
                        }
                        // stop
                        logSession(session, "User stopped after SKIPPED prompt. vectorId=" + vectorItem.id);
                        finalizeAndExit(target, session, report);
                        logSession(session, "Final export summary:\n" + buildExportSummary(report));
                        closeProgressUI(session);
                        showSessionDialog(session, "Transfer done", "Stopped during vector stage. Open the temp folder for logs.");
                        return false;
                    }

                    if (!pastedOk) {
                        // После пакета попыток не пропускаем вектор автоматически — только спрашиваем пользователя.
                        var decisionMore = showVectorDecisionPrompt(
                            session,
                            vectorItem,
                            stageIndex,
                            stageCount,
                            "Не удалось вставить после " + maxAttempts + " попыток.\n\n" +
                            "Если вектор в итоге появился в InDesign, нажмите \"Вектор есть\".\n\n" +
                            "Если его всё ещё нет, выберите: повторить или остановить."
                        );
                        if (decisionMore == "retry") {
                            continue;
                        }
                        if (decisionMore == "confirm") {
                            pastedOk = true;
                            break;
                        }
                        logSession(session, "User stopped after max-attempts prompt. vectorId=" + vectorItem.id);
                        finalizeAndExit(target, session, report);
                        logSession(session, "Final export summary:\n" + buildExportSummary(report));
                        closeProgressUI(session);
                        showSessionDialog(session, "Transfer done", "Stopped during vector stage. Open the temp folder for logs.");
                        return false;
                    }
                }

                // Ручной режим: после каждого подтвержденного OK спрашиваем пользователя в Illustrator,
                // виден ли вектор в InDesign, и только затем идем дальше.
                var continueVectors = showStagePrompt(
                    "Вектор перенесён?",
                    "Вставлен вектор " + stageIndex + " / " + stageCount + "\nID: " + vectorItem.id + "\n\nВ InDesign он виден? Продолжаем?",
                    "Да, дальше",
                    "Нет, остановить"
                );
                if (!continueVectors) {
                    logSession(session, "User stopped after vector confirmation prompt. vectorId=" + vectorItem.id);
                    finalizeAndExit(target, session, report);
                    logSession(session, "Final export summary:\n" + buildExportSummary(report));
                    closeProgressUI(session);
                    showSessionDialog(session, "Transfer done", "Stopped after vector confirmation. Open the temp folder for logs.");
                    return false;
                }
                continue;
            }

            if (kindToRun == "asset") {
                var assetItem = findItemById(payload.imageItems, itemRef.id);
                if (!assetItem) {
                    pushWarning(report, "Missing asset item for ordered reference: " + itemRef.id);
                    continue;
                }
                updateProgressUI(session, 4, "Raster " + stageIndex + " / " + stageCount, progressValue);
                logSession(session, "Sending asset item " + assetItem.id + " path=" + assetItem.assetPath);
                var assetResult = sendInDesignAction(target, session, "placeAsset", {
                    sessionId: session.stamp,
                    item: assetItem
                });
                if (!assetResult.success || String(assetResult.body) != "OK") {
                    pushWarning(report, "Asset action failed for " + assetItem.id + ": " + assetResult.body);
                }
                continue;
            }
        }
        return true;
    }

    function finalizeAndExit(target, session, report) {
        var finalizeResult = sendInDesignAction(target, session, "finalize", {
            sessionId: session.stamp
        });
        if (finalizeResult.success) {
            logSession(session, "InDesign finalize result:\n" + finalizeResult.body);
        } else {
            pushWarning(report, "Finalize action failed: " + finalizeResult.body);
        }
    }

    function showStagePrompt(title, message, okLabel, cancelLabel) {
        var win = new Window("dialog", title);
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 10;

        win.add("statictext", undefined, message, { multiline: true });

        var buttons = win.add("group");
        buttons.alignment = "right";
        var cancel = buttons.add("button", undefined, cancelLabel || "Cancel");
        var ok = buttons.add("button", undefined, okLabel || "OK", { name: "ok" });

        cancel.onClick = function () { win.close(0); };
        ok.onClick = function () { win.close(1); };

        return win.show() === 1;
    }

    // showVectorDecisionPrompt больше не используется: решения по вектору делаем внутри progress-окна.

    function sendInDesignAction(target, session, actionName, actionPayloadObject) {
        var bt = new BridgeTalk();
        var state = {
            completed: false,
            success: false,
            succeeded: false,
            body: ""
        };

        bt.target = target;
        bt.timeout = BRIDGETALK_WAIT_SECONDS;
        writeInDesignActionScript(session, actionName, actionPayloadObject);
        bt.body = "$.evalFile(" + quoteForBridgeTalk(session.actionScriptFile.fsName) + ");";

        logSession(session, "BridgeTalk action prepared: " + actionName);
        bt.onResult = function (result) {
            state.completed = true;
            state.success = true;
            state.succeeded = true;
            state.body = result.body;
            logSession(session, "BridgeTalk action result: " + actionName + " -> " + result.body);
        };
        bt.onError = function (result) {
            state.completed = true;
            state.success = false;
            state.succeeded = false;
            state.body = result.body;
            logSession(session, "BridgeTalk action error: " + actionName + " -> " + result.body);
        };

        bt.send();
        waitForBridgeResponse(bt, state, session, actionName);

        return state;
    }

    function findItemById(list, id) {
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].id == id) {
                return list[i];
            }
        }
        return null;
    }

    function writeInDesignActionScript(session, actionName, actionPayloadObject) {
        var script =
            "var inDesignActionHandler = " + inDesignActionHandler.toString() + ";\n" +
            "inDesignActionHandler(" +
            quoteForBridgeTalk(actionName) + ", " +
            quoteForBridgeTalk(stringifyJSON(actionPayloadObject, "")) + ", " +
            quoteForBridgeTalk((session.inDesignLogFile ? session.inDesignLogFile.fsName : session.logFile.fsName)) + ", " +
            quoteForBridgeTalk(session.cancelFile.fsName) +
            ");\n";

        session.actionScriptFile.open("w");
        session.actionScriptFile.encoding = "UTF-8";
        session.actionScriptFile.write(script);
        session.actionScriptFile.close();
    }

    function copyIllustratorItemByIndex(sourceDocumentName, sourcePageItemIndex) {
        function findDocumentByName(docName) {
            var i;
            for (i = 0; i < app.documents.length; i++) {
                if (app.documents[i].name == docName) {
                    return app.documents[i];
                }
            }
            return null;
        }

        var doc = findDocumentByName(sourceDocumentName);
        if (!doc) {
            return false;
        }

        app.activeDocument = doc;
        try {
            doc.selection = null;
        } catch (clearError) {}

        if (sourcePageItemIndex < 0 || sourcePageItemIndex >= doc.pageItems.length) {
            return false;
        }

        try {
            var item = doc.pageItems[sourcePageItemIndex];
            item.selected = true;
            app.copy();
            try {
                item.selected = false;
            } catch (deselectError) {}
            return true;
        } catch (error) {
            return false;
        }
    }

    function sendImportRequest(target, session, report, mode, payloadValue, allowRetryToFile) {
        var bt = new BridgeTalk();
        var state = {
            completed: false,
            succeeded: false,
            body: ""
        };
        bt.target = target;
        bt.timeout = BRIDGETALK_WAIT_SECONDS;
        bt.body = "(" + inDesignActionHandler.toString() + ")(" + quoteForBridgeTalk(mode) + ", " + quoteForBridgeTalk(payloadValue) + ", " + quoteForBridgeTalk(session.logFile.fsName) + ", " + quoteForBridgeTalk(session.cancelFile.fsName) + ");";
        logSession(session, "BridgeTalk request prepared. mode=" + mode);
        bt.onResult = function (result) {
            state.completed = true;
            state.succeeded = true;
            state.body = result.body;
            logSession(session, "BridgeTalk onResult received.");
            logSession(session, "InDesign result body:\n" + result.body);
            updateProgressUI(session, 5, "InDesign finished import.", 100);
        };
        bt.onError = function (result) {
            state.completed = true;
            state.succeeded = false;
            state.body = result.body;
            logSession(session, "BridgeTalk onError received. mode=" + mode + ". body=" + result.body);
            updateProgressUI(session, 3, "Transport error, trying fallback...", 55);
        };
        logSession(session, "BridgeTalk send() called.");
        bt.send();
        waitForBridgeResponse(bt, state, session, mode);

        if (isCancelled(session)) {
            logSession(session, "Transfer cancelled while waiting for BridgeTalk response.");
            closeProgressUI(session);
            showSessionDialog(session, "Transfer cancelled", "The transfer was cancelled.");
            return;
        }

        if (state.completed && state.succeeded) {
            logSession(session, "Final export summary:\n" + buildExportSummary(report));
            closeProgressUI(session);
            showSessionDialog(session, "Transfer done", "The transfer finished. Open the temp folder for logs and payload.");
            return;
        }

        // allowRetryToFile: если явно отключено, то не пытаемся переходить на file-fallback.
        // Раньше здесь было условие наоборот, из-за чего fallback никогда не срабатывал.
        if (mode == "inline" && allowRetryToFile === false) {
            return;
        }

        if (mode == "inline") {
            report.transportMode = "Temporary JSON fallback";
            report.transportFallbackUsed = true;
            logSession(session, "Retrying via temp JSON fallback.");
            try {
                writeJSON(session.jsonFile, eval("(" + payloadValue + ")"));
            } catch (error) {
                logSession(session, "Inline retry preparation failed: " + error.message);
                logSession(session, "Final export summary:\n" + buildExportSummary(report));
                closeProgressUI(session);
                showSessionDialog(session, "Transfer failed", "The transfer failed. Open the temp folder for logs.");
                return;
            }
            sendImportRequest(target, session, report, "file", session.jsonFile.fsName, true);
            return;
        }

        if (!state.completed) {
            logSession(session, "BridgeTalk wait timed out after " + BRIDGETALK_WAIT_SECONDS + " seconds.");
            logSession(session, "Final export summary:\n" + buildExportSummary(report));
            updateProgressUI(session, 5, "Timed out waiting for InDesign.", 100);
            closeProgressUI(session);
            showSessionDialog(session, "Transfer timed out", "No response from InDesign. Open the temp folder for logs.");
            return;
        }

        logSession(session, "Final export summary:\n" + buildExportSummary(report));
        closeProgressUI(session);
        showSessionDialog(session, "Transfer failed", "The transfer failed. Open the temp folder for logs.");
    }

    function inDesignActionHandler(actionName, actionPayloadJSON, logPath, cancelPath) {
        function appendLog(message) {
            try {
                var file = new File(logPath);
                file.open("a");
                file.encoding = "UTF-8";
                file.writeln(buildLogPrefix("InDesign") + message);
                file.close();
                return;
            } catch (error) {}

            // Fallback: если по каким-то причинам нельзя писать в indesign.log,
            // пишем в run.log в той же папке (иначе мы теряем диагностику полностью).
            try {
                var primary = new File(logPath);
                var parent = primary.parent;
                if (parent && parent.exists) {
                    var fallback = new File(parent.fsName + "/run.log");
                    fallback.open("a");
                    fallback.encoding = "UTF-8";
                    fallback.writeln(buildLogPrefix("InDesign") + message);
                    fallback.close();
                }
            } catch (fallbackError) {}
        }

        function buildLogPrefix(source) {
            return "[" + new Date().toUTCString() + "][" + source + "] ";
        }

        function shouldCancel() {
            try {
                var cancelFile = new File(cancelPath);
                return cancelFile.exists;
            } catch (error) {
                return false;
            }
        }

        function readActionPayload(jsonValue) {
            return eval("(" + jsonValue + ")");
        }

        function safeGet(value, fallback) {
            return value === undefined || value === null ? fallback : value;
        }

        function round2(value) {
            return Math.round(value * 100) / 100;
        }

        function createReport(payload) {
            return {
                sourceDocument: payload && payload.sourceDocument ? payload.sourceDocument : "",
                createdDocument: null,
                importedTextFrames: 0,
                importedVectorItems: 0,
                importedAssets: 0,
                transportMode: "Illustrator-driven action pipeline",
                warnedFontKeys: {},
                warnings: []
            };
        }

        function pushWarning(report, message) {
            report.warnings.push(message);
        }

        function readColor(doc, colorData, report, suffix) {
            if (!colorData || colorData.type == "None") {
                return doc.swatches.itemByName("None");
            }

            if (colorData.type == "Gradient") {
                return readGradientSwatch(doc, colorData, report, suffix);
            }
            if (colorData.type == "Spot") {
                return readSpotColor(doc, colorData, report, suffix);
            }

            var swatchName = buildSwatchName(colorData, suffix);
            var existing = doc.colors.itemByName(swatchName);
            try {
                if (existing.isValid) {
                    return existing;
                }
            } catch (error) {}

            try {
                switch (colorData.type) {
                    case "RGB":
                        return doc.colors.add({
                            name: swatchName,
                            model: ColorModel.PROCESS,
                            space: ColorSpace.RGB,
                            colorValue: [
                                safeGet(colorData.red, 0),
                                safeGet(colorData.green, 0),
                                safeGet(colorData.blue, 0)
                            ]
                        });
                    case "CMYK":
                        return doc.colors.add({
                            name: swatchName,
                            model: ColorModel.PROCESS,
                            space: ColorSpace.CMYK,
                            colorValue: [
                                safeGet(colorData.cyan, 0),
                                safeGet(colorData.magenta, 0),
                                safeGet(colorData.yellow, 0),
                                safeGet(colorData.black, 0)
                            ]
                        });
                    case "Gray":
                        return doc.colors.add({
                            name: swatchName,
                            model: ColorModel.PROCESS,
                            space: ColorSpace.CMYK,
                            colorValue: [0, 0, 0, safeGet(colorData.gray, 0)]
                        });
                    case "Spot":
                        return readColor(doc, colorData.base, report, suffix + "_spot");
                    default:
                        pushWarning(report, "Unsupported color payload type: " + colorData.type);
                        return doc.swatches.itemByName("None");
                }
            } catch (error2) {
                pushWarning(report, "Unable to create swatch " + swatchName + ": " + error2.message);
                return doc.swatches.itemByName("None");
            }
        }

        // Spot остаётся spot-цветом с тем же именем и составом, процент — оттенком (tint), а не пересчётом в CMYK.
        function readSpotColor(doc, colorData, report, suffix) {
            var name = String(safeGet(colorData.name, "Spot"));
            var base = colorData.base || {};
            var spot = null;
            try {
                spot = doc.colors.itemByName(name);
                if (!spot.isValid) {
                    spot = null;
                }
            } catch (lookupError) {
                spot = null;
            }
            if (!spot) {
                var space = ColorSpace.CMYK;
                var value = [0, 0, 0, 100];
                if (base.type == "CMYK") {
                    value = [safeGet(base.cyan, 0), safeGet(base.magenta, 0), safeGet(base.yellow, 0), safeGet(base.black, 0)];
                } else if (base.type == "RGB") {
                    space = ColorSpace.RGB;
                    value = [safeGet(base.red, 0), safeGet(base.green, 0), safeGet(base.blue, 0)];
                } else if (base.type == "Gray") {
                    value = [0, 0, 0, safeGet(base.gray, 0)];
                }
                try {
                    spot = doc.colors.add({ name: name, model: ColorModel.SPOT, space: space, colorValue: value });
                } catch (spotError) {
                    pushWarning(report, "Unable to create spot color " + name + ": " + spotError.message);
                    return readColor(doc, base, report, suffix + "_spot");
                }
            }
            var tint = Number(safeGet(colorData.tint, 100));
            if (!(tint < 99.95)) {
                return spot;
            }
            try {
                var i;
                for (i = 0; i < doc.tints.length; i++) {
                    var t = doc.tints[i];
                    if (t.baseColor.name == name && Math.abs(t.tintValue - tint) < 0.01) {
                        return t;
                    }
                }
            } catch (tintLookupError) {}
            try {
                return doc.tints.add(spot, { tintValue: tint });
            } catch (tintError) {
                pushWarning(report, "Unable to create tint " + tint + "% of " + name + ": " + tintError.message);
                return spot;
            }
        }

        // Градиент как цвет (текст, обводка): градиент InDesign с теми же точками.
        function readGradientSwatch(doc, colorData, report, suffix) {
            var data = colorData.stops || [];
            if (data.length < 2) {
                pushWarning(report, "Gradient without stops: " + safeGet(colorData.name, ""));
                return doc.swatches.itemByName("None");
            }
            var radial = String(colorData.gradientType || "").toUpperCase().indexOf("RADIAL") !== -1;
            var gradientName = "AI " + safeGet(colorData.name, "Gradient");
            try {
                var existing = doc.gradients.itemByName(gradientName);
                if (existing.isValid && existing.gradientStops.length == data.length) {
                    return existing;
                }
            } catch (existingError) {}
            var gradient = null;
            try {
                gradient = doc.gradients.add({ type: radial ? GradientType.RADIAL : GradientType.LINEAR });
                try { gradient.name = gradientName; } catch (nameError) {}
                var stops = gradient.gradientStops;
                while (stops.length < data.length) {
                    stops.add();
                }
                var k;
                for (k = 0; k < data.length; k++) {
                    try { stops[k].stopColor = readColor(doc, data[k].color, report, "grad_" + suffix); } catch (stopColorError) {}
                    try { stops[k].location = data[k].ramp; } catch (stopLocationError) {}
                    if (k > 0) {
                        try { stops[k].midpoint = data[k - 1].mid; } catch (midError) {}
                    }
                }
                return gradient;
            } catch (gradientError) {
                pushWarning(report, "Unable to create gradient " + safeGet(colorData.name, "") + ": " + gradientError.message);
                return doc.swatches.itemByName("None");
            }
        }

        function buildSwatchName(colorData, suffix) {
            if (!colorData) {
                return "AI_None_" + suffix;
            }

            if (colorData.type == "RGB") {
                return "AI_RGB_" + suffix + "_" + Math.round(colorData.red) + "_" + Math.round(colorData.green) + "_" + Math.round(colorData.blue);
            }
            if (colorData.type == "CMYK") {
                return "AI_CMYK_" + suffix + "_" + Math.round(colorData.cyan) + "_" + Math.round(colorData.magenta) + "_" + Math.round(colorData.yellow) + "_" + Math.round(colorData.black);
            }
            if (colorData.type == "Gray") {
                return "AI_GRAY_" + suffix + "_" + Math.round(colorData.gray);
            }
            if (colorData.type == "Spot") {
                return "AI_SPOT_" + suffix + "_" + safeGet(colorData.name, "Spot");
            }
            return "AI_COLOR_" + suffix + "_" + colorData.type;
        }

        function createDocument(payload) {
            var doc = app.documents.add();
            doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
            doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
            doc.documentPreferences.pageWidth = payload.artboard.width + "mm";
            doc.documentPreferences.pageHeight = payload.artboard.height + "mm";
            return doc;
        }

        function getSessionLabelKey() {
            return "AIToInDesignSession";
        }

        function findSessionDocument(sessionId) {
            var i;
            for (i = 0; i < app.documents.length; i++) {
                try {
                    if (app.documents[i].extractLabel(getSessionLabelKey()) == sessionId) {
                        return app.documents[i];
                    }
                } catch (error) {}
            }
            return null;
        }

        function applyFrameBounds(pageItem, bounds) {
            pageItem.geometricBounds = [
                bounds.y,
                bounds.x,
                bounds.y + bounds.height,
                bounds.x + bounds.width
            ];
        }

        function hasSpin(item) {
            return !!(item && typeof item.rotation === "number" && isFinite(item.rotation) && Math.abs(item.rotation) > 0.05 && item.unrotatedWidth > 0 && item.unrotatedHeight > 0);
        }

        function angleDelta(a, b) {
            var d = Math.abs(a - b) % 360;
            if (d > 180) {
                d = 360 - d;
            }
            return d;
        }

        function placeUnrotatedBox(pageItem, item) {
            if (hasSpin(item)) {
                var cx = item.bounds.x + item.bounds.width / 2;
                var cy = item.bounds.y + item.bounds.height / 2;
                var w = item.unrotatedWidth;
                var h = item.unrotatedHeight;
                pageItem.geometricBounds = [cy - h / 2, cx - w / 2, cy + h / 2, cx + w / 2];
                return;
            }
            applyFrameBounds(pageItem, item.bounds);
        }

        function rotateAroundCenter(pageItem, degrees, report) {
            if (degrees === null || degrees === undefined || Math.abs(degrees) <= 0.05) {
                return;
            }
            try {
                pageItem.transform(
                    CoordinateSpaces.PASTEBOARD_COORDINATES,
                    AnchorPoint.CENTER_ANCHOR,
                    app.transformationMatrices.add({ counterclockwiseRotationAngle: degrees })
                );
                appendLog("Rotation " + round2(degrees) + " deg around center.");
            } catch (spinError) {
                appendLog("Rotation around center failed: " + spinError.message);
                pushWarning(report, "Rotation around center failed: " + spinError.message);
                try { pageItem.rotationAngle = degrees; } catch (fallbackError) {}
            }
        }

        function checkPlacement(pageItem, item, label) {
            if (!pageItem || !item || !item.bounds) {
                return;
            }
            var actual = null;
            try { actual = pageItem.geometricBounds; } catch (readError) {}
            if (!actual) {
                appendLog("[Check] " + label + " bounds unreadable");
                return;
            }
            var ax = actual[1];
            var ay = actual[0];
            var aw = Math.abs(actual[3] - actual[1]);
            var ah = Math.abs(actual[2] - actual[0]);
            var rot = 0;
            try { rot = Number(pageItem.rotationAngle || 0); } catch (rotError) {}
            try {
                if (pageItem.parentStory && pageItem.parentStory.overflows) {
                    appendLog("[Mismatch] " + label + " overset");
                }
            } catch (overflowError) {}
            var expectedRot = Number(item.rotation || 0);
            if (Math.abs(expectedRot) > 0.05) {
                var ecx = item.bounds.x + item.bounds.width / 2;
                var ecy = item.bounds.y + item.bounds.height / 2;
                var dc = Math.max(Math.abs(ax + aw / 2 - ecx), Math.abs(ay + ah / 2 - ecy));
                var dr = angleDelta(rot, expectedRot);
                if (dc > 0.5 || dr > 0.5) {
                    appendLog("[Mismatch] " + label + " center \u0394=" + round2(dc) + "mm rot \u0394=" + round2(dr) + " deg expectedRot=" + round2(expectedRot) + " actualRot=" + round2(rot));
                } else {
                    appendLog("[Check] " + label + " OK center \u0394=" + round2(dc) + "mm rot=" + round2(rot) + " deg. Rotation changes the box; compare with layer Illustrator Reference.");
                }
                return;
            }
            var worst = Math.max(
                Math.abs(ax - item.bounds.x),
                Math.abs(ay - item.bounds.y),
                Math.abs(aw - item.bounds.width),
                Math.abs(ah - item.bounds.height)
            );
            if (worst > 0.5) {
                appendLog("[Mismatch] " + label + " \u0394max=" + round2(worst) + "mm expected " + round2(item.bounds.x) + "," + round2(item.bounds.y) + " " + round2(item.bounds.width) + "x" + round2(item.bounds.height) + " actual " + round2(ax) + "," + round2(ay) + " " + round2(aw) + "x" + round2(ah));
            } else {
                appendLog("[Check] " + label + " OK \u0394max=" + round2(worst) + "mm");
            }
        }

        function placePastedItem(pageItem, itemOrBounds) {
            var bounds = itemOrBounds && itemOrBounds.bounds ? itemOrBounds.bounds : itemOrBounds;
            var rotation = itemOrBounds && typeof itemOrBounds.rotation === "number" ? itemOrBounds.rotation : 0;
            if (!pageItem || !bounds) {
                return;
            }
            try {
                var current = pageItem.geometricBounds;
                var rotNow = 0;
                try { rotNow = Number(pageItem.rotationAngle || 0); } catch (rotError) {}
                if (Math.abs(rotation) > 0.05 || Math.abs(rotNow) > 0.05) {
                    var ccx = (current[1] + current[3]) / 2;
                    var ccy = (current[0] + current[2]) / 2;
                    pageItem.move(undefined, [(bounds.x + bounds.width / 2) - ccx, (bounds.y + bounds.height / 2) - ccy]);
                    appendLog("Pasted item aligned by center. rotation kept " + round2(rotNow) + " deg.");
                    return;
                }
                var currentWidth = Math.abs(current[3] - current[1]);
                var currentHeight = Math.abs(current[2] - current[0]);
                var widthClose = Math.abs(currentWidth - bounds.width) < 1;
                var heightClose = Math.abs(currentHeight - bounds.height) < 1;
                if (widthClose && heightClose) {
                    pageItem.move(undefined, [bounds.x - current[1], bounds.y - current[0]]);
                    return;
                }
            } catch (moveError) {}
            applyFrameBounds(pageItem, bounds);
        }

        function resolveFont(attrs, report) {
            if (!attrs || (!attrs.fontFamily && !attrs.fontName)) {
                return null;
            }

            var candidateNames = buildFontCandidates(attrs);
            var i;
            for (i = 0; i < candidateNames.length; i++) {
                try {
                    var candidate = app.fonts.itemByName(candidateNames[i]);
                    if (candidate && candidate.isValid) {
                        return candidate;
                    }
                } catch (error) {}
            }

            try {
                var allFonts = app.fonts.everyItem().getElements();
                for (i = 0; i < allFonts.length; i++) {
                    if (fontMatches(allFonts[i], attrs)) {
                        return allFonts[i];
                    }
                }
            } catch (scanError) {}

            warnOnce(report, "font:" + safeGet(attrs.fontName, "") + ":" + safeGet(attrs.fontFamily, "") + ":" + safeGet(attrs.fontStyle, ""), "Font not resolved in InDesign: " + safeGet(attrs.fontName, attrs.fontFamily) + " " + safeGet(attrs.fontStyle, ""));
            return null;
        }

        function buildFontCandidates(attrs) {
            var list = [];
            var family = safeGet(attrs.fontFamily, "");
            var style = safeGet(attrs.fontStyle, "");
            var name = safeGet(attrs.fontName, "");

            pushUnique(list, name);
            pushUnique(list, family + "\t" + style);
            pushUnique(list, family + "\tRegular");
            pushUnique(list, family);
            if (family && style) {
                pushUnique(list, family + " " + style);
            }
            return list;
        }

        function fontMatches(font, attrs) {
            var fontName = normalizeFontString(readFontProperty(font, "name"));
            var fontFullName = normalizeFontString(readFontProperty(font, "fullName"));
            var fontFamily = normalizeFontString(readFontProperty(font, "fontFamily"));
            var fontStyleName = normalizeFontString(readFontProperty(font, "fontStyleName"));
            var wantedName = normalizeFontString(attrs.fontName);
            var wantedFamily = normalizeFontString(attrs.fontFamily);
            var wantedStyle = normalizeFontString(attrs.fontStyle);

            if (wantedName && (fontName == wantedName || fontFullName == wantedName)) {
                return true;
            }

            if (wantedFamily && wantedStyle && fontFamily == wantedFamily && fontStyleName == wantedStyle) {
                return true;
            }

            if (wantedFamily && fontFamily == wantedFamily) {
                return true;
            }

            return false;
        }

        function readFontProperty(font, propertyName) {
            try {
                return font[propertyName];
            } catch (error) {
                return "";
            }
        }

        function normalizeFontString(value) {
            if (!value) {
                return "";
            }
            return String(value).toLowerCase().replace(/\s+/g, " ").replace(/[\-_]+/g, " ").replace(/^\s+|\s+$/g, "");
        }

        function pushUnique(list, value) {
            if (!value) {
                return;
            }
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i] == value) {
                    return;
                }
            }
            list.push(value);
        }

        function warnOnce(report, key, message) {
            if (report.warnedFontKeys[key]) {
                return;
            }
            report.warnedFontKeys[key] = true;
            pushWarning(report, message);
        }

        function applyCharacterAttributes(textRange, attrs, doc, report, suffix) {
            if (!attrs) {
                return;
            }

            if (!applyFontCandidates(textRange, attrs, report)) {
                warnOnce(report, "font-apply:" + safeGet(attrs.fontName, "") + ":" + safeGet(attrs.fontFamily, "") + ":" + safeGet(attrs.fontStyle, ""), "Unable to apply font: " + safeGet(attrs.fontName, attrs.fontFamily) + " " + safeGet(attrs.fontStyle, ""));
            }

            applyVariableAxes(textRange, attrs, report);

            if (!isValidTextTarget(textRange)) {
                pushWarning(report, "Text target became invalid before applying text attributes.");
                return;
            }

            trySet(textRange, "pointSize", attrs.fontSize, report);
            // Авто-интерлиньяж — явно Auto: иначе символ наследует фиксированный интерлиньяж
            // из стиля по умолчанию (первого символа). Процент авто ставит абзац (autoLeadingAmount).
            if (attrs.autoLeading === true) {
                try { textRange.leading = Leading.AUTO; } catch (autoLeadError) {}
            } else if (attrs.leading > 0) {
                trySet(textRange, "leading", attrs.leading, report);
            }
            trySet(textRange, "tracking", attrs.tracking, report);
            // Способ кернинга (оптический / метрический / нет). Ручной кернинг между парами ставит
            // applyManualKerning после всех ранов — иначе способ его перезапишет.
            applyKerningMethod(textRange, attrs.kerningMethod, report);
            trySet(textRange, "horizontalScale", attrs.horizontalScale, report);
            trySet(textRange, "verticalScale", attrs.verticalScale, report);
            trySet(textRange, "baselineShift", attrs.baselineShift, report);
            applyTextPosition(textRange, attrs, report);
            applyOpenTypeFeatures(textRange, attrs, report);
            if (attrs.characterRotation !== null && attrs.characterRotation !== undefined) {
                setQuiet(textRange, "characterRotation", attrs.characterRotation, report);
            }
            if (attrs.noBreak !== null && attrs.noBreak !== undefined) {
                setQuiet(textRange, "noBreak", attrs.noBreak, report);
            }

            if (attrs.underline !== null && attrs.underline !== undefined) {
                trySet(textRange, "underline", attrs.underline, report);
            }
            if (attrs.strikeThrough !== null && attrs.strikeThrough !== undefined) {
                trySet(textRange, "strikeThru", attrs.strikeThrough, report);
            }

            var fillColor = readColor(doc, attrs.fillColor, report, "text_fill_" + suffix);
            var strokeColor = readColor(doc, attrs.strokeColor, report, "text_stroke_" + suffix);

            trySet(textRange, "fillColor", fillColor, report);
            applyTextStroke(textRange, attrs, strokeColor, report);
            if (attrs.overprintFill !== null && attrs.overprintFill !== undefined) {
                setQuiet(textRange, "overprintFill", attrs.overprintFill, report);
            }
            if (attrs.overprintStroke !== null && attrs.overprintStroke !== undefined) {
                setQuiet(textRange, "overprintStroke", attrs.overprintStroke, report);
            }
            applyCapitalization(textRange, attrs.capitalization, report);
            applyLanguage(textRange, attrs.language, report);
        }

        // Ставит свойство молча; если InDesign не принял — одна строка в отчёте на свойство.
        function setQuiet(target, propertyName, value, report) {
            if (value === null || value === undefined) {
                return false;
            }
            try {
                target[propertyName] = value;
                return true;
            } catch (error) {
                warnOnce(report, "set:" + propertyName, "Unable to set " + propertyName + ": " + error.message);
                return false;
            }
        }

        // Верхний / нижний индекс: обычный (синтетический) и OpenType, дробь — числитель / знаменатель.
        function applyTextPosition(textRange, attrs, report) {
            var base = String(attrs.baselinePosition || "").toUpperCase();
            var ot = String(attrs.openTypePosition || "").toUpperCase();
            var position = null;
            if (base.indexOf("SUPERSCRIPT") !== -1) {
                position = Position.SUPERSCRIPT;
            } else if (base.indexOf("SUBSCRIPT") !== -1) {
                position = Position.SUBSCRIPT;
            } else if (ot.indexOf("SUPERSCRIPT") !== -1) {
                position = Position.OT_SUPERSCRIPT;
            } else if (ot.indexOf("SUBSCRIPT") !== -1) {
                position = Position.OT_SUBSCRIPT;
            } else if (ot.indexOf("NUMERATOR") !== -1) {
                position = Position.OT_NUMERATOR;
            } else if (ot.indexOf("DENOMINATOR") !== -1) {
                position = Position.OT_DENOMINATOR;
            } else if (base || ot) {
                position = Position.NORMAL;
            }
            if (position !== null) {
                setQuiet(textRange, "position", position, report);
            }
        }

        // OpenType-функции Иллюстратора → InDesign: лигатуры, дроби, порядковые, росчерки, капительные,
        // стилистические альтернативы, стиль цифр.
        function applyOpenTypeFeatures(textRange, attrs, report) {
            if (attrs.ligature !== null && attrs.ligature !== undefined) {
                setQuiet(textRange, "ligatures", attrs.ligature, report);
            }
            if (attrs.discretionaryLigature !== null && attrs.discretionaryLigature !== undefined) {
                setQuiet(textRange, "otfDiscretionaryLigature", attrs.discretionaryLigature, report);
            }
            if (attrs.contextualLigature !== null && attrs.contextualLigature !== undefined) {
                setQuiet(textRange, "otfContextualAlternate", attrs.contextualLigature, report);
            }
            if (attrs.fractions !== null && attrs.fractions !== undefined) {
                setQuiet(textRange, "otfFraction", attrs.fractions, report);
            }
            if (attrs.ordinals !== null && attrs.ordinals !== undefined) {
                setQuiet(textRange, "otfOrdinal", attrs.ordinals, report);
            }
            if (attrs.swash !== null && attrs.swash !== undefined) {
                setQuiet(textRange, "otfSwash", attrs.swash, report);
            }
            if (attrs.titling !== null && attrs.titling !== undefined) {
                setQuiet(textRange, "otfTitling", attrs.titling, report);
            }
            if (attrs.stylisticAlternates !== null && attrs.stylisticAlternates !== undefined) {
                setQuiet(textRange, "otfStylisticAlternate", attrs.stylisticAlternates, report);
            }
            var figure = String(attrs.figureStyle || "").toUpperCase();
            var style = null;
            if (figure.indexOf("TABULAROLDSTYLE") !== -1) {
                style = OTFFigureStyle.TABULAR_OLDSTYLE;
            } else if (figure.indexOf("PROPORTIONALOLDSTYLE") !== -1) {
                style = OTFFigureStyle.PROPORTIONAL_OLDSTYLE;
            } else if (figure.indexOf("TABULAR") !== -1) {
                style = OTFFigureStyle.TABULAR_LINING;
            } else if (figure.indexOf("PROPORTIONAL") !== -1) {
                style = OTFFigureStyle.PROPORTIONAL_LINING;
            } else if (figure.indexOf("DEFAULT") !== -1) {
                style = OTFFigureStyle.DEFAULT_VALUE;
            }
            if (style !== null) {
                setQuiet(textRange, "otfFigureStyle", style, report);
            }
        }

        // Знак конца абзаца / перевода строки в InDesign входит в строку и своим кеглем и интерлиньяжем
        // раздвигает её; у Иллюстратора — нет. Даём такому знаку кегль и интерлиньяж символа перед ним.
        // Пустую строку (знак сразу после такого же знака) не трогаем: её высоту задаёт сам знак.
        function alignBreakCharacters(story, item, indexMap) {
            var text = illustratorTextToInDesign(item.contents);
            var count = story.characters.length;
            var fixed = 0;
            var j;
            for (j = 1; j < text.length; j++) {
                var ch = text.charAt(j);
                if (ch != "\r" && ch != "\n") {
                    continue;
                }
                var prev = text.charAt(j - 1);
                if (prev == "\r" || prev == "\n") {
                    continue;
                }
                var at = mapAiIndex(indexMap, j);
                var from = mapAiIndex(indexMap, j - 1);
                if (at >= count || from < 0) {
                    continue;
                }
                try {
                    var src = story.characters[from];
                    var dst = story.characters[at];
                    if (dst.pointSize != src.pointSize) {
                        dst.pointSize = src.pointSize;
                    }
                    if (String(dst.leading) != String(src.leading)) {
                        dst.leading = src.leading;
                    }
                    fixed++;
                } catch (breakError) {}
            }
            return fixed;
        }

        // Ручной кернинг: у Иллюстратора значение стоит на символе после пары, у InDesign — на символе до неё.
        function applyManualKerning(story, item, indexMap, report) {
            var list = item.manualKerning || [];
            var applied = 0;
            var i;
            for (i = 0; i < list.length; i++) {
                var idx = mapAiIndex(indexMap, list[i].index) - 1;
                if (idx < 0) {
                    continue;
                }
                try {
                    story.characters[idx].kerningValue = list[i].value;
                    applied++;
                } catch (kernError) {
                    warnOnce(report, "kern:" + item.id, "Manual kerning failed in " + safeGet(item.name, item.id) + ": " + kernError.message);
                }
            }
            if (list.length) {
                appendLog("Manual kerning " + safeGet(item.name, item.id) + ": " + applied + "/" + list.length + " pairs");
            }
        }

        // Индексы символов Иллюстратора — в единицах UTF-16 (эмодзи = 2), у InDesign эмодзи — 1 символ.
        function buildAiIndexMap(text) {
            var map = [];
            var idIndex = 0;
            var i;
            for (i = 0; i < text.length; i++) {
                map[i] = idIndex;
                var code = text.charCodeAt(i);
                if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
                    var next = text.charCodeAt(i + 1);
                    if (next >= 0xDC00 && next <= 0xDFFF) {
                        map[i + 1] = idIndex;
                        i++;
                    }
                }
                idIndex++;
            }
            map[text.length] = idIndex;
            return map;
        }

        function mapAiIndex(indexMap, aiIndex) {
            if (!indexMap || aiIndex === null || aiIndex === undefined) {
                return aiIndex;
            }
            if (aiIndex >= indexMap.length) {
                return indexMap[indexMap.length - 1];
            }
            return indexMap[aiIndex];
        }

        // Применение шрифта: сначала как в JSONToIndesign.jsx (family + "\t" + style),
        // затем fallback для variable-font кейсов, где width/axes закодированы в "style" Illustrator.
        function applyFontCandidates(textRange, attrs, report) {
            var family = safeGet(attrs.fontFamily, "");
            var style = safeGet(attrs.fontStyle, "");
            if (!family) {
                return false;
            }
            var candidates = [];
            pushFontCandidate(candidates, family, style);

            // Частый кейс variable-шрифтов: Illustrator пишет style как "Narrow"/"Medium Narrow-300.000",
            // но в InDesign реальная базовая стилевка обычно "Regular"/"Roman".
            var normalizedStyle = normalizeStyleForInDesign(style);
            if (normalizedStyle && normalizedStyle != style) {
                pushFontCandidate(candidates, family, normalizedStyle);
            }
            pushFontCandidate(candidates, family, "Regular");
            pushFontCandidate(candidates, family, "Roman");
            pushFontCandidate(candidates, family, "Medium");
            pushFontCandidate(candidates, family, "Bold");

            // Иногда шрифт находится по одному family без style.
            candidates.push(family);

            var i;
            for (i = 0; i < candidates.length; i++) {
                var candidateName = candidates[i];
                if (!candidateName) continue;
                try {
                    var fontObj = app.fonts.itemByName(candidateName);
                    if (fontObj && fontObj.isValid) {
                        textRange.appliedFont = fontObj;
                        appendLog("Font applied: candidate=" + candidateName);
                        return true;
                    }
                } catch (e1) {}
            }

            appendLog("Font NOT applied. source family=" + family + " style=" + style);
            return false;
        }

        function pushFontCandidate(list, family, style) {
            if (!family) return;
            if (style === null || style === undefined) style = "";
            var name = family + "\t" + String(style);
            // Убираем хвостовые табы
            if (name.charAt(name.length - 1) == "\t") {
                name = family;
            }
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i] == name) return;
            }
            list.push(name);
        }

        function normalizeStyleForInDesign(style) {
            var s = String(style || "").toLowerCase();
            if (!s) return "";
            // Выкидываем числовые суффиксы, которые Illustrator иногда добавляет к variable-стилям
            // типа "medium narrow-300.000"
            s = s.replace(/[-_ ]\\d+(?:\\.\\d+)?/g, "");
            // Если стиль про ширину — это скорее ось, базовый стиль оставляем Regular
            if (s.indexOf("narrow") !== -1 || s.indexOf("condensed") !== -1 || s.indexOf("compressed") !== -1) {
                if (s.indexOf("bold") !== -1) return "Bold";
                if (s.indexOf("medium") !== -1) return "Medium";
                return "Regular";
            }
            // Если явно bold/medium/regular — нормализуем капитализацию
            if (s.indexOf("bold") !== -1) return "Bold";
            if (s.indexOf("medium") !== -1) return "Medium";
            if (s.indexOf("regular") !== -1) return "Regular";
            return String(style || "");
        }

        function isValidTextTarget(textRange) {
            if (!textRange) {
                return false;
            }
            try {
                if (textRange.isValid === false) {
                    return false;
                }
            } catch (error) {}
            return true;
        }

        function applyVariableAxes(textRange, attrs, report) {
            if (!attrs || !attrs.variableAxes || !isValidTextTarget(textRange)) {
                return;
            }

            var axesData = null;
            try {
                axesData = textRange.appliedFont.designAxesData;
            } catch (error) {
                axesData = null;
            }

            if (!axesData || !axesData.length) {
                return;
            }

            var i;
            for (i = 0; i < axesData.length; i++) {
                var axisInfo = axesData[i];
                var axisValue = resolveAxisValue(attrs.variableAxes, axisInfo);
                if (axisValue === null || axisValue === undefined) {
                    continue;
                }
                trySetDesignAxis(textRange, i, axisValue, report, axisInfo);
            }
        }

        function resolveAxisValue(variableAxes, axisInfo) {
            if (!variableAxes || !axisInfo) {
                return null;
            }

            var keys = [];
            pushAxisKey(keys, axisInfo.tag);
            pushAxisKey(keys, axisInfo.name);

            var i;
            for (i = 0; i < keys.length; i++) {
                if (variableAxes.hasOwnProperty(keys[i])) {
                    return variableAxes[keys[i]];
                }
            }
            return null;
        }

        function pushAxisKey(list, value) {
            if (!value) {
                return;
            }
            var normalized = normalizeAxisKey(value);
            if (!normalized) {
                return;
            }
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i] == normalized) {
                    return;
                }
            }
            list.push(normalized);
        }

        function normalizeAxisKey(value) {
            return String(value).toLowerCase().replace(/[^a-z]/g, "");
        }

        function trySetDesignAxis(textRange, axisIndex, axisValue, report, axisInfo) {
            try {
                textRange.setNthDesignAxis(axisIndex + 1, axisValue);
                return;
            } catch (error) {}

            try {
                textRange.setNthDesignAxis(axisIndex, axisValue);
                return;
            } catch (error2) {
                warnOnce(report, "axis:" + getAxisDebugName(axisInfo, axisIndex) + ":" + axisValue, "Unable to set variable axis " + getAxisDebugName(axisInfo, axisIndex) + " to " + axisValue + ": " + error2.message);
            }
        }

        function getAxisDebugName(axisInfo, axisIndex) {
            if (!axisInfo) {
                return "#" + axisIndex;
            }
            return safeGet(axisInfo.tag, safeGet(axisInfo.name, "#" + axisIndex));
        }

        // Кернинг Иллюстратора: OPTICAL / AUTO (= метрический) / METRICSROMANONLY / NOAUTOKERN.
        // Без этого InDesign ставит метрический, и строки с оптическим кернингом выходят шире на 1–2%.
        function applyKerningMethod(textRange, method, report) {
            if (!method) {
                return;
            }
            var m = String(method).toUpperCase();
            var names = null;
            if (m.indexOf("OPTICAL") !== -1) {
                names = ["$ID/Optical", "Optical"];
            } else if (m.indexOf("ROMAN") !== -1) {
                names = ["$ID/Metrics - Roman Only", "$ID/Metrics", "Metrics"];
            } else if (m.indexOf("NOAUTO") !== -1) {
                names = ["$ID/None", "None"];
            } else if (m.indexOf("AUTO") !== -1 || m.indexOf("METRIC") !== -1) {
                names = ["$ID/Metrics", "Metrics"];
            }
            if (!names) {
                return;
            }
            var i;
            for (i = 0; i < names.length; i++) {
                try {
                    textRange.kerningMethod = names[i];
                    return;
                } catch (error) {}
            }
            pushWarning(report, "Unable to set kerning method " + method);
        }

        function clearFrameChrome(doc, frame) {
            try { frame.strokeWeight = 0; } catch (strokeWeightError) {}
            try { frame.strokeColor = doc.swatches.itemByName("None"); } catch (strokeColorError) {}
            try { frame.fillColor = doc.swatches.itemByName("None"); } catch (fillError) {}
        }

        function applyTextStroke(textRange, attrs, strokeColor, report) {
            var weight = attrs ? attrs.strokeWeight : 0;
            var hasStroke = weight && weight > 0 && strokeColor && strokeColor.isValid && strokeColor.name != "None";
            if (!hasStroke) {
                try { textRange.strokeWeight = 0; } catch (weightError) {}
                try { textRange.strokeColor = app.activeDocument.swatches.itemByName("None"); } catch (colorError) {}
                return;
            }
            trySet(textRange, "strokeColor", strokeColor, report);
            trySet(textRange, "strokeWeight", weight, report);
        }

        function applyLanguage(textRange, language, report) {
            var names = mapIllustratorLanguage(language);
            if (!names || !names.length || !isValidTextTarget(textRange)) {
                return;
            }
            var i;
            for (i = 0; i < names.length; i++) {
                try {
                    var lang = app.languagesWithVendors.itemByName(names[i]);
                    if (lang && lang.isValid) {
                        textRange.appliedLanguage = lang;
                        return;
                    }
                } catch (error) {}
            }
            pushWarning(report, "Unable to apply language: " + language);
        }

        function mapIllustratorLanguage(language) {
            if (!language) {
                return null;
            }
            var token = String(language).toUpperCase();
            token = token.replace(/^LANGUAGETYPE\./, "").replace(/^LANGUAGE\./, "");
            if (token.indexOf("RUSSIAN") !== -1) return ["Russian"];
            if (token.indexOf("UKRAIN") !== -1) return ["Ukrainian"];
            if (token.indexOf("UK") !== -1 && token.indexOf("ENGLISH") !== -1) return ["English: UK", "English: United Kingdom"];
            if (token.indexOf("ENGLISH") !== -1) return ["English: USA", "English: US"];
            if (token.indexOf("GERMAN") !== -1) return ["German: Reformed 1996", "German: Traditional", "German"];
            if (token.indexOf("FRENCH") !== -1) return ["French"];
            if (token.indexOf("SPANISH") !== -1) return ["Spanish"];
            if (token.indexOf("ITALIAN") !== -1) return ["Italian"];
            if (token.indexOf("PORTUGUESE") !== -1 || token.indexOf("BRAZIL") !== -1) return ["Portuguese: Brazilian", "Portuguese"];
            if (token.indexOf("TURKISH") !== -1) return ["Turkish"];
            if (token.indexOf("POLISH") !== -1) return ["Polish"];
            if (token.indexOf("CZECH") !== -1) return ["Czech"];
            if (token.indexOf("BULGAR") !== -1) return ["Bulgarian"];
            if (token.indexOf("KAZAKH") !== -1) return ["Kazakh"];
            if (token.indexOf("ROMANIAN") !== -1) return ["Romanian"];
            if (token.indexOf("HUNGAR") !== -1) return ["Hungarian"];
            if (token.indexOf("DUTCH") !== -1) return ["Dutch"];
            return null;
        }

        function applyHyphenation(paragraph, attrs, report) {
            if (!attrs) {
                return;
            }
            trySet(paragraph, "hyphenation", attrs.hyphenation, report);
            trySet(paragraph, "hyphenateCapitalizedWords", attrs.hyphenateCapitalizedWords, report);
            trySet(paragraph, "hyphenationZone", attrs.hyphenationZoneMm, report);
            trySet(paragraph, "hyphenateWordsLongerThan", attrs.minimumHyphenatedWordSize, report);
            trySet(paragraph, "hyphenateAfterFirst", attrs.minimumBeforeHyphen, report);
            trySet(paragraph, "hyphenateBeforeLast", attrs.minimumAfterHyphen, report);
            if (attrs.maximumConsecutiveHyphens === 0) {
                try { paragraph.hyphenationLadderLimit = 0; } catch (unlimitedError) {}
            } else {
                trySet(paragraph, "hyphenationLadderLimit", attrs.maximumConsecutiveHyphens, report);
            }
        }

        function applyCapitalization(textRange, capitalization, report) {
            if (!capitalization) {
                return;
            }

            // Точное имя значения: в «SMALLCAPS» есть подстрока «ALLCAPS», капитель становилась прописными.
            var normalized = String(capitalization).toUpperCase().replace(/^.*\./, "");
            try {
                if (normalized == "ALLSMALLCAPS") {
                    textRange.capitalization = Capitalization.CAP_TO_SMALL_CAP;
                } else if (normalized == "SMALLCAPS") {
                    textRange.capitalization = Capitalization.SMALL_CAPS;
                } else if (normalized == "ALLCAPS") {
                    textRange.capitalization = Capitalization.ALL_CAPS;
                } else if (normalized.indexOf("NORMAL") !== -1) {
                    textRange.capitalization = Capitalization.NORMAL;
                }
            } catch (error) {
                pushWarning(report, "Unable to apply capitalization: " + error.message);
            }
        }

        function applyParagraphAttributes(paragraph, attrs, report) {
            if (!attrs) {
                return;
            }

            trySet(paragraph, "firstLineIndent", points(attrs.firstLineIndent), report);
            trySet(paragraph, "leftIndent", points(attrs.leftIndent), report);
            trySet(paragraph, "rightIndent", points(attrs.rightIndent), report);
            trySet(paragraph, "spaceBefore", points(attrs.spaceBefore), report);
            trySet(paragraph, "spaceAfter", points(attrs.spaceAfter), report);
            applyHyphenation(paragraph, attrs, report);
            if (attrs.autoLeadingAmount > 0) {
                setQuiet(paragraph, "autoLeading", attrs.autoLeadingAmount, report);
            }
            // Компоновщик решает, где рвутся строки: «по строке» Иллюстратора = Single-line InDesign,
            // «весь абзац» = Paragraph Composer. По умолчанию у InDesign Paragraph — строки рвались не там.
            if (attrs.everyLineComposer === true) {
                setQuiet(paragraph, "composer", "$ID/HL Composer", report);
            } else if (attrs.everyLineComposer === false) {
                setQuiet(paragraph, "composer", "$ID/HL Single", report);
            }
            // Сначала максимумы, потом минимумы: InDesign не даёт поставить минимум больше текущего максимума.
            setQuiet(paragraph, "maximumWordSpacing", attrs.maximumWordSpacing, report);
            setQuiet(paragraph, "desiredWordSpacing", attrs.desiredWordSpacing, report);
            setQuiet(paragraph, "minimumWordSpacing", attrs.minimumWordSpacing, report);
            setQuiet(paragraph, "maximumLetterSpacing", attrs.maximumLetterSpacing, report);
            setQuiet(paragraph, "desiredLetterSpacing", attrs.desiredLetterSpacing, report);
            setQuiet(paragraph, "minimumLetterSpacing", attrs.minimumLetterSpacing, report);
            setQuiet(paragraph, "maximumGlyphScaling", attrs.maximumGlyphScaling, report);
            setQuiet(paragraph, "desiredGlyphScaling", attrs.desiredGlyphScaling, report);
            setQuiet(paragraph, "minimumGlyphScaling", attrs.minimumGlyphScaling, report);
            var singleName = String(attrs.singleWordJustification || "").toUpperCase().replace(/^.*\./, "");
            var single = null;
            if (singleName == "LEFT") {
                single = SingleWordJustification.LEFT_ALIGN;
            } else if (singleName == "CENTER") {
                single = SingleWordJustification.CENTER_ALIGN;
            } else if (singleName == "RIGHT") {
                single = SingleWordJustification.RIGHT_ALIGN;
            } else if (singleName.indexOf("FULLJUSTIFY") === 0) {
                single = SingleWordJustification.FULLY_JUSTIFIED;
            }
            if (single !== null) {
                setQuiet(paragraph, "singleWordJustification", single, report);
            }
            applyTabStops(paragraph, attrs.tabStops, report);

            var justification = mapJustification(attrs.justification);
            if (justification) {
                try {
                    paragraph.justification = justification;
                } catch (error) {
                    pushWarning(report, "Unable to apply paragraph justification: " + error.message);
                }
            }
        }

        // Выключка Иллюстратора → InDesign по точному имени. «По формату, последняя влево» раньше
        // находилась по слову LEFT и превращалась в «влево».
        function mapJustification(value) {
            if (!value) {
                return null;
            }
            var name = String(value).toUpperCase().replace(/^.*\./, "");
            switch (name) {
                case "LEFT": return Justification.LEFT_ALIGN;
                case "CENTER": return Justification.CENTER_ALIGN;
                case "RIGHT": return Justification.RIGHT_ALIGN;
                case "FULLJUSTIFYLASTLINELEFT": return Justification.LEFT_JUSTIFIED;
                case "FULLJUSTIFYLASTLINECENTER": return Justification.CENTER_JUSTIFIED;
                case "FULLJUSTIFYLASTLINERIGHT": return Justification.RIGHT_JUSTIFIED;
                case "FULLJUSTIFY": return Justification.FULLY_JUSTIFIED;
            }
            return null;
        }

        // Табуляция: позиции от левого края рамки, как в Иллюстраторе. Документ в мм.
        function applyTabStops(paragraph, stops, report) {
            if (!stops || !stops.length) {
                return;
            }
            try { paragraph.tabStops.everyItem().remove(); } catch (clearError) {}
            var i;
            for (i = 0; i < stops.length; i++) {
                var s = stops[i];
                var a = String(s.alignment || "").toUpperCase();
                var props = { position: Number(s.positionPt) * 25.4 / 72 };
                if (a.indexOf("CENTER") !== -1) {
                    props.alignment = TabStopAlignment.CENTER_ALIGN;
                } else if (a.indexOf("RIGHT") !== -1) {
                    props.alignment = TabStopAlignment.RIGHT_ALIGN;
                } else if (a.indexOf("DECIMAL") !== -1) {
                    props.alignment = TabStopAlignment.CHARACTER_ALIGN;
                    props.alignmentCharacter = s.decimalCharacter || ".";
                } else {
                    props.alignment = TabStopAlignment.LEFT_ALIGN;
                }
                if (s.leader) {
                    props.leader = s.leader;
                }
                try {
                    paragraph.tabStops.add(props);
                } catch (tabError) {
                    warnOnce(report, "tab:" + tabError.message, "Unable to add tab stop: " + tabError.message);
                }
            }
        }

        function points(value) {
            if (value === null || value === undefined || value === "") {
                return value;
            }
            if (!isFinite(value)) {
                return value;
            }
            return String(value) + "pt";
        }

        function fitTextFrameToStory(frame) {
            var story = null;
            try { story = frame.parentStory; } catch (storyError) {}
            if (!story || !story.overflows) {
                return;
            }
            var bounds = frame.geometricBounds;
            var guard = 0;
            var lineCount = 1;
            while (story.overflows && guard < 80) {
                try { lineCount = story.lines.length; } catch (lineError) { lineCount = 1; }
                if (lineCount <= 1) {
                    bounds[3] = bounds[3] + 8;
                } else {
                    bounds[2] = bounds[2] + 4;
                }
                frame.geometricBounds = bounds;
                guard++;
            }
            if (story.overflows) {
                appendLog("[Mismatch] text overset, frame still overflows");
            } else {
                appendLog("[Check] overset cleared, grew " + guard + " steps");
            }
        }

        function trySet(target, propertyName, value, report) {
            if (value === null || value === undefined || value === "") {
                return;
            }

            try {
                target[propertyName] = value;
            } catch (error) {
                pushWarning(report, "Unable to set " + propertyName + ": " + error.message);
            }
        }

        // Точечный текст Иллюстратора не переносится по строкам, а его anchor — начало первой базовой линии.
        // Рамка подгоняется под текст без переносов, первая базовая линия ставится ровно в anchor
        // (по выключке: слева / центр / справа). Повёрнутый текст ставится в неповёрнутом виде и
        // поворачивается так, чтобы anchor попал на своё место.
        function placePointTextOnBaseline(frame, item, report) {
            var prefs = frame.textFramePreferences;
            try { prefs.insetSpacing = [0, 0, 0, 0]; } catch (insetError) {}
            try { prefs.firstBaselineOffset = FirstBaseline.ASCENT_OFFSET; } catch (baselineError) {}
            try { prefs.verticalJustification = VerticalJustification.TOP_ALIGN; } catch (vjError) {}
            var autoSized = false;
            try {
                prefs.useNoLineBreaksForAutoSizing = true;
                prefs.autoSizingReferencePoint = AutoSizingReferenceEnum.TOP_LEFT_POINT;
                prefs.autoSizingType = AutoSizingTypeEnum.HEIGHT_AND_WIDTH;
                autoSized = true;
            } catch (autoError) {
                appendLog("Point text auto-size failed: " + autoError.message);
            }
            if (!autoSized) {
                var wide = frame.geometricBounds;
                frame.geometricBounds = [wide[0], wide[1], wide[2] + 100, wide[3] + 600];
            }
            var line = null;
            try { line = frame.lines[0]; } catch (lineError) {}
            if (!line || !line.isValid) {
                appendLog("[Mismatch] point text " + item.id + " has no first line, fallback to box placement");
                return false;
            }
            var startX = line.horizontalOffset;
            var endX = startX;
            try { endX = line.endHorizontalOffset; } catch (endError) {}
            var baseY = line.baseline;
            var just = null;
            try { just = frame.paragraphs[0].justification; } catch (justError) {}
            var refX = startX;
            if (just == Justification.CENTER_ALIGN || just == Justification.CENTER_JUSTIFIED) {
                refX = (startX + endX) / 2;
            } else if (just == Justification.RIGHT_ALIGN || just == Justification.RIGHT_JUSTIFIED) {
                refX = endX;
            }
            var general = generalTextMatrix(item);
            var spin = !general && hasSpin(item) ? Number(item.rotation) : 0;
            var target = { x: item.anchor.x, y: item.anchor.y };
            if (spin) {
                var center = { x: item.bounds.x + item.bounds.width / 2, y: item.bounds.y + item.bounds.height / 2 };
                target = rotatePagePoint(target, center, -spin);
            }
            frame.move(undefined, [target.x - refX, target.y - baseY]);
            if (spin) {
                var fb = frame.geometricBounds;
                var frameCenter = { x: (fb[1] + fb[3]) / 2, y: (fb[0] + fb[2]) / 2 };
                rotateAroundCenter(frame, spin, report);
                var landed = rotatePagePoint(target, frameCenter, spin);
                frame.move(undefined, [item.anchor.x - landed.x, item.anchor.y - landed.y]);
                appendLog("[Check] point text " + item.id + " baseline on anchor " + round2(item.anchor.x) + "," + round2(item.anchor.y) + " rot=" + round2(spin));
            } else {
                var after = frame.lines[0];
                var ax = after.horizontalOffset;
                var axEnd = ax;
                try { axEnd = after.endHorizontalOffset; } catch (endError2) {}
                var nowX = refX == startX ? ax : (refX == endX ? axEnd : (ax + axEnd) / 2);
                var dmax = Math.max(Math.abs(nowX - item.anchor.x), Math.abs(after.baseline - item.anchor.y));
                appendLog((dmax > 0.1 ? "[Mismatch] " : "[Check] ") + "point text " + itemLabel(item) + " baseline Δ=" + round2(dmax) + "mm");
                if (general) {
                    applyTextMatrixAroundAnchor(frame, item, general, report);
                }
            }
            if (frame.overflows) {
                appendLog("[Mismatch] point text " + itemLabel(item) + " overset");
            }
            return true;
        }

        // Матрица точечного текста, если в ней не только поворот: отражение, наклон, растяжение.
        function generalTextMatrix(item) {
            var m = item ? item.matrix : null;
            if (!m || !isFinite(m.a) || !isFinite(m.b) || !isFinite(m.c) || !isFinite(m.d)) {
                return null;
            }
            var det = m.a * m.d - m.b * m.c;
            var skew = Math.abs(m.a * m.c + m.b * m.d);
            var sx = Math.sqrt(m.a * m.a + m.b * m.b);
            var sy = Math.sqrt(m.c * m.c + m.d * m.d);
            if (det < 0 || skew > 0.001 || Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
                return m;
            }
            return null;
        }

        // Текст уже стоит базовой линией в anchor без трансформации; применяем линейную часть матрицы
        // Иллюстратора (ось y у InDesign вниз: [a, -b, -c, d]) и возвращаем anchor на место.
        function applyTextMatrixAroundAnchor(frame, item, m, report) {
            try {
                var fb = frame.geometricBounds;
                var c = { x: (fb[1] + fb[3]) / 2, y: (fb[0] + fb[2]) / 2 };
                frame.transform(CoordinateSpaces.PASTEBOARD_COORDINATES, AnchorPoint.CENTER_ANCHOR, [m.a, -m.b, -m.c, m.d, 0, 0]);
                var dx = item.anchor.x - c.x;
                var dy = item.anchor.y - c.y;
                var landed = { x: c.x + m.a * dx - m.c * dy, y: c.y - m.b * dx + m.d * dy };
                frame.move(undefined, [item.anchor.x - landed.x, item.anchor.y - landed.y]);
                appendLog("[Check] point text " + itemLabel(item) + " matrix " + round2(m.a) + "," + round2(m.b) + "," + round2(m.c) + "," + round2(m.d) + " applied around anchor");
            } catch (matrixError) {
                appendLog("[Mismatch] point text " + itemLabel(item) + " matrix failed: " + matrixError.message);
                pushWarning(report, "Text transform failed for " + itemLabel(item) + ": " + matrixError.message);
            }
        }

        // Поворот точки против часовой (как в интерфейсе) в координатах страницы, где y растёт вниз.
        function rotatePagePoint(p, c, degrees) {
            var rad = degrees * Math.PI / 180;
            var cos = Math.cos(rad);
            var sin = Math.sin(rad);
            var dx = p.x - c.x;
            var dy = p.y - c.y;
            return { x: c.x + dx * cos + dy * sin, y: c.y - dx * sin + dy * cos };
        }

        function findLabeledItem(page, label) {
            var all = page.allPageItems;
            var i;
            for (i = 0; i < all.length; i++) {
                try {
                    if (all[i].label == label) {
                        return all[i].getElements()[0];
                    }
                } catch (labelError) {}
            }
            return null;
        }

        function styleVectorItem(doc, page, item, report) {
            var g = item ? item.fillGradient : null;
            if (!g || !g.stops || g.stops.length < 2) {
                return false;
            }
            var target = findLabeledItem(page, "A2I:" + item.id);
            if (!target) {
                appendLog("styleVector: pasted item not found " + item.id);
                return false;
            }
            try {
                if (target.constructor.name == "Group" && target.pageItems.length == 1) {
                    target = target.pageItems[0].getElements()[0];
                }
            } catch (groupError) {}
            var radial = g.type == "radial";
            var gradient = doc.gradients.add({ type: radial ? GradientType.RADIAL : GradientType.LINEAR });
            var stops = gradient.gradientStops;
            var k;
            while (stops.length < g.stops.length) {
                stops.add();
            }
            for (k = 0; k < g.stops.length; k++) {
                try { stops[k].stopColor = readColor(doc, g.stops[k].color, report, "grad"); } catch (colorError) { appendLog("Gradient stop color failed: " + colorError.message); }
                try { stops[k].location = g.stops[k].ramp; } catch (locationError) { appendLog("Gradient stop location failed: " + locationError.message); }
                if (k > 0) {
                    try { stops[k].midpoint = g.stops[k - 1].mid; } catch (midError) {}
                }
            }
            target.fillColor = gradient;
            try { target.fillTint = 100; } catch (tintError) {}
            target.gradientFillStart = [g.origin.x, g.origin.y];
            if (!radial) {
                target.gradientFillAngle = g.angle;
            }
            target.gradientFillLength = g.length;
            var featherMode = "";
            if (g.hasOpacity) {
                featherMode = applyOpacityStops(target, g, report);
            }
            appendLog("Gradient fill " + item.id + " " + g.type + " stops=" + g.stops.length + " start=" + round2(g.origin.x) + "," + round2(g.origin.y) +
                " angle=" + round2(g.angle) + " len=" + round2(g.length) + (featherMode ? " opacity=" + featherMode : "") + (g.matrixApplied ? " matrix" : ""));
            return true;
        }

        // Прозрачность точек градиента = растушёвка (Gradient Feather). У InDesign длина растушёвки не больше
        // 1000 pt (352,7 мм). Длинный спад между двумя точками делим на две растушёвки — на объект и на заливку:
        // их прозрачности перемножаются и дают тот же линейный спад.
        function applyOpacityStops(target, g, report) {
            var MAX = 352.7;
            var L = g.length;
            var s = g.stops;
            var radial = g.type == "radial";
            var rad = (g.angle || 0) * Math.PI / 180;
            var ux = Math.cos(rad);
            var uy = -Math.sin(rad);
            var d0 = s[0].ramp / 100 * L;
            var d1 = s[s.length - 1].ramp / 100 * L;
            var span = d1 - d0;
            var k;

            function setFeather(settings, startDist, len, list) {
                settings.applied = true;
                settings.type = radial ? GradientType.RADIAL : GradientType.LINEAR;
                if (!radial) {
                    settings.angle = g.angle;
                }
                settings.gradientStart = radial ? [g.origin.x, g.origin.y] : [g.origin.x + ux * startDist, g.origin.y + uy * startDist];
                settings.length = Math.max(len, 0.01);
                var st = settings.opacityGradientStops;
                while (st.length < list.length) {
                    st.add();
                }
                var n;
                for (n = 0; n < list.length; n++) {
                    try { st[n].location = Math.max(0, Math.min(100, list[n].loc)); } catch (locError) {}
                    try { st[n].opacity = Math.max(0, Math.min(100, list[n].op)); } catch (opError) {}
                }
            }

            function stopList(windowStart, windowLen) {
                var list = [];
                var n;
                for (n = 0; n < s.length; n++) {
                    list.push({ loc: windowLen > 0 ? (s[n].ramp / 100 * L - windowStart) / windowLen * 100 : (n ? 100 : 0), op: s[n].opacity });
                }
                return list;
            }

            var objectFeather = target.transparencySettings.gradientFeatherSettings;
            var fillFeather = target.fillTransparencySettings.gradientFeatherSettings;
            if (radial) {
                if (d1 <= MAX) {
                    setFeather(objectFeather, 0, d1, stopList(0, d1));
                    return "radial";
                }
                setFeather(objectFeather, 0, MAX, stopList(0, d1));
                pushWarning(report, "Radial gradient opacity longer than 352.7 mm, compressed.");
                return "radial-compressed";
            }
            if (span <= MAX) {
                setFeather(objectFeather, d0, span, stopList(d0, span));
                return "single";
            }
            if (s.length == 2) {
                var o0 = s[0].opacity;
                var o1 = s[1].opacity;
                var om = (o0 + o1) / 2;
                if (span / 2 <= MAX && om > 0.01) {
                    setFeather(objectFeather, d0, span / 2, [{ loc: 0, op: o0 }, { loc: 100, op: om }]);
                    setFeather(fillFeather, d0 + span / 2, span / 2, [{ loc: 0, op: 100 }, { loc: 100, op: 100 * o1 / om }]);
                    return "split";
                }
            }
            var start = d1 - MAX;
            setFeather(objectFeather, start, MAX, stopList(start, MAX));
            pushWarning(report, "Gradient opacity span " + round2(span) + " mm is longer than InDesign allows, approximated.");
            return "approx";
        }

        function importTextFrame(doc, page, item, report) {
            if (item && item.textOnPath && item.textOnPath.points && item.textOnPath.points.length) {
                try {
                    importTextOnPath(doc, page, item, report);
                    return;
                } catch (pathError) {
                    pushWarning(report, "Text on path failed, placed as a regular frame: " + pathError.message);
                }
            }

            var frame = page.textFrames.add();
            clearFrameChrome(doc, frame);
            placeUnrotatedBox(frame, item);
            var shaped = applyAreaFrameShape(frame, item, report);
            applyAreaFramePreferences(frame, item, report);
            frame.contents = illustratorTextToInDesign(item.contents);
            nameImportedItem(frame, item);
            labelGroups(frame, item);
            applyPageItemTransform(frame, item, report);
            applyStoryFormatting(frame.parentStory, item, doc, report);
            if (item.orientation == "VERTICAL") {
                appendLog("[Mismatch] text " + itemLabel(item) + " is vertical in Illustrator; this InDesign has no vertical story orientation, placed horizontally");
                pushWarning(report, "Vertical text placed horizontally: " + itemLabel(item));
            }
            if (item.anchor && String(item.frameKind || "").toUpperCase().indexOf("POINT") !== -1 && placePointTextOnBaseline(frame, item, report)) {
                report.importedTextFrames++;
                return;
            }
            var threaded = linkThreadFrames(page, frame, item, report);
            if (item.aiOverset) {
                appendLog("[Check] text " + itemLabel(item) + " overset in Illustrator too, frame size kept");
            } else if (!threaded) {
                fitTextFrameToStory(frame);
            }
            if (hasSpin(item)) {
                rotateAroundCenter(frame, item.rotation, report);
                if (shaped) {
                    var gb = frame.geometricBounds;
                    frame.move(undefined, [item.bounds.x + item.bounds.width / 2 - (gb[1] + gb[3]) / 2, item.bounds.y + item.bounds.height / 2 - (gb[0] + gb[2]) / 2]);
                }
            }
            checkPlacement(frame, item, "text " + itemLabel(item));
            report.importedTextFrames++;
        }

        // Метка групп Иллюстратора с прозрачностью/наложением, в которых лежит объект.
        function labelGroups(pageItem, item) {
            if (!pageItem || !item || !item.groups || !item.groups.length) {
                return;
            }
            var ids = [];
            var i;
            for (i = 0; i < item.groups.length; i++) {
                ids.push(String(item.groups[i].id || item.groups[i]));
            }
            try { pageItem.insertLabel("a2iGroups", ids.join(",")); } catch (labelError) {}
        }

        // Группа Иллюстратора с прозрачностью или наложением: все её объекты уже стоят — собираем их
        // в группу InDesign и ставим ту же прозрачность на группу (перекрытия не темнеют, как в Иллюстраторе).
        function groupLabeledItems(doc, page, data, report) {
            var g = data.group || {};
            var gid = String(g.id);
            var members = [];
            var items = page.pageItems;
            var i;
            for (i = 0; i < items.length; i++) {
                var it = items[i];
                var list = "";
                try { list = it.extractLabel("a2iGroups"); } catch (readError) { list = ""; }
                if (list && ("," + list + ",").indexOf("," + gid + ",") !== -1) {
                    members.push(it.getElements()[0]);
                }
            }
            if (!members.length) {
                appendLog("[Mismatch] group «" + safeGet(g.name, gid) + "»: no members found, opacity " + g.opacity + " not applied");
                return "SKIPPED";
            }
            var target = members[0];
            if (members.length > 1) {
                try {
                    target = page.groups.add(members);
                } catch (groupError) {
                    appendLog("[Mismatch] group «" + safeGet(g.name, gid) + "»: " + groupError.message);
                    return "SKIPPED";
                }
            }
            // Обтравочная маска: рамка с контуром маски, объекты — внутрь (Paste Into сохраняет их место).
            if (g.clip && g.clip.points && g.clip.points.length > 1) {
                try {
                    var holder = page.polygons.add();
                    clearFrameChrome(doc, holder);
                    holder.paths[0].entirePath = toPathArray(g.clip.points);
                    if (g.clip.closed === false) {
                        try { holder.paths[0].pathType = PathType.OPEN_PATH; } catch (openError) {}
                    }
                    app.select(target);
                    app.cut();
                    app.select(holder);
                    app.pasteInto();
                    app.select(NothingEnum.NOTHING);
                    target = holder;
                    appendLog("[Check] clip mask «" + safeGet(g.name, gid) + "»: " + members.length + " items pasted into the mask frame");
                } catch (clipError) {
                    appendLog("[Mismatch] clip mask «" + safeGet(g.name, gid) + "» not applied: " + clipError.message);
                    pushWarning(report, "Clip mask not applied: " + safeGet(g.name, gid));
                }
            }
            var outer = data.outer || [];
            try { target.insertLabel("a2iGroups", outer.join(",")); } catch (outerError) {}
            if (g.name && g.name != "GroupItem") {
                try { target.name = String(g.name); } catch (nameError) {}
            }
            var bs = target.transparencySettings.blendingSettings;
            if (g.opacity !== null && g.opacity !== undefined && g.opacity < 100) {
                var own = 100;
                try { own = bs.opacity; } catch (ownError) {}
                try { bs.opacity = members.length > 1 ? g.opacity : own * g.opacity / 100; } catch (opacityError) {}
            }
            var blend = mapBlendMode(g.blendMode);
            if (blend !== null && blend != BlendMode.NORMAL) {
                try { bs.blendMode = blend; } catch (blendError) {}
            }
            appendLog("[Check] group «" + safeGet(g.name, gid) + "»: " + members.length + " items, opacity " + g.opacity + (g.blendMode ? ", " + g.blendMode : ""));
            return "OK";
        }

        function itemLabel(item) {
            return item && item.name && item.name != "TextFrame" ? "«" + item.name + "»" : (item ? item.id : "?");
        }

        // Имя объекта из Иллюстратора — в панель Layers InDesign (по нему же ищутся объекты при сверке).
        function nameImportedItem(pageItem, item) {
            if (!pageItem || !item || !item.name) {
                return;
            }
            var typeNames = { TextFrame: 1, PathItem: 1, CompoundPathItem: 1, GroupItem: 1, PlacedItem: 1, RasterItem: 1 };
            if (typeNames[item.name]) {
                return;
            }
            try { pageItem.name = String(item.name); } catch (nameError) {}
        }

        // Текст в фигуре (круг, многоугольник): рамка InDesign получает тот же контур.
        function applyAreaFrameShape(frame, item, report) {
            var a = item.areaFrame;
            if (!a || a.isRect || !a.points || a.points.length < 3) {
                return false;
            }
            try {
                frame.paths[0].entirePath = toPathArray(a.points);
                appendLog("Area text shape " + itemLabel(item) + ": " + a.points.length + " points");
                return true;
            } catch (shapeError) {
                pushWarning(report, "Area text shape failed for " + itemLabel(item) + ": " + shapeError.message);
                return false;
            }
        }

        // Колонки, отступ от рамки, первая строка — как в Area Type Options Иллюстратора.
        function applyAreaFramePreferences(frame, item, report) {
            var a = item.areaFrame;
            if (!a) {
                return;
            }
            var prefs = frame.textFramePreferences;
            var inset = a.insetMm > 0 ? a.insetMm : 0;
            setQuiet(prefs, "insetSpacing", [inset, inset, inset, inset], report);
            if (a.columnCount > 1) {
                setQuiet(prefs, "textColumnCount", a.columnCount, report);
                if (a.columnGutterMm !== null && a.columnGutterMm !== undefined) {
                    setQuiet(prefs, "textColumnGutter", a.columnGutterMm, report);
                }
            }
            if (a.rowCount > 1) {
                appendLog("[Mismatch] text " + itemLabel(item) + " has " + a.rowCount + " rows in Illustrator; InDesign frames have no rows");
                pushWarning(report, "Area text rows are not supported in InDesign: " + itemLabel(item));
            }
            var fb = String(a.firstBaseline || "").toUpperCase().replace(/^.*\./, "");
            var map = {
                BASELINEASCENT: FirstBaseline.ASCENT_OFFSET,
                BASELINELEGACY: FirstBaseline.ASCENT_OFFSET,
                BASELINECAPHEIGHT: FirstBaseline.CAP_HEIGHT,
                BASELINELEADING: FirstBaseline.LEADING_OFFSET,
                BASELINEXHEIGHT: FirstBaseline.X_HEIGHT,
                BASELINEEMBOXHEIGHT: FirstBaseline.EMBOX_HEIGHT,
                BASELINEFIXED: FirstBaseline.FIXED_HEIGHT
            };
            if (map[fb] !== undefined) {
                setQuiet(prefs, "firstBaselineOffset", map[fb], report);
            }
            if (a.firstBaselineMinMm > 0) {
                setQuiet(prefs, "minimumFirstBaselineOffset", a.firstBaselineMinMm, report);
            }
        }

        // Связанные рамки: метим рамку ключом цепочки и номером, связываем с соседями, которые уже стоят.
        // InDesign при связке дописывает текст следующей рамки в конец истории — формат сохраняется.
        function linkThreadFrames(page, frame, item, report) {
            var th = item.thread;
            if (!th) {
                return false;
            }
            try {
                frame.insertLabel("a2iThreadKey", String(th.key));
                frame.insertLabel("a2iThreadIndex", String(th.index));
            } catch (labelError) {}
            var prev = null;
            var next = null;
            var frames = page.textFrames;
            var i;
            for (i = 0; i < frames.length; i++) {
                var f = frames[i];
                try {
                    if (f.id == frame.id || f.extractLabel("a2iThreadKey") != String(th.key)) {
                        continue;
                    }
                    var idx = Number(f.extractLabel("a2iThreadIndex"));
                    if (idx == th.index - 1) {
                        prev = f;
                    } else if (idx == th.index + 1) {
                        next = f;
                    }
                } catch (scanError) {}
            }
            try {
                if (prev) {
                    prev.nextTextFrame = frame;
                }
                if (next) {
                    frame.nextTextFrame = next;
                }
                appendLog("Thread " + itemLabel(item) + " #" + th.index + (prev ? " linked after previous" : "") + (next ? " linked before next" : ""));
            } catch (linkError) {
                pushWarning(report, "Text thread link failed for " + itemLabel(item) + ": " + linkError.message);
            }
            return true;
        }

        function importTextOnPath(doc, page, item, report) {
            var pathData = item.textOnPath;
            var host = page.polygons.add();
            var trimmed = trimTextPath(pathData);
            host.paths[0].entirePath = toPathArray(trimmed ? trimmed : (pathData.points || []));
            nameImportedItem(host, item);
            labelGroups(host, item);
            if (trimmed) {
                appendLog("Text path " + itemLabel(item) + " trimmed to Illustrator start/end " + round2(pathData.startT) + ".." + round2(pathData.endT));
            }
            if (pathData.closed === false || trimmed) {
                try {
                    host.paths[0].pathType = PathType.OPEN_PATH;
                } catch (openError) {
                    pushWarning(report, "Open text path stayed closed: " + openError.message);
                }
            }

            // Новый контур InDesign берёт обводку по умолчанию (последнюю применённую) — сначала снимаем всё.
            clearFrameChrome(doc, host);
            if (pathData.filled) {
                try { host.fillColor = readColor(doc, pathData.fillColor, report, "textpath_fill"); } catch (fillError) {}
            }
            if (pathData.stroked) {
                try {
                    host.strokeColor = readColor(doc, pathData.strokeColor, report, "textpath_stroke");
                    host.strokeWeight = safeGet(pathData.strokeWidthMm, 0) * 72 / 25.4;
                } catch (strokeError) {
                    pushWarning(report, "Text path stroke failed for " + itemLabel(item) + ": " + strokeError.message);
                }
            }

            var textPath = host.textPaths.add();
            textPath.contents = illustratorTextToInDesign(item.contents);
            if (pathData.polarity && String(pathData.polarity).toUpperCase().indexOf("NEGATIVE") !== -1) {
                try {
                    textPath.flipPathEffect = true;
                } catch (flipError) {}
            }
            applyStoryFormatting(textPath.parentStory, item, doc, report);
            applyTransparencySettings(host, item, report);
            report.importedTextFrames++;
            appendLog("Path text imported: " + item.id);
        }

        function applyStoryFormatting(story, item, doc, report) {
            if (!story || !item) {
                return;
            }

            try {
                applyCharacterAttributes(story.texts[0], item.defaultCharacterStyle, doc, report, "default");
            } catch (error) {
                pushWarning(report, "Failed applying default text attributes: " + error.message);
            }

            var indexMap = buildAiIndexMap(illustratorTextToInDesign(item.contents));
            var lastIndex = story.characters.length - 1;
            var i;
            if (item.characterRuns) {
                for (i = 0; i < item.characterRuns.length; i++) {
                    var run = item.characterRuns[i];
                    try {
                        var from = mapAiIndex(indexMap, run.start);
                        var to = Math.min(mapAiIndex(indexMap, run.end), lastIndex);
                        if (to < from) {
                            continue;
                        }
                        var range = story.characters.itemByRange(from, to);
                        applyCharacterAttributes(range, run.attributes, doc, report, "run_" + i);
                    } catch (error2) {
                        pushWarning(report, "Failed applying character run " + i + ": " + error2.message);
                    }
                }
            }

            alignBreakCharacters(story, item, indexMap);

            if (item.paragraphStyles) {
                for (i = 0; i < item.paragraphStyles.length; i++) {
                    var p = item.paragraphStyles[i];
                    try {
                        var paragraph = null;
                        if (p.start !== null && p.start !== undefined && isFinite(p.start)) {
                            var at = Math.min(mapAiIndex(indexMap, p.start), lastIndex);
                            if (at >= 0) {
                                paragraph = story.characters[at].paragraphs[0];
                            }
                        } else if (story.paragraphs.length > p.index) {
                            paragraph = story.paragraphs[p.index];
                        }
                        if (paragraph) {
                            applyParagraphAttributes(paragraph, p.attributes, report);
                        }
                    } catch (error3) {
                        pushWarning(report, "Failed applying paragraph attrs " + i + ": " + error3.message);
                    }
                }
            }
            applyManualKerning(story, item, indexMap, report);
        }

        function illustratorTextToInDesign(value) {
            var text = safeDecodeURIComponent(safeGet(value, ""));
            return String(text)
                .replace(/\u0003/g, "\n")
                .replace(/\u000b/g, "\n")
                .replace(/\u2028/g, "\n");
        }

        function safeDecodeURIComponent(value) {
            if (value === null || value === undefined) {
                return "";
            }
            var str = String(value);
            try {
                return decodeURIComponent(str);
            } catch (e) {
                // Если пришёл уже “как есть” (не percent-encoded), просто возвращаем строку.
                return str;
            }
        }

        function toPathArray(points) {
            var path = [];
            var i;
            for (i = 0; i < points.length; i++) {
                var point = points[i];
                if (!point) {
                    continue;
                }

                if (isCurvedPoint(point)) {
                    path.push([
                        [point.leftDirection.x, point.leftDirection.y],
                        [point.anchor.x, point.anchor.y],
                        [point.rightDirection.x, point.rightDirection.y]
                    ]);
                } else {
                    path.push([point.anchor.x, point.anchor.y]);
                }
            }
            return path;
        }

        // Текст по контуру у Иллюстратора начинается в startT и кончается в endT (номер сегмента + доля).
        // InDesign начинает с первой точки — режем контур по этим местам (кривые Безье делим точно).
        function trimTextPath(pathData) {
            var pts = pathData ? pathData.points : null;
            if (!pts || pts.length < 2) {
                return null;
            }
            var closed = pathData.closed !== false;
            var nSeg = closed ? pts.length : pts.length - 1;
            var s = isFinite(pathData.startT) ? Number(pathData.startT) : 0;
            var e = isFinite(pathData.endT) ? Number(pathData.endT) : nSeg;
            if (s < 0.005 && e > nSeg - 0.02) {
                return null;
            }
            if (s < 0) { s = 0; }
            if (e > nSeg) { e = nSeg; }
            if (closed && e <= s) {
                e += nSeg;
            }
            if (e - s < 0.001) {
                return null;
            }
            function seg(k) {
                var a = pts[k % pts.length];
                var b = pts[(k + 1) % pts.length];
                return [
                    [a.anchor.x, a.anchor.y],
                    [a.rightDirection ? a.rightDirection.x : a.anchor.x, a.rightDirection ? a.rightDirection.y : a.anchor.y],
                    [b.leftDirection ? b.leftDirection.x : b.anchor.x, b.leftDirection ? b.leftDirection.y : b.anchor.y],
                    [b.anchor.x, b.anchor.y]
                ];
            }
            function lerp(p, q, t) {
                return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
            }
            // Часть кубической кривой от t0 до t1 (де Кастельжо).
            function sub(c, t0, t1) {
                var c1 = c;
                if (t1 < 1) {
                    var a1 = lerp(c[0], c[1], t1), b1 = lerp(c[1], c[2], t1), d1 = lerp(c[2], c[3], t1);
                    var e1 = lerp(a1, b1, t1), f1 = lerp(b1, d1, t1), g1 = lerp(e1, f1, t1);
                    c1 = [c[0], a1, e1, g1];
                }
                if (t0 > 0) {
                    var u = t1 > 0 ? t0 / t1 : 0;
                    var a2 = lerp(c1[0], c1[1], u), b2 = lerp(c1[1], c1[2], u), d2 = lerp(c1[2], c1[3], u);
                    var e2 = lerp(a2, b2, u), f2 = lerp(b2, d2, u), g2 = lerp(e2, f2, u);
                    c1 = [g2, f2, d2, c1[3]];
                }
                return c1;
            }
            var curves = [];
            var k = Math.floor(s);
            while (k < e && curves.length <= nSeg + 1) {
                var t0 = Math.max(s - k, 0);
                var t1 = Math.min(e - k, 1);
                if (t1 - t0 > 0.0001) {
                    curves.push(sub(seg(k % nSeg), t0, t1));
                }
                k++;
            }
            if (!curves.length) {
                return null;
            }
            var out = [];
            var i;
            for (i = 0; i < curves.length; i++) {
                var c = curves[i];
                if (i === 0) {
                    out.push({ anchor: { x: c[0][0], y: c[0][1] }, leftDirection: { x: c[0][0], y: c[0][1] }, rightDirection: { x: c[1][0], y: c[1][1] } });
                } else {
                    out[out.length - 1].rightDirection = { x: c[1][0], y: c[1][1] };
                }
                out.push({ anchor: { x: c[3][0], y: c[3][1] }, leftDirection: { x: c[2][0], y: c[2][1] }, rightDirection: { x: c[3][0], y: c[3][1] } });
            }
            return out;
        }

        function isCurvedPoint(point) {
            return point.leftDirection &&
                point.rightDirection &&
                (point.leftDirection.x != point.anchor.x ||
                    point.leftDirection.y != point.anchor.y ||
                    point.rightDirection.x != point.anchor.x ||
                    point.rightDirection.y != point.anchor.y);
        }

        function importVectorItem(doc, page, item, report) {
            if (item && item.itemType == "VectorClipboardItem") {
                importVectorClipboardItem(doc, page, item, report);
                return;
            }

            try {
                if (item.itemType == "Line") {
                    importLine(doc, page, item, report);
                } else {
                    importClosedPath(doc, page, item, report);
                }
                report.importedVectorItems++;
            } catch (error) {
                pushWarning(report, "Vector import failed, item " + safeGet(item.id, "unknown") + ": " + error.message);
            }
        }

        function importVectorClipboardItem(doc, page, item, report) {
            if (!requestIllustratorCopy(payload.sourceDocument, item.sourcePageItemIndex, report)) {
                pushWarning(report, "Clipboard copy failed for sourcePageItemIndex " + item.sourcePageItemIndex);
                return;
            }

            try {
                app.activeWindow.activePage = page;
            } catch (pageError) {}

            try {
                app.menuActions.item("$ID/Paste in Place").invoke();
            } catch (pasteError) {
                pushWarning(report, "Paste in place failed: " + pasteError.message);
                return;
            }

            if (!app.selection || !app.selection.length) {
                pushWarning(report, "No pasted selection returned from InDesign.");
                return;
            }

            var pastedItem = normalizePastedSelection(page, report);
            if (!pastedItem) {
                pushWarning(report, "Unable to normalize pasted vector selection.");
                return;
            }

            try {
                placePastedItem(pastedItem, item);
                applyPageItemTransform(pastedItem, item, report);
                checkPlacement(pastedItem, item, "vector " + item.id);
            } catch (transformError) {
                pushWarning(report, "Unable to post-process pasted vector: " + transformError.message);
            }
            report.importedVectorItems++;
        }

        function normalizePastedSelection(page, report) {
            if (!app.selection || !app.selection.length) {
                return null;
            }

            if (app.selection.length == 1) {
                return app.selection[0];
            }

            try {
                return page.groups.add(app.selection);
            } catch (groupError) {
                try {
                    return app.selection[0];
                } catch (fallbackError) {
                    pushWarning(report, "Unable to normalize multi-item pasted selection: " + groupError.message);
                    return null;
                }
            }
        }

        function importLine(doc, page, item, report) {
            if (!item.points || item.points.length < 2) {
                throw new Error("Line has insufficient points.");
            }

            var line = page.graphicLines.add();
            line.paths[0].entirePath = [
                [item.points[0].anchor.x, item.points[0].anchor.y],
                [item.points[1].anchor.x, item.points[1].anchor.y]
            ];
            applyPageItemTransform(line, item, report);
            line.strokeWeight = safeGet(item.strokeWidth, 0);
            line.strokeColor = readColor(doc, item.strokeColor, report, "line_stroke");
            line.fillColor = doc.swatches.itemByName("None");
        }

        function importClosedPath(doc, page, item, report) {
            var polygon = page.polygons.add();
            polygon.paths[0].entirePath = toPathArray(item.points || []);
            applyPageItemTransform(polygon, item, report);

            if (item.closed === false) {
                try {
                    polygon.paths[0].pathType = PathType.OPEN_PATH;
                } catch (error) {
                    pushWarning(report, "Open path fallback not fully supported, kept closed.");
                }
            }

            polygon.strokeWeight = safeGet(item.strokeWidth, 0);
            polygon.fillColor = readColor(doc, item.fillColor, report, "vector_fill");
            polygon.strokeColor = readColor(doc, item.strokeColor, report, "vector_stroke");
        }

        function importVectorPdf(doc, page, item, report) {
            var file = new File(item.assetPath);
            if (!file.exists) {
                pushWarning(report, "Vector PDF missing: " + item.assetPath);
                return false;
            }
            var frame = page.rectangles.add();
            applyFrameBounds(frame, item.bounds);
            try {
                frame.strokeWeight = 0;
                frame.strokeColor = doc.swatches.itemByName("None");
                frame.fillColor = doc.swatches.itemByName("None");
            } catch (styleError) {}
            frame.place(file);
            try {
                frame.fit(FitOptions.CONTENT_TO_FRAME);
            } catch (fitError) {}
            applyTransparencySettings(frame, item, report);
            report.importedVectorItems++;
            return true;
        }

        function importAsset(page, item, report) {
            var file = new File(item.assetPath);
            if (!file.exists) {
                pushWarning(report, "Asset file missing: " + item.assetPath);
                return false;
            }
            if (item.geometry && item.geometry.width > 0 && item.geometry.height > 0) {
                return importImageWithMatrix(page, item, file, report);
            }

            var frame = page.rectangles.add();
            placeUnrotatedBox(frame, item);
            try {
                frame.strokeWeight = 0;
                frame.strokeColor = app.activeDocument.swatches.itemByName("None");
                frame.fillColor = app.activeDocument.swatches.itemByName("None");
            } catch (chromeError) {}
            applyPageItemTransform(frame, item, report);
            appendLog("Place asset start. id=" + item.id + " bytes=" + file.length + " bounds=" + round2(item.bounds.x) + "," + round2(item.bounds.y) + " " + round2(item.bounds.width) + "x" + round2(item.bounds.height));
            if (item.contentBounds) {
                try {
                    page.parent.parent.pasteboardPreferences.pasteboardMargins = ["4000mm", "4000mm"];
                } catch (marginError) {
                    appendLog("Pasteboard margins not set: " + marginError.message);
                }
            }
            try {
                frame.place(file);
            } catch (placeError) {
                appendLog("Place asset failed: " + placeError.message);
                pushWarning(report, "Place failed for " + item.id + ": " + placeError.message);
                return false;
            }
            if (item.contentBounds && frame.allGraphics && frame.allGraphics.length) {
                try {
                    frame.allGraphics[0].geometricBounds = [
                        item.contentBounds.y,
                        item.contentBounds.x,
                        item.contentBounds.y + item.contentBounds.height,
                        item.contentBounds.x + item.contentBounds.width
                    ];
                } catch (cropError) {
                    appendLog("Image extends off the pasteboard, fitted to the frame: " + cropError.message);
                    try {
                        frame.fit(FitOptions.FILL_PROPORTIONALLY);
                        frame.fit(FitOptions.CENTER_CONTENT);
                    } catch (fitError) {}
                }
            } else {
                try {
                    frame.fit(FitOptions.FILL_PROPORTIONALLY);
                    frame.fit(FitOptions.CENTER_CONTENT);
                } catch (error) {}
            }
            if (hasSpin(item)) {
                rotateAroundCenter(frame, item.rotation, report);
            }
            // Без sendToBack: объекты создаются снизу вверх, картинка уже на своём месте в стопке.
            checkPlacement(frame, item, "asset " + item.id);
            report.importedAssets++;
            return true;
        }

        // Картинка ставится той же матрицей, что в Иллюстраторе: поворот, отражение, наклон, растяжение.
        // Рамка W×H в единицах картинки, картинка вписана точно, потом линейная часть матрицы вокруг центра
        // и перенос центра в центр габаритов Иллюстратора. В маске — рамка получает контур маски,
        // а матрица ставится самой картинке внутри.
        function importImageWithMatrix(page, item, file, report) {
            var g = item.geometry;
            var PT = 25.4 / 72;
            var doc = page.parent.parent;
            var label = itemLabel(item);
            var matrix = [g.xx, g.yx, g.xy, g.yy, 0, 0];
            var frame = null;
            var graphic = null;
            try {
                if (item.clip && item.clip.points && item.clip.points.length > 1) {
                    frame = page.polygons.add();
                    clearFrameChrome(doc, frame);
                    frame.paths[0].entirePath = toPathArray(item.clip.points);
                    frame.place(file);
                    graphic = frame.allGraphics[0];
                    graphic.geometricBounds = [0, 0, g.height * PT, g.width * PT];
                    graphic.transform(CoordinateSpaces.PASTEBOARD_COORDINATES, AnchorPoint.CENTER_ANCHOR, matrix);
                    var gb = graphic.geometricBounds;
                    graphic.move(undefined, [g.center.x - (gb[1] + gb[3]) / 2, g.center.y - (gb[0] + gb[2]) / 2]);
                } else {
                    frame = page.rectangles.add();
                    clearFrameChrome(doc, frame);
                    frame.geometricBounds = [0, 0, g.height * PT, g.width * PT];
                    frame.place(file);
                    frame.fit(FitOptions.CONTENT_TO_FRAME);
                    frame.transform(CoordinateSpaces.PASTEBOARD_COORDINATES, AnchorPoint.CENTER_ANCHOR, matrix);
                    var fb = frame.geometricBounds;
                    frame.move(undefined, [g.center.x - (fb[1] + fb[3]) / 2, g.center.y - (fb[0] + fb[2]) / 2]);
                    graphic = frame.allGraphics[0];
                }
            } catch (placeError) {
                appendLog("[Mismatch] image " + label + " place failed: " + placeError.message);
                pushWarning(report, "Place failed for " + label + ": " + placeError.message);
                if (frame) {
                    try { frame.remove(); } catch (cleanupError) {}
                }
                return false;
            }
            nameImportedItem(frame, item);
            labelGroups(frame, item);
            applyTransparencySettings(frame, item, report);
            var det = g.xx * g.yy - g.xy * g.yx;
            var spin = Math.atan2(-g.yx, g.xx) * 180 / Math.PI;
            var cb = graphic ? graphic.geometricBounds : frame.geometricBounds;
            var dc = Math.max(Math.abs((cb[1] + cb[3]) / 2 - g.center.x), Math.abs((cb[0] + cb[2]) / 2 - g.center.y));
            appendLog((dc > 0.2 ? "[Mismatch] " : "[Check] ") + "image " + label + " " + String(item.assetType || "") + " center Δ=" + round2(dc) + "mm rot=" + round2(spin) +
                (det < 0 ? " mirrored" : "") + (item.clip ? " in clip frame" : "") + " source: " + safeGet(item.reason, ""));
            report.importedAssets++;
            return true;
        }

        function applyPageItemTransform(pageItem, item, report) {
            if (!item) {
                return;
            }

            if (item.shear !== null && item.shear !== undefined && item.shear !== 0) {
                try {
                    pageItem.shearAngle = item.shear;
                } catch (error3) {
                    try {
                        pageItem.absoluteShearAngle = item.shear;
                    } catch (error4) {
                        pushWarning(report, "Unable to apply shear: " + error4.message);
                    }
                }
            }

            applyTransparencySettings(pageItem, item, report);
        }

        function applyTransparencySettings(pageItem, item, report) {
            if (!pageItem || !item || !pageItem.transparencySettings || !pageItem.transparencySettings.blendingSettings) {
                return;
            }

            try {
                if (item.opacity !== null && item.opacity !== undefined) {
                    pageItem.transparencySettings.blendingSettings.opacity = item.opacity;
                }
            } catch (error) {
                pushWarning(report, "Unable to apply opacity: " + error.message);
            }

            if (item.blendMode) {
                try {
                    var mappedBlendMode = mapBlendMode(item.blendMode);
                    if (mappedBlendMode !== null) {
                        pageItem.transparencySettings.blendingSettings.blendMode = mappedBlendMode;
                    } else {
                        pushWarning(report, "Unsupported blend mode mapping: " + item.blendMode);
                    }
                } catch (error2) {
                    pushWarning(report, "Unable to apply blend mode: " + error2.message);
                }
            }
        }

        function requestIllustratorCopy(sourceDocumentName, sourcePageItemIndex, report) {
            if (shouldCancel()) {
                pushWarning(report, "Transfer cancelled before Illustrator clipboard copy.");
                return false;
            }
            var target = null;
            try {
                target = BridgeTalk.getSpecifier("illustrator");
            } catch (error) {
                target = null;
            }

            if (!target) {
                pushWarning(report, "Illustrator target unavailable for clipboard copy.");
                return false;
            }

            var bt = new BridgeTalk();
            var state = { completed: false, succeeded: false, body: "" };
            bt.target = target;
            bt.timeout = 20;
            bt.body = "(" + illustratorClipboardCopy.toString() + ")(" + btQuote(sourceDocumentName) + ", " + String(sourcePageItemIndex) + ");";
            bt.onResult = function (result) {
                state.completed = true;
                state.succeeded = true;
                state.body = result.body;
            };
            bt.onError = function (result) {
                state.completed = true;
                state.succeeded = false;
                state.body = result.body;
            };
            bt.send();

            var i;
            for (i = 0; i < 40; i++) {
                if (shouldCancel()) {
                    pushWarning(report, "Transfer cancelled while waiting for Illustrator clipboard copy.");
                    return false;
                }
                if (state.completed) {
                    break;
                }
                try {
                    BridgeTalk.pump();
                } catch (pumpError) {}
                $.sleep(500);
            }

            if (!state.completed) {
                pushWarning(report, "Timed out waiting for Illustrator clipboard copy.");
                return false;
            }

            if (!state.succeeded) {
                pushWarning(report, "Illustrator clipboard copy error: " + state.body);
                return false;
            }

            if (state.body != "OK") {
                pushWarning(report, "Unexpected Illustrator clipboard copy response: " + state.body);
                return false;
            }

            return true;
        }

        function illustratorClipboardCopy(sourceDocumentName, sourcePageItemIndex) {
            function findDocumentByName(docName) {
                var i;
                for (i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name == docName) {
                        return app.documents[i];
                    }
                }
                return null;
            }

            var doc = findDocumentByName(sourceDocumentName);
            if (!doc) {
                throw new Error("Illustrator source document not found: " + sourceDocumentName);
            }

            app.activeDocument = doc;
            try {
                doc.selection = null;
            } catch (clearError) {}

            if (sourcePageItemIndex < 0 || sourcePageItemIndex >= doc.pageItems.length) {
                throw new Error("Invalid sourcePageItemIndex: " + sourcePageItemIndex);
            }

            var item = doc.pageItems[sourcePageItemIndex];
            item.selected = true;
            app.copy();
            try {
                item.selected = false;
            } catch (deselectError) {}
            return "OK";
        }

        function btQuote(value) {
            return "'" + String(value)
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\r/g, "\\r")
                .replace(/\n/g, "\\n")
                .replace(/\t/g, "\\t") + "'";
        }

        function importOrderedItem(doc, page, itemRef, report) {
            if (!itemRef) {
                return;
            }

            if (itemRef.kind == "text") {
                importTextFrame(doc, page, findPayloadItemById(payload.textFrames, itemRef.id), report);
                return;
            }

            if (itemRef.kind == "vector") {
                importVectorItem(doc, page, findPayloadItemById(payload.vectorItems, itemRef.id), report);
                return;
            }

            if (itemRef.kind == "asset") {
                importAsset(page, findPayloadItemById(payload.imageItems, itemRef.id), report);
            }
        }

        function findPayloadItemById(list, id) {
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i].id == id) {
                    return list[i];
                }
            }
            return null;
        }

        function mapBlendMode(sourceBlendMode) {
            var normalized = String(sourceBlendMode).toUpperCase();

            if (normalized.indexOf("NORMAL") !== -1) return BlendMode.NORMAL;
            if (normalized.indexOf("MULTIPLY") !== -1) return BlendMode.MULTIPLY;
            if (normalized.indexOf("SCREEN") !== -1) return BlendMode.SCREEN;
            if (normalized.indexOf("OVERLAY") !== -1) return BlendMode.OVERLAY;
            if (normalized.indexOf("SOFTLIGHT") !== -1 || normalized.indexOf("SOFT_LIGHT") !== -1) return BlendMode.SOFT_LIGHT;
            if (normalized.indexOf("HARDLIGHT") !== -1 || normalized.indexOf("HARD_LIGHT") !== -1) return BlendMode.HARD_LIGHT;
            if (normalized.indexOf("COLORDODGE") !== -1 || normalized.indexOf("COLOR_DODGE") !== -1) return BlendMode.COLOR_DODGE;
            if (normalized.indexOf("COLORBURN") !== -1 || normalized.indexOf("COLOR_BURN") !== -1) return BlendMode.COLOR_BURN;
            if (normalized.indexOf("DARKEN") !== -1) return BlendMode.DARKEN;
            if (normalized.indexOf("LIGHTEN") !== -1) return BlendMode.LIGHTEN;
            if (normalized.indexOf("DIFFERENCE") !== -1) return BlendMode.DIFFERENCE;
            if (normalized.indexOf("EXCLUSION") !== -1) return BlendMode.EXCLUSION;
            if (normalized.indexOf("HUE") !== -1) return BlendMode.HUE;
            if (normalized.indexOf("SATURATION") !== -1) return BlendMode.SATURATION;
            if (normalized.indexOf("COLOR") !== -1 && normalized.indexOf("BURN") === -1 && normalized.indexOf("DODGE") === -1) return BlendMode.COLOR;
            if (normalized.indexOf("LUMINOSITY") !== -1) return BlendMode.LUMINOSITY;

            return null;
        }

        function reportToString(report) {
            var lines = [];
            lines.push("InDesign import finished");
            lines.push("");
            lines.push("Source: " + report.sourceDocument);
            lines.push("Transport: " + report.transportMode);
            lines.push("Text frames: " + report.importedTextFrames);
            lines.push("Placed assets: " + report.importedAssets);
            if (report.warnings.length) {
                lines.push("");
                lines.push("Warnings:");
                var i;
                for (i = 0; i < report.warnings.length; i++) {
                    lines.push("- " + report.warnings[i]);
                }
            }
            return lines.join("\n");
        }

        appendLog("Action handler started. action=" + actionName);
        try {
        var actionPayload = readActionPayload(actionPayloadJSON);
        var report = createReport(actionPayload);
        var doc = null;
        var page = null;

        if (actionName == "initDocument") {
            doc = createDocument(actionPayload);
            doc.insertLabel(getSessionLabelKey(), actionPayload.sessionId);
            report.createdDocument = doc.name;
            appendLog("Document created: " + doc.name + " for session " + actionPayload.sessionId);
            return "OK";
        }

        doc = findSessionDocument(actionPayload.sessionId);
        if (!doc) {
            throw new Error("Session document not found: " + actionPayload.sessionId);
        }
        app.activeDocument = doc;
        page = doc.pages[0];

        if (shouldCancel()) {
            appendLog("Action cancelled before execution.");
            return "CANCELLED";
        }

        if (actionName == "styleVector") {
            var styled = styleVectorItem(doc, page, actionPayload.item, report);
            appendLog((styled ? "Vector styled: " : "Vector style skipped: ") + actionPayload.item.id);
            return styled ? "OK" : "SKIPPED";
        }

        if (actionName == "createTextFrame") {
            importTextFrame(doc, page, actionPayload.item, report);
            appendLog("Text item imported: " + itemLabel(actionPayload.item));
            return "OK";
        }

        if (actionName == "groupItems") {
            return groupLabeledItems(doc, page, actionPayload, report);
        }

        if (actionName == "pasteVector") {
            var beforeCount = page.pageItems.length;
            try {
                app.activeWindow.activePage = page;
            } catch (pageError) {}

            // Clipboard между Illustrator -> InDesign иногда “догоняет” с задержкой.
            // Короткая пауза перед попытками paste существенно снижает "Unable to paste current scrap item".
            $.sleep(700);

            if (!pasteClipboardToPage(page, report)) {
                pushWarning(report, "All paste methods failed in InDesign for vector " + actionPayload.item.id + ". Vector was skipped.");
                appendLog("Vector paste skipped (all methods failed): " + actionPayload.item.id);
                return "SKIPPED";
            }

            if (!app.selection || !app.selection.length) {
                pushWarning(report, "No pasted selection returned from InDesign for vector " + actionPayload.item.id + ". Vector was skipped.");
                appendLog("Vector paste skipped (no selection): " + actionPayload.item.id);
                return "SKIPPED";
            }
            var pastedItem = normalizePastedSelection(page, report);
            if (!pastedItem) {
                pushWarning(report, "Unable to normalize pasted vector selection for " + actionPayload.item.id + ". Vector was skipped.");
                appendLog("Vector paste skipped (normalize failed): " + actionPayload.item.id);
                return "SKIPPED";
            }
            placePastedItem(pastedItem, actionPayload.item);
            applyTransparencySettings(pastedItem, actionPayload.item, report);
            checkPlacement(pastedItem, actionPayload.item, "vector " + actionPayload.item.id);
            report.importedVectorItems++;
            appendLog("Vector pasted: " + actionPayload.item.id + " pageItemsBefore=" + beforeCount + " after=" + page.pageItems.length);
            return "OK";
        }

        if (actionName == "placeVectorPdf") {
            if (!importVectorPdf(doc, page, actionPayload.item, report)) {
                appendLog("Vector PDF skipped: " + actionPayload.item.id);
                return "SKIPPED";
            }
            appendLog("Vector PDF placed: " + actionPayload.item.id);
            return "OK";
        }

        if (actionName == "placeAsset") {
            if (!importAsset(page, actionPayload.item, report)) {
                appendLog("Asset skipped (missing file): " + actionPayload.item.id);
                return "SKIPPED";
            }
            appendLog("Asset imported: " + actionPayload.item.id);
            return "OK";
        }

        if (actionName == "finalize") {
            appendLog("Finalize requested.");
            return reportToString(report);
        }

        throw new Error("Unknown action: " + actionName);
        } catch (actionError) {
            var actionMessage = actionError && actionError.message ? actionError.message : String(actionError);
            appendLog("Action failed: " + actionName + " :: " + actionMessage);
            return "ERROR " + actionMessage;
        }

        function pasteClipboardToPage(page, report) {
            var methods = [
                function () { app.paste(); return "app.paste"; },
                function () { app.pasteInPlace(); return "app.pasteInPlace"; },
                function () { app.menuActions.item("$ID/Paste").invoke(); return "$ID/Paste"; },
                function () { app.menuActions.item("$ID/Paste in Place").invoke(); return "$ID/Paste in Place"; }
            ];

            // Ключевой фикс: clipboard из Illustrator иногда появляется в InDesign с задержкой.
            // Поэтому делаем несколько раундов попыток paste с паузой, вместо одного прохода.
            try { app.activate(); } catch (eActivate) {}

            var round;
            var i;
            var totalRounds = 8;
            for (round = 1; round <= totalRounds; round++) {
                for (i = 0; i < methods.length; i++) {
                    try {
                        clearSelection();
                        var methodName = methods[i]();
                        appendLog("Paste method succeeded: " + methodName + " (round " + round + "/" + totalRounds + ")");
                        return true;
                    } catch (error) {
                        // Логируем реже, чтобы файл не раздувался
                        if (round == 1 || round % 5 === 0) {
                            appendLog("Paste method failed: " + error.message + " (round " + round + "/" + totalRounds + ")");
                        }
                    }
                }
                $.sleep(500);
            }

            pushWarning(report, "All paste methods failed in InDesign.");
            return false;
        }

        function clearSelection() {
            try {
                app.select(NothingEnum.NOTHING);
                return;
            } catch (error) {}

            try {
                app.selection = null;
            } catch (error2) {}
        }
    }

    function hasClippingAncestor(item) {
        var parent = item.parent;
        while (parent && parent.typename) {
            if (parent.typename == "GroupItem" && parent.clipped) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    function hasAncestorType(item, typename) {
        var parent = item.parent;
        while (parent && parent.typename) {
            if (parent.typename == typename) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    function isHiddenItem(item) {
        var current = item;
        while (current && current.typename) {
            try {
                if (current.hidden) {
                    return true;
                }
            } catch (error) {}

            if (current.typename == "Layer") {
                try {
                    if (!current.visible) {
                        return true;
                    }
                } catch (layerError) {}
            }

            current = current.parent;
        }
        return false;
    }

    function unlockChain(item) {
        var chain = [];
        var current = item;
        while (current && current.typename) {
            chain.push(current);
            current = current.parent;
        }

        var unlocked = [];
        var i;
        for (i = chain.length - 1; i >= 0; i--) {
            try {
                if (chain[i].locked) {
                    chain[i].locked = false;
                    unlocked.push(chain[i]);
                }
            } catch (error) {}
        }

        return unlocked;
    }

    function restoreUnlockChain(unlocked) {
        if (!unlocked) {
            return;
        }

        var i;
        for (i = 0; i < unlocked.length; i++) {
            try {
                unlocked[i].locked = true;
            } catch (error) {}
        }
    }

    function getGeometricBounds(item) {
        try {
            return normalizeRect(item.geometricBounds);
        } catch (error) {}
        return null;
    }

    function getPreferredBounds(item) {
        var bounds = null;
        try {
            bounds = item.visibleBounds;
        } catch (error) {}

        if (!bounds) {
            try {
                bounds = item.geometricBounds;
            } catch (error2) {}
        }

        return bounds ? normalizeRect(bounds) : null;
    }

    function normalizeRect(bounds) {
        return {
            left: bounds[0],
            top: bounds[1],
            right: bounds[2],
            bottom: bounds[3],
            width: bounds[2] - bounds[0],
            height: bounds[1] - bounds[3]
        };
    }

    function rectIntersects(a, b) {
        return !(a.right < b.left || a.left > b.right || a.top < b.bottom || a.bottom > b.top);
    }

    function rectWidth(rect) {
        return rect.right - rect.left;
    }

    function rectHeight(rect) {
        return rect.top - rect.bottom;
    }

    function boundsToMm(bounds, artboardRect) {
        return {
            x: ptToMm(bounds.left - artboardRect.left),
            y: ptToMm(artboardRect.top - bounds.top),
            width: ptToMm(bounds.width),
            height: ptToMm(bounds.height)
        };
    }

    function pointToMm(point, artboardRect) {
        return {
            x: ptToMm(point[0] - artboardRect.left),
            y: ptToMm(artboardRect.top - point[1])
        };
    }

    function ptToMm(value) {
        return value * MM_PER_PT;
    }

    function rotationFromItem(item) {
        try {
            if (typeof item.rotation === "number" && isFinite(item.rotation) && Math.abs(item.rotation) > 0.05) {
                return item.rotation;
            }
        } catch (rotationError) {}
        try {
            var matrix = item.matrix;
            var degrees = Math.atan2(matrix.mValueB, matrix.mValueA) * 180 / Math.PI;
            if (!isFinite(degrees) || Math.abs(degrees) < 0.05) {
                return 0;
            }
            return degrees;
        } catch (matrixError) {}
        return 0;
    }

    function readUnrotatedMm(item, side) {
        var value = 0;
        try {
            value = side == "height" ? item.height : item.width;
        } catch (sizeError) {
            return null;
        }
        if (!(value > 0) || !isFinite(value)) {
            return null;
        }
        return ptToMm(value);
    }

    function safeNumber(value, fallback) {
        return isFinite(value) ? Number(value) : (fallback !== undefined ? fallback : null);
    }

    function safeBoolean(value) {
        if (value === true || value === false) {
            return value;
        }
        return null;
    }

    function safeString(value) {
        if (value === undefined || value === null) {
            return null;
        }
        return String(value);
    }

    function safeEnum(value) {
        if (value === undefined || value === null) {
            return null;
        }
        try {
            return String(value);
        } catch (error) {
            return null;
        }
    }

    function getArtboardName(artboard, index) {
        try {
            if (artboard.name && artboard.name !== "") {
                return artboard.name;
            }
        } catch (error) {}
        return "Artboard " + (index + 1);
    }

    function sanitizeFileName(name) {
        return String(name).replace(/[\\\/\:\*\?\"\<\>\|]/g, "_");
    }

    function ensureFolder(folder) {
        if (!folder.exists) {
            folder.create();
        }
    }

    function copyScriptToSessionIfConfigured(session) {
        if (!SCRIPT_SOURCE_PATH || !session || !session.baseFolder) {
            return;
        }
        try {
            var src = new File(SCRIPT_SOURCE_PATH);
            if (!src.exists) {
                return;
            }
            var dest = new File(session.baseFolder.fsName + "/AIToInDesign_used.jsx");
            src.copy(dest);
            logSession(session, "Script copy saved for versioning: AIToInDesign_used.jsx");
        } catch (err) {
            logSession(session, "Script copy for versioning failed: " + (err && err.message ? err.message : String(err)));
        }
    }

    function buildTimestamp() {
        var now = new Date();
        return now.getFullYear() +
            pad2(now.getMonth() + 1) +
            pad2(now.getDate()) + "_" +
            pad2(now.getHours()) +
            pad2(now.getMinutes()) +
            pad2(now.getSeconds());
    }

    function pad2(value) {
        value = Number(value);
        return value < 10 ? "0" + value : String(value);
    }

    function round2(value) {
        return Math.round(value * 100) / 100;
    }

    function safeItemName(item) {
        try {
            if (item.name) {
                return item.name;
            }
        } catch (error) {}
        return item.typename;
    }

    function pushWarning(report, message) {
        report.warnings.push(message);
    }

    function buildItemId(prefix) {
        return prefix + "_" + new Date().getTime() + "_" + Math.floor(Math.random() * 100000);
    }

    function buildExportSummary(report) {
        var lines = [];
        lines.push("Illustrator export finished");
        lines.push("");
        lines.push("Transport: " + report.transportMode);
        lines.push("Text frames: " + report.exportedTextFrames);
        lines.push("Text on path: " + (report.exportedPathTextFrames || 0));
        lines.push("Vector items: " + report.exportedVectorItems);
        lines.push("Placed assets: " + report.exportedImageItems);
        lines.push("Asset fallbacks: " + report.assetFallbacks);
        lines.push("Skipped hidden: " + report.skippedHidden);
        lines.push("Skipped outside artboard: " + report.skippedOutsideArtboard);
        lines.push("Skipped unsupported: " + report.skippedUnsupported);
        if (report.assetFallbacks === 0 && report.skippedUnsupported > 0) {
            lines.push("Note: unsupported raster/complex vector items were skipped unless temporary asset fallback was enabled.");
        }
        if (report.warnings.length) {
            lines.push("");
            lines.push("Export warnings:");
            var i;
            for (i = 0; i < report.warnings.length; i++) {
                lines.push("- " + report.warnings[i]);
            }
        }
        return lines.join("\n");
    }

    function buildTransportDetails(session, report) {
        // Пользователь и так может открыть временную папку по кнопке.
        // В диалогах не показываем технические пути к файлам.
        return "";
    }

    function areObjectsEqual(a, b) {
        return stringifyJSON(a) == stringifyJSON(b);
    }

    function quoteForBridgeTalk(value) {
        return "\"" + String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t") + "\"";
    }

    function writeJSON(file, data) {
        file.open("w");
        file.encoding = "UTF-8";
        file.write(stringifyJSON(data, ""));
        file.close();
    }

    function initializeLog(session, doc, artboardIndex) {
        session.logFile.open("w");
        session.logFile.encoding = "UTF-8";
        session.logFile.writeln(buildLogPrefix("Illustrator") + "Log created.");
        session.logFile.writeln(buildLogPrefix("Illustrator") + "Version: " + EXPORT_VERSION);
        session.logFile.writeln(buildLogPrefix("Illustrator") + "Document: " + doc.name);
        session.logFile.writeln(buildLogPrefix("Illustrator") + "Artboard index: " + artboardIndex);
        session.logFile.writeln(buildLogPrefix("Illustrator") + "Session folder: " + session.baseFolder.fsName);
        session.logFile.close();

        // Отдельный лог InDesign — чтобы не смешивать потоки.
        if (session.inDesignLogFile) {
            try {
                session.inDesignLogFile.open("w");
                session.inDesignLogFile.encoding = "UTF-8";
                session.inDesignLogFile.writeln(buildLogPrefix("InDesign") + "InDesign log initialized.");
                session.inDesignLogFile.writeln(buildLogPrefix("InDesign") + "Session: " + session.stamp);
                session.inDesignLogFile.writeln(buildLogPrefix("InDesign") + "Source: " + doc.name);
                session.inDesignLogFile.close();
            } catch (e) {}
        }
    }

    function logSession(session, message) {
        try {
            session.logFile.open("a");
            session.logFile.encoding = "UTF-8";
            session.logFile.writeln(buildLogPrefix("Illustrator") + message);
            session.logFile.close();
        } catch (error) {}
    }

    function buildLogPrefix(source) {
        return "[" + new Date().toUTCString() + "][" + source + "] ";
    }

    function showSessionDialog(session, title, message) {
        var win = new Window("dialog", title);
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];

        win.add("statictext", undefined, message, { multiline: true });

        var buttons = win.add("group");
        buttons.alignment = "right";
        var openFolder = buttons.add("button", undefined, "Open Temp Folder");
        var ok = buttons.add("button", undefined, "OK", { name: "ok" });

        openFolder.onClick = function () {
            openSessionFolder(session);
        };
        ok.onClick = function () {
            win.close(1);
        };

        win.show();
    }

    function createProgressUI(session) {
        try {
            var win = new Window("palette", SCRIPT_NAME + " Transfer");
            win.orientation = "column";
            win.alignChildren = ["fill", "top"];
            win.margins = 8;
            win.preferredSize = [320, 220];

            var steps = win.add("statictext", undefined, "[>] Prepare\n[ ] Read Illustrator\n[ ] Connect InDesign\n[ ] Transfer Text\n[ ] Transfer Raster\n[ ] Finish", { multiline: true });
            steps.minimumSize.height = 105;

            var promptText = win.add("statictext", undefined, "", { multiline: true });
            promptText.minimumSize.height = 40;
            promptText.visible = false;

            var promptButtons = win.add("group");
            promptButtons.alignment = "right";
            var promptRetry = promptButtons.add("button", undefined, "Повторить");
            var promptStop = promptButtons.add("button", undefined, "Остановить");
            promptButtons.visible = false;

            session.progressUI = {
                window: win,
                steps: steps,
                labels: ["Prepare", "Read Illustrator", "Connect InDesign", "Transfer Text", "Transfer Raster", "Finish"],
                promptText: promptText,
                promptButtons: promptButtons,
                promptRetry: promptRetry,
                promptStop: promptStop,
                promptDecision: null
            };

            promptRetry.onClick = function () { session.progressUI.promptDecision = "retry"; };
            promptStop.onClick = function () { session.progressUI.promptDecision = "stop"; };

            win.show();
            refreshProgressUI(session);
        } catch (error) {
            session.progressUI = null;
        }
    }

    function updateProgressUI(session, activeStepIndex, statusText, progressValue) {
        if (!session || !session.progressUI) {
            return;
        }

        try {
            // Для шагов переноса детализируем строку в списке шагов.
            var transferDetail = null;
            if (activeStepIndex >= 3 && activeStepIndex <= 4) {
                transferDetail = statusText;
            }
            session.progressUI.steps.text = buildProgressSteps(session.progressUI.labels, activeStepIndex, transferDetail);
            refreshProgressUI(session);
        } catch (error) {}
    }

    // showVectorDecisionPrompt: модальный диалог, но мы временно скрываем палетку прогресса,
    // чтобы не было “окно под окном” и чтобы клики гарантированно работали.
    // Возвращает "retry" | "confirm" | "stop"
    // "retry"   — попробовать вставить ещё раз;
    // "confirm" — пользователь видит вектор в InDesign и подтверждает, что можно идти дальше без повторной вставки;
    // "stop"    — полностью останавливаем пайплайн.
    function showVectorDecisionPrompt(session, vectorItem, index, total, message) {
        var wasVisible = false;
        try {
            if (session && session.progressUI && session.progressUI.window) {
                wasVisible = session.progressUI.window.visible;
                session.progressUI.window.visible = false;
            }
        } catch (eHide) {}

        var win = new Window("dialog", "Вектор " + index + " / " + total);
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 10;

        win.add("statictext", undefined, "ID: " + (vectorItem && vectorItem.id ? vectorItem.id : "unknown"), { multiline: false });
        win.add("statictext", undefined, message, { multiline: true });

        var buttons = win.add("group");
        buttons.alignment = "right";
        var retry = buttons.add("button", undefined, "Повторить");
        var confirm = buttons.add("button", undefined, "Вектор есть");
        var stop = buttons.add("button", undefined, "Остановить", { name: "cancel" });

        var result = "retry";
        retry.onClick = function () { result = "retry"; win.close(1); };
        confirm.onClick = function () { result = "confirm"; win.close(1); };
        stop.onClick = function () { result = "stop"; win.close(0); };

        win.show();

        try {
            if (session && session.progressUI && session.progressUI.window) {
                session.progressUI.window.visible = wasVisible;
                refreshProgressUI(session);
            }
        } catch (eShow) {}

        return result;
    }

    function buildProgressSteps(labels, activeStepIndex, transferDetail) {
        var lines = [];
        var i;
        for (i = 0; i < labels.length; i++) {
            if (i < activeStepIndex) {
                lines.push("[x] " + labels[i]);
            } else if (i == activeStepIndex) {
                if (i >= 3 && i <= 4 && transferDetail) {
                    lines.push("[>] " + labels[i] + " (" + transferDetail + ")");
                } else {
                    lines.push("[>] " + labels[i]);
                }
            } else {
                lines.push("[ ] " + labels[i]);
            }
        }
        return lines.join("\n");
    }

    function refreshProgressUI(session) {
        if (!session || !session.progressUI || !session.progressUI.window) {
            return;
        }
        try {
            session.progressUI.window.layout.layout(true);
            session.progressUI.window.update();
        } catch (error) {}
    }

    function closeProgressUI(session) {
        if (!session || !session.progressUI || !session.progressUI.window) {
            return;
        }
        try {
            session.progressUI.window.close();
        } catch (error) {}
        session.progressUI = null;
    }

    function requestCancel(session, reason) {
        if (!session || !session.cancelFile) {
            return;
        }
        try {
            session.cancelFile.open("w");
            session.cancelFile.encoding = "UTF-8";
            session.cancelFile.write(reason || "Cancelled");
            session.cancelFile.close();
        } catch (error) {}
        logSession(session, "Cancellation requested. " + (reason || ""));
        updateProgressUI(session, 3, "Stopping... waiting for current step to finish", 100);
    }

    function isCancelled(session) {
        try {
            return !!(session && session.cancelFile && session.cancelFile.exists);
        } catch (error) {
            return false;
        }
    }

    function openSessionFolder(session) {
        try {
            var folder = new Folder(session.baseFolder.fsName);
            if (folder.exists) {
                folder.execute();
            }
        } catch (error) {}
    }

    function waitForBridgeTarget(appName, session, maxSeconds) {
        var i;
        for (i = 0; i < maxSeconds; i++) {
            try {
                if (BridgeTalk.isRunning(appName)) {
                    logSession(session, appName + " is running after " + i + " seconds.");
                    return true;
                }
            } catch (error) {}

            try {
                BridgeTalk.pump();
            } catch (pumpError) {}
            $.sleep(1000);
        }

        logSession(session, "Timed out waiting for " + appName + " to launch.");
        return false;
    }

    function waitForBridgeResponse(bt, state, session, mode) {
        var i;
        var waitingStepIndex = mapBridgeModeToProgressStep(mode);
        var maxIterations = BRIDGETALK_WAIT_SECONDS * 2;
        for (i = 0; i < maxIterations; i++) {
            if (isCancelled(session)) {
                logSession(session, "BridgeTalk wait aborted by cancel request.");
                return;
            }
            if (state.completed) {
                logSession(session, "BridgeTalk response completed for mode=" + mode + " after " + (i * 500) + " ms.");
                return;
            }

            try {
                BridgeTalk.pump();
            } catch (error) {}

            if (i > 0 && i % 10 === 0) {
                logSession(session, "Waiting for BridgeTalk response... " + ((i * 500) / 1000) + "s");
                updateProgressUI(session, waitingStepIndex, "Waiting for InDesign... " + ((i * 500) / 1000) + "s", Math.min(95, 50 + Math.round((i / (BRIDGETALK_WAIT_SECONDS * 2)) * 45)));
            }
            $.sleep(500);
        }
    }

    function mapBridgeModeToProgressStep(mode) {
        if (mode == "createTextFrame") return 3;
        if (mode == "placeAsset") return 4;
        if (mode == "finalize") return 5;
        return 3;
    }

    function stringifyJSON(obj, indent) {
        indent = indent || "";

        if (obj === null) {
            return "null";
        }

        if (typeof obj == "number" || typeof obj == "boolean") {
            return String(obj);
        }

        if (typeof obj == "string") {
            return "\"" + escapeJSONString(obj) + "\"";
        }

        if (isArray(obj)) {
            var arr = [];
            var i;
            for (i = 0; i < obj.length; i++) {
                arr.push(indent + "  " + stringifyJSON(obj[i], indent + "  "));
            }
            return "[\n" + arr.join(",\n") + "\n" + indent + "]";
        }

        var parts = [];
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key) && obj[key] !== undefined) {
                parts.push(indent + "  " + stringifyJSON(String(key), indent + "  ") + ": " + stringifyJSON(obj[key], indent + "  "));
            }
        }
        return "{\n" + parts.join(",\n") + "\n" + indent + "}";
    }

    function escapeJSONString(value) {
        return String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t");
    }

    function isArray(value) {
        return Object.prototype.toString.call(value) == "[object Array]";
    }

    try {
        main();
    } catch (e) {
        try {
            alert("AIToInDesign failed: " + (e && e.message ? e.message : String(e)));
        } catch (alertError) {}
    }
}());
