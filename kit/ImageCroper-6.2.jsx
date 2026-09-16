#target "indesign"

// ImageCroper 6.2
// Кроп выбранного image-фрейма через Photoshop (исходные пиксели).
// Цветовое пространство и ICC не трогаем: как было в файле, так и остаётся.
//
// 6.1 ставил пресет Color Settings по имени ("Preserve Embedded Profiles").
// Пресет часто отсутствует (особенно ru_RU) — Photoshop молча конвертировал
// в working RGB, а Save As PNG ещё и в sRGB. JPEG всегда встраивал ICC,
// даже если исходник был без профиля.
// 6.2: политики Preserve через Action Manager; PNG без convertToSRGB;
// ICC вшиваем только если он уже был в исходнике.
//
// Почему не InDesign exportFile (v2–v5): PNG с прозрачностью даёт полоски
// в альфе, от них не избавиться. JPEG-экспорт поворот «запекает», но PNG — нет.
// Почему не старый BridgeTalk v1: кроп считался по AABB без поворота
// (только хак на 180°), исходник не сохранялся обратно в линк.
//
// Здесь: Photoshop режет пиксели файла. Поворот/флип запекаются в PS.
// Повёрнутый фрейм мерится через временную копию с углом 0.

(function () {
    var SCRIPT_VERSION = "6.2";
    var ANGLE_EPS = 0.05;
    var SHEAR_EPS = 0.05;
    var PS_LAUNCH_WAIT_MS = 40000;
    var PS_SEND_TIMEOUT_SEC = 180;

    var RASTER_EXT = {
        ".jpg": 1, ".jpeg": 1, ".png": 1, ".tif": 1, ".tiff": 1,
        ".psd": 1, ".psb": 1, ".gif": 1, ".bmp": 1
    };

    if (app.documents.length === 0) {
        showMessage("Ошибка", "Нет открытых документов.");
        return;
    }

    var doc = app.activeDocument;
    if (doc.selection.length === 0) {
        showMessage("Ошибка", "Выберите фрейм с изображением.");
        return;
    }

    var resolved = resolveFrameAndImage(doc.selection[0]);
    if (!resolved) {
        showMessage("Ошибка", "Выберите фрейм с изображением.");
        return;
    }

    var frame = resolved.frame;
    var img = resolved.img;

    if (img.itemLink.status !== LinkStatus.NORMAL) {
        showMessage("Ошибка", "Связь с изображением потеряна.");
        return;
    }

    try {
        if (Math.abs(Number(img.shearAngle) || 0) > SHEAR_EPS) {
            showMessage("Ошибка", "У изображения задан shear — ImageCroper его не обрабатывает.");
            return;
        }
    } catch (eShear) {}

    var origFile = new File(img.itemLink.filePath);
    if (!origFile.exists) {
        showMessage("Ошибка", "Файл изображения не найден:\n" + origFile.fsName);
        return;
    }

    var ext = origFile.name.substr(origFile.name.lastIndexOf(".")).toLowerCase();
    if (!RASTER_EXT[ext]) {
        showMessage(
            "Ошибка",
            "Кропаются только растры (JPG / PNG / TIF / PSD).\nЭтот линк: " + ext
        );
        return;
    }

    var saveKind = saveKindFromExt(ext);
    var newExt = saveKind.ext;
    var embedProfile = detectEmbedFlag(origFile, ext);

    var oldH = doc.viewPreferences.horizontalMeasurementUnits;
    var oldV = doc.viewPreferences.verticalMeasurementUnits;
    var oldUI = app.scriptPreferences.userInteractionLevel;
    var oldRedraw = app.scriptPreferences.enableRedraw;

    try {
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        app.scriptPreferences.enableRedraw = false;

        var geom = measureCropGeometry(frame, img);
        if (!geom.ok) {
            showMessage("Ошибка", geom.error);
            return;
        }

        var pageArea = Math.round(
            doc.documentPreferences.pageWidth * doc.documentPreferences.pageHeight
        );
        var targetDpi = getMinPPI(pageArea);
        var effective = Math.min(img.effectivePpi[0], img.effectivePpi[1]);
        var finalDpi = effective < targetDpi ? Math.round(effective) : targetDpi;
        if (!(finalDpi > 0)) finalDpi = targetDpi;

        var targetW = mmToPx(geom.frameWmm, finalDpi);
        var targetH = mmToPx(geom.frameHmm, finalDpi);

        var destFile = new File(
            origFile.path + "/" + origFile.name.replace(/\.[^\.]+$/, "") + "_cropped" + newExt
        );

        var warn = "";
        if (effective < targetDpi) {
            warn = "\n\n⚠ Разрешение исходника (" + Math.round(effective) +
                " ppi) ниже требуемого (" + targetDpi + " ppi). Не растягивал.";
        }

        var psResult = runPhotoshopCrop({
            srcURI: origFile.absoluteURI,
            dstURI: destFile.absoluteURI,
            cropL: geom.cropL,
            cropT: geom.cropT,
            cropR: geom.cropR,
            cropB: geom.cropB,
            rotDeg: geom.psRotateDeg,
            flipH: geom.flipH,
            flipV: geom.flipV,
            targetW: targetW,
            targetH: targetH,
            dpi: finalDpi,
            saveKind: saveKind.code,
            embedProfile: embedProfile
        });

        if (psResult !== "OK") {
            showMessage("Ошибка", photoshopErrorText(psResult));
            return;
        }

        destFile = new File(destFile.fsName);
        if (!destFile.exists) {
            showMessage("Ошибка", "Photoshop не записал файл:\n" + destFile.fsName);
            return;
        }

        var wasLocked = false;
        try { wasLocked = frame.locked; } catch (eLock) {}
        if (wasLocked) frame.locked = false;

        img.itemLink.relink(destFile);
        try { img.itemLink.update(); } catch (eUpd) {}
        doc.recompose();

        var newImg = frame.images[0];
        try { newImg.rotationAngle = 0; } catch (eRot) {}
        try { newImg.horizontalScale = 100; } catch (eHs) {}
        try { newImg.verticalScale = 100; } catch (eVs) {}
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);

        if (wasLocked) {
            try { frame.locked = true; } catch (eRelock) {}
        }

        showMessage(
            "Готово",
            "ImageCroper " + SCRIPT_VERSION + " — кроп через Photoshop." + warn
        );
    } catch (e) {
        showMessage("Ошибка", String(e.message || e));
    } finally {
        try { doc.viewPreferences.horizontalMeasurementUnits = oldH; } catch (e1) {}
        try { doc.viewPreferences.verticalMeasurementUnits = oldV; } catch (e2) {}
        try { app.scriptPreferences.userInteractionLevel = oldUI; } catch (e3) {}
        try { app.scriptPreferences.enableRedraw = oldRedraw; } catch (e4) {}
    }

    function resolveFrameAndImage(sel) {
        if (!sel) return null;
        try {
            if (sel.constructor && sel.constructor.name === "Image") {
                return { frame: sel.parent, img: sel };
            }
        } catch (e1) {}
        try {
            if (sel.images && sel.images.length > 0) {
                return { frame: sel, img: sel.images[0] };
            }
        } catch (e2) {}
        return null;
    }

    function saveKindFromExt(fileExt) {
        if (fileExt === ".jpg" || fileExt === ".jpeg") return { code: 1, ext: ".jpg" };
        if (fileExt === ".tif" || fileExt === ".tiff") return { code: 3, ext: ".tif" };
        if (fileExt === ".psd" || fileExt === ".psb") return { code: 4, ext: ".psd" };
        return { code: 2, ext: ".png" };
    }

    function getMinPPI(area) {
        if (area <= 62370) return 300;
        if (area <= 124740) return 256;
        if (area <= 249480) return 182;
        if (area <= 499554) return 129;
        if (area <= 999949) return 92;
        return 65;
    }

    function mmToPx(mm, dpi) {
        var px = Math.round((Number(mm) / 25.4) * Number(dpi));
        return px < 1 ? 1 : px;
    }

    function almostZero(v, eps) {
        return Math.abs(Number(v) || 0) <= eps;
    }

    function bAt(s, i) {
        return s.charCodeAt(i) & 0xFF;
    }

    function u16be(s, i) {
        return (bAt(s, i) << 8) | bAt(s, i + 1);
    }

    function u16le(s, i) {
        return bAt(s, i) | (bAt(s, i + 1) << 8);
    }

    function u32be(s, i) {
        return (bAt(s, i) * 16777216) + (bAt(s, i + 1) * 65536) +
            (bAt(s, i + 2) * 256) + bAt(s, i + 3);
    }

    function u32le(s, i) {
        return bAt(s, i) + (bAt(s, i + 1) * 256) +
            (bAt(s, i + 2) * 65536) + (bAt(s, i + 3) * 16777216);
    }

    function readBinaryHead(file, maxBytes) {
        var f = new File(file.fsName);
        f.encoding = "BINARY";
        if (!f.open("r")) return "";
        try {
            return f.read(maxBytes) || "";
        } finally {
            try { f.close(); } catch (eC) {}
        }
    }

    function jpegHasIcc(data) {
        if (data.length < 4) return false;
        if (bAt(data, 0) !== 0xFF || bAt(data, 1) !== 0xD8) return false;
        var i = 2;
        var limit = Math.min(data.length, 1024 * 1024);
        while (i + 4 < limit) {
            if (bAt(data, i) !== 0xFF) {
                i += 1;
                continue;
            }
            var marker = bAt(data, i + 1);
            if (marker === 0xDA || marker === 0xD9) break;
            if (marker === 0x00 || marker === 0xFF) {
                i += 1;
                continue;
            }
            if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
                i += 2;
                continue;
            }
            var len = u16be(data, i + 2);
            if (len < 2) break;
            if (marker === 0xE2) {
                var ident = data.substring(i + 4, i + 16);
                if (ident.indexOf("ICC_PROFILE") === 0) return true;
            }
            i += 2 + len;
        }
        return data.substring(0, Math.min(data.length, 512 * 1024)).indexOf("ICC_PROFILE") !== -1;
    }

    function pngHasProfile(data) {
        if (data.length < 16) return false;
        if (bAt(data, 0) !== 0x89 || data.substring(1, 4) !== "PNG") return false;
        var i = 8;
        var limit = Math.min(data.length, 1024 * 1024);
        while (i + 12 <= limit) {
            var len = u32be(data, i);
            var type = data.substring(i + 4, i + 8);
            if (type === "IDAT" || type === "IEND") break;
            if (type === "iCCP" || type === "sRGB" || type === "cICP") return true;
            if (len < 0) break;
            i += 12 + len;
        }
        return false;
    }

    function openBinary(file) {
        var f = new File(file.fsName);
        f.encoding = "BINARY";
        if (!f.open("r")) return null;
        return f;
    }

    function tiffFileHasIcc(file) {
        var f = openBinary(file);
        if (!f) return null;
        try {
            var head = f.read(8);
            if (!head || head.length < 8) return false;
            var le = head.substring(0, 2) === "II";
            var be = head.substring(0, 2) === "MM";
            if (!le && !be) return false;
            var magic = le ? u16le(head, 2) : u16be(head, 2);
            if (magic !== 42) return false;
            var ifd = le ? u32le(head, 4) : u32be(head, 4);
            f.seek(ifd, 0);
            var nbuf = f.read(2);
            if (!nbuf || nbuf.length < 2) return false;
            var n = le ? u16le(nbuf, 0) : u16be(nbuf, 0);
            if (n < 1 || n > 512) return false;
            var entries = f.read(n * 12);
            if (!entries) return false;
            var count = Math.floor(entries.length / 12);
            var e;
            for (e = 0; e < count; e++) {
                var p = e * 12;
                var tag = le ? u16le(entries, p) : u16be(entries, p);
                if (tag === 34675) return true;
            }
            return false;
        } finally {
            try { f.close(); } catch (eC) {}
        }
    }

    function psdFileHasIcc(file) {
        var f = openBinary(file);
        if (!f) return null;
        try {
            var head = f.read(30);
            if (!head || head.length < 30 || head.substring(0, 4) !== "8BPS") return false;
            var pos = 30 + u32be(head, 26);
            f.seek(pos, 0);
            var lenBuf = f.read(4);
            if (!lenBuf || lenBuf.length < 4) return false;
            var end = pos + 4 + u32be(lenBuf, 0);
            pos += 4;
            while (pos + 12 <= end) {
                f.seek(pos, 0);
                var rec = f.read(7);
                if (!rec || rec.length < 7) break;
                if (rec.substring(0, 4) !== "8BIM") break;
                var id = u16be(rec, 4);
                var nameLen = bAt(rec, 6);
                var namePad = nameLen + 1;
                if (namePad % 2) namePad += 1;
                var sizeOff = pos + 6 + namePad;
                f.seek(sizeOff, 0);
                var sizeBuf = f.read(4);
                if (!sizeBuf || sizeBuf.length < 4) break;
                if (id === 1039) return true;
                var dataPad = u32be(sizeBuf, 0);
                if (dataPad % 2) dataPad += 1;
                pos = sizeOff + 4 + dataPad;
            }
            return false;
        } finally {
            try { f.close(); } catch (eC) {}
        }
    }

    // 1 = в исходнике есть ICC/sRGB-тег, 0 = нет, -1 = не смогли прочитать.
    function detectEmbedFlag(file, fileExt) {
        try {
            if (fileExt === ".gif" || fileExt === ".bmp") return 0;
            if (fileExt === ".tif" || fileExt === ".tiff") {
                var tif = tiffFileHasIcc(file);
                if (tif === null) return -1;
                return tif ? 1 : 0;
            }
            if (fileExt === ".psd" || fileExt === ".psb") {
                var psd = psdFileHasIcc(file);
                if (psd === null) return -1;
                return psd ? 1 : 0;
            }
            var data = readBinaryHead(file, 1024 * 1024);
            if (!data) return -1;
            if (fileExt === ".jpg" || fileExt === ".jpeg") return jpegHasIcc(data) ? 1 : 0;
            if (fileExt === ".png") return pngHasProfile(data) ? 1 : 0;
        } catch (eDet) {}
        return -1;
    }

    // Геометрия кропа в пространстве «фрейм не повёрнут».
    // Повёрнутый фрейм: дубликат на мгновение с absoluteRotationAngle = 0,
    // иначе page AABB врёт (лишние углы).
    function measureCropGeometry(srcFrame, srcImg) {
        var useDup = !almostZero(srcFrame.absoluteRotationAngle, ANGLE_EPS);
        var f = srcFrame;
        var im = srcImg;
        var dup = null;
        try {
            if (useDup) {
                dup = srcFrame.duplicate();
                dup.absoluteRotationAngle = 0;
                f = dup;
                im = dup.images[0];
            }

            var fb = f.geometricBounds;
            var ib = im.geometricBounds;
            var imgW = ib[3] - ib[1];
            var imgH = ib[2] - ib[0];
            var frameW = fb[3] - fb[1];
            var frameH = fb[2] - fb[0];
            if (!(imgW > 0.001 && imgH > 0.001 && frameW > 0.001 && frameH > 0.001)) {
                return { ok: false, error: "Нулевые размеры фрейма или изображения." };
            }

            var hScale = Number(im.absoluteHorizontalScale);
            var vScale = Number(im.absoluteVerticalScale);
            if (isNaN(hScale)) hScale = 100;
            if (isNaN(vScale)) vScale = 100;

            var relAngle = Number(im.rotationAngle) || 0;
            // InDesign: + = против часовой. Photoshop rotateCanvas: + = по часовой.
            var psRotateDeg = -relAngle;
            if (almostZero(psRotateDeg, ANGLE_EPS)) psRotateDeg = 0;

            return {
                ok: true,
                cropL: (fb[1] - ib[1]) / imgW,
                cropT: (fb[0] - ib[0]) / imgH,
                cropR: (fb[3] - ib[1]) / imgW,
                cropB: (fb[2] - ib[0]) / imgH,
                frameWmm: frameW,
                frameHmm: frameH,
                psRotateDeg: psRotateDeg,
                flipH: hScale < 0 ? 1 : 0,
                flipV: vScale < 0 ? 1 : 0
            };
        } catch (eMeas) {
            return { ok: false, error: "Не удалось снять геометрию кропа: " + eMeas.message };
        } finally {
            if (dup) {
                try { dup.remove(); } catch (eRm) {}
            }
        }
    }

    function jsString(s) {
        return String(s)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r/g, "")
            .replace(/\n/g, "\\n");
    }

    function num(x) {
        return String(Number(x));
    }

    function ensurePhotoshopRunning() {
        if (BridgeTalk.isRunning("photoshop")) return true;
        try { BridgeTalk.launch("photoshop"); } catch (eLaunch) {
            return false;
        }
        var waited = 0;
        while (!BridgeTalk.isRunning("photoshop") && waited < PS_LAUNCH_WAIT_MS) {
            $.sleep(500);
            waited += 500;
        }
        return BridgeTalk.isRunning("photoshop");
    }

    function runPhotoshopCrop(p) {
        if (typeof BridgeTalk === "undefined") {
            return "ERR:BridgeTalk недоступен. Нужен Photoshop.";
        }
        if (!ensurePhotoshopRunning()) {
            return "ERR:Photoshop не запущен и не удалось его открыть.";
        }

        var body =
            "(function(){\n" +
            "app.displayDialogs = DialogModes.NO;\n" +
            "var oldUnits = app.preferences.rulerUnits;\n" +
            "app.preferences.rulerUnits = Units.PIXELS;\n" +
            "var src = new File(\"" + jsString(p.srcURI) + "\");\n" +
            "var dst = new File(\"" + jsString(p.dstURI) + "\");\n" +
            "var cropL = " + num(p.cropL) + ";\n" +
            "var cropT = " + num(p.cropT) + ";\n" +
            "var cropR = " + num(p.cropR) + ";\n" +
            "var cropB = " + num(p.cropB) + ";\n" +
            "var rotDeg = " + num(p.rotDeg) + ";\n" +
            "var flipH = " + num(p.flipH) + ";\n" +
            "var flipV = " + num(p.flipV) + ";\n" +
            "var targetW = " + num(p.targetW) + ";\n" +
            "var targetH = " + num(p.targetH) + ";\n" +
            "var dpi = " + num(p.dpi) + ";\n" +
            "var saveKind = " + num(p.saveKind) + ";\n" +
            "var embedProfile = " + num(p.embedProfile) + ";\n" +
            "var opened = null;\n" +
            "var work = null;\n" +
            "var wasOpen = false;\n" +
            "var oldCSObj = null;\n" +
            "var oldCSName = null;\n" +
            "function px(v){ return Number(v); }\n" +
            "function s2t(s){ return stringIDToTypeID(s); }\n" +
            "function c2t(s){ return charIDToTypeID(s); }\n" +
            "function getCSObj(){\n" +
            "  var r = new ActionReference();\n" +
            "  r.putProperty(c2t('Prpr'), s2t('colorSettings'));\n" +
            "  r.putEnumerated(c2t('capp'), c2t('Ordn'), c2t('Trgt'));\n" +
            "  var d = executeActionGet(r);\n" +
            "  var k = s2t('colorSettings');\n" +
            "  if (d.hasKey(k)) return d.getObjectValue(k);\n" +
            "  return d;\n" +
            "}\n" +
            "function setCSObj(obj){\n" +
            "  var d = new ActionDescriptor();\n" +
            "  var r = new ActionReference();\n" +
            "  r.putProperty(c2t('Prpr'), s2t('colorSettings'));\n" +
            "  r.putEnumerated(c2t('capp'), c2t('Ordn'), c2t('Trgt'));\n" +
            "  d.putReference(c2t('null'), r);\n" +
            "  d.putObject(c2t('T   '), s2t('colorSettings'), obj);\n" +
            "  executeAction(c2t('setd'), d, DialogModes.NO);\n" +
            "}\n" +
            "function copyCSString(src, dst, key){\n" +
            "  var k = s2t(key);\n" +
            "  if (src.hasKey(k)) {\n" +
            "    try { dst.putString(k, src.getString(k)); } catch (eS) {}\n" +
            "  }\n" +
            "}\n" +
            "function applyPreserve(){\n" +
            "  var src = getCSObj();\n" +
            "  var obj = new ActionDescriptor();\n" +
            "  copyCSString(src, obj, 'workingRGB');\n" +
            "  copyCSString(src, obj, 'workingCMYK');\n" +
            "  copyCSString(src, obj, 'workingGray');\n" +
            "  copyCSString(src, obj, 'workingSpot');\n" +
            "  obj.putEnumerated(s2t('policyRGB'), s2t('policy'), s2t('preserve'));\n" +
            "  obj.putEnumerated(s2t('policyCMYK'), s2t('policy'), s2t('preserve'));\n" +
            "  obj.putEnumerated(s2t('policyGray'), s2t('policy'), s2t('preserve'));\n" +
            "  obj.putBoolean(s2t('askMismatchOpening'), false);\n" +
            "  obj.putBoolean(s2t('askMismatchPasting'), false);\n" +
            "  obj.putBoolean(s2t('askMissing'), false);\n" +
            "  setCSObj(obj);\n" +
            "}\n" +
            "function restoreCS(){\n" +
            "  if (oldCSObj) { try { setCSObj(oldCSObj); return; } catch (eR1) {} }\n" +
            "  if (oldCSName) { try { app.colorSettings = oldCSName; } catch (eR2) {} }\n" +
            "}\n" +
            "function wantEmbed(){\n" +
            "  if (embedProfile === 1) return true;\n" +
            "  if (embedProfile === 0) return false;\n" +
            "  try { return work.colorProfileType === ColorProfile.CUSTOM; } catch (eE) { return true; }\n" +
            "}\n" +
            "function savePngFile(file, embed){\n" +
            "  try { app.activeDocument = work; } catch (eAct) {}\n" +
            "  try {\n" +
            "    var d = new ActionDescriptor();\n" +
            "    var f = new ActionDescriptor();\n" +
            "    try { f.putEnumerated(s2t('method'), s2t('PNGMethod'), s2t('quick')); } catch (eM) {}\n" +
            "    d.putObject(c2t('As  '), s2t('PNGFormat'), f);\n" +
            "    d.putPath(c2t('In  '), file);\n" +
            "    d.putBoolean(c2t('Cpy '), true);\n" +
            "    d.putBoolean(c2t('LwCs'), true);\n" +
            "    d.putBoolean(s2t('embedProfiles'), embed);\n" +
            "    d.putBoolean(s2t('convertToSRGB'), false);\n" +
            "    executeAction(c2t('save'), d, DialogModes.NO);\n" +
            "    return;\n" +
            "  } catch (eAM) {}\n" +
            "  var png = new PNGSaveOptions();\n" +
            "  png.compression = 6;\n" +
            "  png.interlaced = false;\n" +
            "  try { png.embedColorProfile = embed; } catch (eEmb) {}\n" +
            "  work.saveAs(file, png, true);\n" +
            "}\n" +
            "try {\n" +
            "  try { oldCSName = app.colorSettings; } catch (eCS0) {}\n" +
            "  try { oldCSObj = getCSObj(); } catch (eCS1) {}\n" +
            "  try { applyPreserve(); } catch (eCS2) {\n" +
            "    try { app.colorSettings = 'Preserve Embedded Profiles'; } catch (eCS3) {\n" +
            "      try { app.colorSettings = 'Сохранять встроенные профили'; } catch (eCS4) {}\n" +
            "    }\n" +
            "  }\n" +
            "  if (!src.exists) return 'ERR:source missing';\n" +
            "  var i;\n" +
            "  for (i = 0; i < app.documents.length; i++) {\n" +
            "    try {\n" +
            "      if (app.documents[i].fullName && app.documents[i].fullName.absoluteURI === src.absoluteURI) {\n" +
            "        wasOpen = true; break;\n" +
            "      }\n" +
            "    } catch (eOpen) {}\n" +
            "  }\n" +
            "  opened = app.open(src);\n" +
            "  work = opened.duplicate();\n" +
            "  if (!wasOpen) {\n" +
            "    try { opened.close(SaveOptions.DONOTSAVECHANGES); } catch (eCl) {}\n" +
            "    opened = null;\n" +
            "  }\n" +
            "  try {\n" +
            "    if (work.mode === DocumentMode.BITMAP) work.changeMode(ChangeMode.GRAYSCALE);\n" +
            "    if (work.mode === DocumentMode.INDEXEDCOLOR) work.changeMode(ChangeMode.RGB);\n" +
            "  } catch (eMode) {}\n" +
            "  if (saveKind !== 1) {\n" +
            "    try {\n" +
            "      if (work.layers.length > 0 && work.layers[0].isBackgroundLayer) {\n" +
            "        work.layers[0].isBackgroundLayer = false;\n" +
            "      }\n" +
            "    } catch (eBg) {}\n" +
            "  }\n" +
            "  if (flipH) work.flipCanvas(Direction.HORIZONTAL);\n" +
            "  if (flipV) work.flipCanvas(Direction.VERTICAL);\n" +
            "  if (Math.abs(rotDeg) > 0.05) work.rotateCanvas(rotDeg);\n" +
            "  var w = px(work.width);\n" +
            "  var h = px(work.height);\n" +
            "  var left = cropL * w;\n" +
            "  var top = cropT * h;\n" +
            "  var right = cropR * w;\n" +
            "  var bottom = cropB * h;\n" +
            "  var addL = left < 0 ? -left : 0;\n" +
            "  var addT = top < 0 ? -top : 0;\n" +
            "  var addR = right > w ? right - w : 0;\n" +
            "  var addB = bottom > h ? bottom - h : 0;\n" +
            "  if (addR || addB) {\n" +
            "    work.resizeCanvas(w + addR, h + addB, AnchorPosition.TOPLEFT);\n" +
            "    w = px(work.width); h = px(work.height);\n" +
            "  }\n" +
            "  if (addL || addT) {\n" +
            "    work.resizeCanvas(w + addL, h + addT, AnchorPosition.BOTTOMRIGHT);\n" +
            "  }\n" +
            "  left += addL; top += addT; right += addL; bottom += addT;\n" +
            "  if (!(right - left >= 1 && bottom - top >= 1)) return 'ERR:empty crop';\n" +
            "  work.crop([left, top, right, bottom]);\n" +
            "  var cw = px(work.width);\n" +
            "  var ch = px(work.height);\n" +
            "  if (cw > targetW * 1.02 || ch > targetH * 1.02) {\n" +
            "    work.resizeImage(targetW, targetH, dpi, ResampleMethod.BICUBIC);\n" +
            "  } else {\n" +
            "    try { work.resizeImage(undefined, undefined, dpi, ResampleMethod.NONE); } catch (eDpi) {}\n" +
            "  }\n" +
            "  var embed = wantEmbed();\n" +
            "  if (!embed) {\n" +
            "    try { work.colorProfileType = ColorProfile.NONE; } catch (eNone) {}\n" +
            "  }\n" +
            "  if (saveKind === 1) {\n" +
            "    try {\n" +
            "      if (work.bitsPerChannel !== BitsPerChannelType.EIGHT) work.bitsPerChannel = BitsPerChannelType.EIGHT;\n" +
            "    } catch (eBit) {}\n" +
            "    var jpg = new JPEGSaveOptions();\n" +
            "    jpg.quality = 12;\n" +
            "    jpg.embedColorProfile = embed;\n" +
            "    jpg.formatOptions = FormatOptions.STANDARDBASELINE;\n" +
            "    jpg.matte = MatteType.WHITE;\n" +
            "    work.saveAs(dst, jpg, true);\n" +
            "  } else if (saveKind === 3) {\n" +
            "    var tif = new TiffSaveOptions();\n" +
            "    tif.embedColorProfile = embed;\n" +
            "    tif.layers = false;\n" +
            "    try { tif.imageCompression = TIFFEncoding.TIFFLZW; } catch (eEnc) {}\n" +
            "    try { tif.transparency = true; } catch (eTr) {}\n" +
            "    work.saveAs(dst, tif, true);\n" +
            "  } else if (saveKind === 4) {\n" +
            "    var psd = new PhotoshopSaveOptions();\n" +
            "    psd.embedColorProfile = embed;\n" +
            "    psd.layers = false;\n" +
            "    work.saveAs(dst, psd, true);\n" +
            "  } else {\n" +
            "    savePngFile(dst, embed);\n" +
            "  }\n" +
            "  return 'OK';\n" +
            "} catch (e) {\n" +
            "  return 'ERR:' + e.message;\n" +
            "} finally {\n" +
            "  try { if (work) work.close(SaveOptions.DONOTSAVECHANGES); } catch (eW) {}\n" +
            "  restoreCS();\n" +
            "  app.preferences.rulerUnits = oldUnits;\n" +
            "  app.displayDialogs = DialogModes.ALL;\n" +
            "}\n" +
            "})();";

        var resultBody = "";
        var bt = new BridgeTalk();
        bt.target = "photoshop";
        bt.body = body;
        bt.onResult = function (res) {
            resultBody = String(res.body || "");
        };
        bt.onError = function (res) {
            resultBody = "ERR:" + String(res.body || "Photoshop error");
        };
        var sent = bt.send(PS_SEND_TIMEOUT_SEC);
        if (resultBody) return resultBody;
        if (sent) return "ERR:Photoshop не вернул результат.";
        return "ERR:таймаут Photoshop (" + PS_SEND_TIMEOUT_SEC + " с).";
    }

    function photoshopErrorText(code) {
        var msg = String(code || "");
        if (msg.indexOf("ERR:") === 0) msg = msg.substr(4);
        return "Photoshop: " + msg +
            "\n\nНужен запущенный Photoshop. Кроп идёт через него," +
            " чтобы PNG был без полосок на прозрачности, а повороты запекались.";
    }

    function showMessage(title, txt) {
        var w = new Window("dialog", title);
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        var lines = String(txt).split("\n");
        var i;
        for (i = 0; i < lines.length; i++) {
            w.add("statictext", undefined, lines[i]);
        }
        w.add("button", undefined, "OK", { name: "ok" });
        w.show();
    }
})();
