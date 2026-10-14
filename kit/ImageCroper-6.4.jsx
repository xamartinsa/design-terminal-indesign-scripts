#target "indesign"

// ImageCroper 6.3
// Кроп выбранного image-фрейма через Photoshop (исходные пиксели).
// Цветовое пространство и ICC не трогаем: как было в файле, так и остаётся.
//
// 6.2 читал image.rotationAngle и прямоугольник geometricBounds.
// У картинки rotationAngle часто не равен матрице: у логотипа угол фрейма,
// у фото 0 при живом повороте в матрице. Прямоугольник bounds — это габарит,
// не углы пути. 6.3 берёт углы пути, переводит их в пиксели файла и
// запекает именно это окно. Рядом с кропом пишет текстовый лог.
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
    var SCRIPT_VERSION = "6.4";
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

    var logLines = [];
    var logFile = null;

    try {
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        var pageWidthMm = doc.documentPreferences.pageWidth;
        var pageHeightMm = doc.documentPreferences.pageHeight;
        var pageArea = Math.round(pageWidthMm * pageHeightMm);
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        app.scriptPreferences.enableRedraw = false;

        var targetDpi = getMinPPI(pageArea);
        var shortSide = Math.min(pageWidthMm, pageHeightMm);
        var longSide = Math.max(pageWidthMm, pageHeightMm);
        if (pageWidthMm > 0 && pageHeightMm > 0 && Math.abs(shortSide - 300) <= 1 && Math.abs(longSide - 400) <= 1) {
            targetDpi = 182;
        }
        var effective = Math.min(img.effectivePpi[0], img.effectivePpi[1]);
        var finalDpi = effective < targetDpi ? Math.round(effective) : targetDpi;
        if (!(finalDpi > 0)) finalDpi = targetDpi;

        var geom = measureCropGeometry(frame, img, origFile, ext);
        logLines = geom.log || [];
        logFile = new File(
            origFile.path + "/" + origFile.name.replace(/\.[^\.]+$/, "") + "_cropped.log"
        );
        if (!geom.ok) {
            logLines.push("ERROR " + geom.error);
            writeTextLog(logFile, logLines);
            showMessage("Ошибка", geom.error);
            return;
        }

        var targetW = Math.max(1, Math.round(geom.wantWpt / 72 * finalDpi));
        var targetH = Math.max(1, Math.round(geom.wantHpt / 72 * finalDpi));

        var destFile = new File(
            origFile.path + "/" + origFile.name.replace(/\.[^\.]+$/, "") + "_cropped" + newExt
        );
        logFile = new File(destFile.fsName.replace(/\.[^\.]+$/, "") + ".log");

        logLines.push("targetDpi " + targetDpi);
        logLines.push("effectivePpi " + Math.round(effective));
        logLines.push("finalDpi " + finalDpi);
        logLines.push("targetPx " + targetW + "x" + targetH);
        logLines.push("dest " + destFile.fsName);

        if (effective < targetDpi) {
            logLines.push("WARN source ppi below target, did not upscale");
        }
        if (geom.warning) {
            logLines.push("WARN " + geom.warning);
        }

        var psResult = runPhotoshopCrop({
            srcURI: origFile.absoluteURI,
            dstURI: destFile.absoluteURI,
            cropLeft: geom.cropLeft,
            cropTop: geom.cropTop,
            cropRight: geom.cropRight,
            cropBottom: geom.cropBottom,
            predW: geom.predW,
            predH: geom.predH,
            rotDeg: geom.psRotateDeg,
            targetW: targetW,
            targetH: targetH,
            dpi: finalDpi,
            saveKind: saveKind.code,
            embedProfile: embedProfile
        });

        logLines.push("photoshop " + psResult);
        if (psResult.indexOf("OK") !== 0) {
            writeTextLog(logFile, logLines);
            showMessage("Ошибка", photoshopErrorText(psResult));
            return;
        }

        destFile = new File(destFile.fsName);
        if (!destFile.exists) {
            logLines.push("ERROR dest missing");
            writeTextLog(logFile, logLines);
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
        placeImageOnPath(newImg, geom);
        doc.recompose();
        logLines.push("placed rotCCW " + round3(matrixRot(newImg)) +
            " hScale " + round3(newImg.horizontalScale) +
            " vScale " + round3(newImg.verticalScale));

        if (wasLocked) {
            try { frame.locked = true; } catch (eRelock) {}
        }

        writeTextLog(logFile, logLines);
        showMessage("\u0412\u0441\u0435 \u043e\u043a", "");
    } catch (e) {
        try {
            logLines.push("ERROR " + String(e.message || e));
            if (!logFile) {
                logFile = new File(origFile.path + "/" + origFile.name.replace(/\.[^\.]+$/, "") + "_cropped.log");
            }
            writeTextLog(logFile, logLines);
        } catch (eLog) {}
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

    function round3(v) {
        return Math.round(Number(v) * 1000) / 1000;
    }

    function dist2(a, b) {
        var dx = a[0] - b[0];
        var dy = a[1] - b[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    function writeTextLog(file, lines) {
        var f = new File(file.fsName);
        f.encoding = "UTF-8";
        if (!f.open("w")) return false;
        try {
            f.write("\uFEFFImageCroper " + SCRIPT_VERSION + "\r\n");
            f.write(lines.join("\r\n"));
            f.write("\r\n");
        } finally {
            try { f.close(); } catch (eC) {}
        }
        return true;
    }

    function pathAnchors(frame) {
        var ep = frame.paths[0].entirePath;
        var pts = [];
        var i, p;
        for (i = 0; i < ep.length; i++) {
            p = ep[i];
            if (typeof p[0] === "number") pts.push([Number(p[0]), Number(p[1])]);
            else pts.push([Number(p[0][0]), Number(p[0][1])]);
        }
        return pts;
    }

    function filePixelSize(file, fileExt) {
        try {
            if (fileExt === ".png") {
                var png = readBinaryHead(file, 32);
                if (png && bAt(png, 0) === 0x89) return { w: u32be(png, 16), h: u32be(png, 20) };
            }
            if (fileExt === ".jpg" || fileExt === ".jpeg") {
                var jpg = readBinaryHead(file, 1024 * 1024);
                if (!jpg || bAt(jpg, 0) !== 0xFF) return null;
                var i = 2;
                var limit = jpg.length;
                while (i + 9 < limit) {
                    if (bAt(jpg, i) !== 0xFF) { i += 1; continue; }
                    var marker = bAt(jpg, i + 1);
                    if (marker === 0xDA || marker === 0xD9) break;
                    if (marker === 0x00 || marker === 0xFF) { i += 1; continue; }
                    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { i += 2; continue; }
                    var len = u16be(jpg, i + 2);
                    if (len < 2) break;
                    var sof = (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC);
                    if (sof) return { w: u16be(jpg, i + 7), h: u16be(jpg, i + 5) };
                    i += 2 + len;
                }
            }
            if (fileExt === ".psd" || fileExt === ".psb") {
                var psd = readBinaryHead(file, 26);
                if (psd && psd.substring(0, 4) === "8BPS") return { h: u32be(psd, 14), w: u32be(psd, 18) };
            }
        } catch (ePx) {}
        return null;
    }

    // y вниз: atan2(dy, dx) — угол по часовой от оси +x, в градусах.
    function cwDeg(dx, dy) {
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    function rotCW(x, y, cx, cy, deg) {
        var rad = deg * Math.PI / 180;
        var cos = Math.cos(rad);
        var sin = Math.sin(rad);
        var dx = x - cx;
        var dy = y - cy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    }

    function matrixRot(item) {
        return item.transformValuesOf(CoordinateSpaces.PARENT_COORDINATES)[0].counterclockwiseRotationAngle;
    }

    // frameInner и pxPts — одни и те же углы пути, в пунктах фрейма и в пикселях файла.
    // Угол из панели сюда не передаётся.
    function planCropWindow(frameInner, pxPts, pixelW, pixelH) {
        var n = pxPts.length;
        var topI = 0;
        var topScore = 1e9;
        var i;
        for (i = 0; i < n; i++) {
            var a = frameInner[i];
            var b = frameInner[(i + 1) % n];
            var midY = (a[1] + b[1]) / 2;
            if (midY < topScore) { topScore = midY; topI = i; }
        }
        var iA = topI;
        var iB = (topI + 1) % n;
        if (frameInner[iB][0] < frameInner[iA][0]) {
            var swap = iA; iA = iB; iB = swap;
        }
        var sideI = (iA + 1) % n;
        if (sideI === iB) sideI = (iA + n - 1) % n;

        var wantWpt = dist2(frameInner[iA], frameInner[iB]);
        var wantHpt = dist2(frameInner[iA], frameInner[sideI]);
        var edgeDx = frameInner[iB][0] - frameInner[iA][0];
        var edgeDy = frameInner[iB][1] - frameInner[iA][1];
        var placeCCW = -cwDeg(edgeDx, edgeDy);
        var pixDx = pxPts[iB][0] - pxPts[iA][0];
        var pixDy = pxPts[iB][1] - pxPts[iA][1];
        var psRotateDeg = -cwDeg(pixDx, pixDy);
        if (almostZero(psRotateDeg, ANGLE_EPS)) psRotateDeg = 0;
        if (almostZero(placeCCW, ANGLE_EPS)) placeCCW = 0;

        var notRect = false;
        for (i = 0; i < n; i++) {
            var p0 = frameInner[i];
            var p1 = frameInner[(i + 1) % n];
            var p2 = frameInner[(i + 2) % n];
            var d1x = p1[0] - p0[0];
            var d1y = p1[1] - p0[1];
            var d2x = p2[0] - p1[0];
            var d2y = p2[1] - p1[1];
            var l1 = Math.sqrt(d1x * d1x + d1y * d1y);
            var l2 = Math.sqrt(d2x * d2x + d2y * d2y);
            if (l1 < 0.01 || l2 < 0.01) continue;
            var cosA = (d1x * d2x + d1y * d2y) / (l1 * l2);
            if (Math.abs(cosA) > 0.05) notRect = true;
        }

        var cx = pixelW / 2;
        var cy = pixelH / 2;
        var corners = [[0, 0], [pixelW, 0], [pixelW, pixelH], [0, pixelH]];
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        var cminX = 1e9, cminY = 1e9, cmaxX = -1e9, cmaxY = -1e9;
        for (i = 0; i < 4; i++) {
            var rc = rotCW(corners[i][0], corners[i][1], cx, cy, psRotateDeg);
            if (rc[0] < minX) minX = rc[0];
            if (rc[1] < minY) minY = rc[1];
            if (rc[0] > maxX) maxX = rc[0];
            if (rc[1] > maxY) maxY = rc[1];
        }
        for (i = 0; i < pxPts.length; i++) {
            var rp = rotCW(pxPts[i][0], pxPts[i][1], cx, cy, psRotateDeg);
            if (rp[0] < cminX) cminX = rp[0];
            if (rp[1] < cminY) cminY = rp[1];
            if (rp[0] > cmaxX) cmaxX = rp[0];
            if (rp[1] > cmaxY) cmaxY = rp[1];
        }
        return {
            iA: iA,
            iB: iB,
            sideI: sideI,
            wantWpt: wantWpt,
            wantHpt: wantHpt,
            placeCCW: placeCCW,
            psRotateDeg: psRotateDeg,
            notRect: notRect || n !== 4,
            cropLeft: cminX - minX,
            cropTop: cminY - minY,
            cropRight: cmaxX - minX,
            cropBottom: cmaxY - minY,
            predW: maxX - minX,
            predH: maxY - minY
        };
    }

    // Углы пути в координатах линейки (как geometricBounds) → пиксели файла.
    // rotationAngle картинки не используем: он не совпадает с матрицей.
    function measureCropGeometry(srcFrame, srcImg, srcFile, fileExt) {
        var log = [];
        try {
            log.push("source " + srcFile.fsName);
            log.push("frame " + srcFrame.name);
            log.push("frame.rotationAngle " + round3(srcFrame.rotationAngle));
            log.push("image.rotationAngle " + round3(srcImg.rotationAngle));
            log.push("image.matrixRotCCW " + round3(matrixRot(srcImg)));
            var shear = 0;
            try { shear = Number(srcImg.shearAngle) || 0; } catch (eSh) {}
            try {
                var sh2 = srcImg.transformValuesOf(CoordinateSpaces.PARENT_COORDINATES)[0].clockwiseShearAngle;
                if (Math.abs(sh2) > Math.abs(shear)) shear = sh2;
            } catch (eSh2) {}
            log.push("shear " + round3(shear));
            if (Math.abs(shear) > SHEAR_EPS) {
                return { ok: false, error: "У изображения задан shear — ImageCroper его не обрабатывает.", log: log };
            }
            if (!srcFrame.paths || srcFrame.paths.length < 1) {
                return { ok: false, error: "У фрейма нет пути.", log: log };
            }

            var pagePts = pathAnchors(srcFrame);
            if (pagePts.length < 3) {
                return { ok: false, error: "В пути фрейма меньше трёх точек.", log: log };
            }
            var page = null;
            try { page = srcFrame.parentPage; } catch (ePg) {}
            var pageTL = [0, 0];
            if (page) {
                pageTL = page.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES, false)[0];
            } else {
                log.push("WARN frame has no page, path origin assumed 0,0");
            }
            var frameInv = srcFrame.transformValuesOf(CoordinateSpaces.SPREAD_COORDINATES)[0].invertMatrix();
            var imgInv = srcImg.transformValuesOf(CoordinateSpaces.PARENT_COORDINATES)[0].invertMatrix();
            var frameInner = [];
            var imgInner = [];
            var spreadPts = [];
            var i;
            for (i = 0; i < pagePts.length; i++) {
                var spread = [pagePts[i][0] + pageTL[0], pagePts[i][1] + pageTL[1]];
                var fin = frameInv.changeCoordinates(spread);
                var iin = imgInv.changeCoordinates(fin);
                spreadPts.push(spread);
                frameInner.push([fin[0], fin[1]]);
                imgInner.push([iin[0], iin[1]]);
                log.push("pt " + i + " frameInner " + round3(fin[0]) + "," + round3(fin[1]) +
                    " imgInner " + round3(iin[0]) + "," + round3(iin[1]));
            }

            var tl = srcImg.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.INNER_COORDINATES, false)[0];
            var tr = srcImg.resolve(AnchorPoint.TOP_RIGHT_ANCHOR, CoordinateSpaces.INNER_COORDINATES, false)[0];
            var bl = srcImg.resolve(AnchorPoint.BOTTOM_LEFT_ANCHOR, CoordinateSpaces.INNER_COORDINATES, false)[0];
            var innerW = tr[0] - tl[0];
            var innerH = bl[1] - tl[1];
            if (!(innerW > 0.01 && innerH > 0.01)) {
                return { ok: false, error: "Нулевой размер изображения.", log: log };
            }
            var ppiW = Number(srcImg.actualPpi[0]) || 72;
            var ppiH = Number(srcImg.actualPpi[1]) || ppiW;
            var estW = innerW / 72 * ppiW;
            var estH = innerH / 72 * ppiH;
            var header = filePixelSize(srcFile, fileExt);
            var pixelW = header ? header.w : estW;
            var pixelH = header ? header.h : estH;
            log.push("innerPt " + round3(innerW) + "x" + round3(innerH));
            log.push("ppiEstimate " + round3(estW) + "x" + round3(estH));
            log.push("filePx " + round3(pixelW) + "x" + round3(pixelH) + (header ? " header" : " ppi"));

            var pxPts = [];
            for (i = 0; i < imgInner.length; i++) {
                pxPts.push([
                    (imgInner[i][0] - tl[0]) / innerW * pixelW,
                    (imgInner[i][1] - tl[1]) / innerH * pixelH
                ]);
                log.push("px " + i + " " + round3(pxPts[i][0]) + "," + round3(pxPts[i][1]));
            }

            var plan = planCropWindow(frameInner, pxPts, pixelW, pixelH);
            if (!(plan.wantWpt > 0.5 && plan.wantHpt > 0.5)) {
                return { ok: false, error: "Нулевая сторона пути.", log: log };
            }
            log.push("topEdge " + plan.iA + "->" + plan.iB + " side " + plan.sideI);
            log.push("wantPt " + round3(plan.wantWpt) + "x" + round3(plan.wantHpt));
            log.push("placeCCW " + round3(plan.placeCCW));
            log.push("psRotate " + round3(plan.psRotateDeg));
            log.push("predCanvas " + round3(plan.predW) + "x" + round3(plan.predH));
            log.push("cropPx " + round3(plan.cropLeft) + "," + round3(plan.cropTop) + " " +
                round3(plan.cropRight) + "," + round3(plan.cropBottom));

            var scx = 0, scy = 0;
            for (i = 0; i < spreadPts.length; i++) {
                scx += spreadPts[i][0];
                scy += spreadPts[i][1];
            }
            scx /= spreadPts.length;
            scy /= spreadPts.length;

            var warning = "";
            if (plan.notRect) {
                warning = "Путь фрейма не прямоугольник. Кроп — прямоугольник по верхней стороне, углы пути обрежутся этим прямоугольником.";
            }

            return {
                ok: true,
                log: log,
                warning: warning,
                cropLeft: plan.cropLeft,
                cropTop: plan.cropTop,
                cropRight: plan.cropRight,
                cropBottom: plan.cropBottom,
                predW: plan.predW,
                predH: plan.predH,
                psRotateDeg: plan.psRotateDeg,
                placeCCW: plan.placeCCW,
                wantWpt: plan.wantWpt,
                wantHpt: plan.wantHpt,
                topA: frameInner[plan.iA],
                topB: frameInner[plan.iB],
                side: frameInner[plan.sideI],
                spreadCenter: [scx, scy]
            };
        } catch (eMeas) {
            log.push("ERROR " + eMeas.message);
            return { ok: false, error: "Не удалось снять геометрию кропа: " + eMeas.message, log: log };
        }
    }

    function placeImageOnPath(img, geom) {
        var cur = matrixRot(img);
        var delta = geom.placeCCW - cur;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        if (Math.abs(delta) > ANGLE_EPS) {
            img.transform(
                CoordinateSpaces.PARENT_COORDINATES,
                AnchorPoint.CENTER_ANCHOR,
                app.transformationMatrices.add({ counterclockwiseRotationAngle: delta })
            );
        }
        var tl = img.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.PARENT_COORDINATES, false)[0];
        var tr = img.resolve(AnchorPoint.TOP_RIGHT_ANCHOR, CoordinateSpaces.PARENT_COORDINATES, false)[0];
        var bl = img.resolve(AnchorPoint.BOTTOM_LEFT_ANCHOR, CoordinateSpaces.PARENT_COORDINATES, false)[0];
        var curW = dist2(tl, tr);
        var curH = dist2(tl, bl);
        if (curW > 0.01) {
            img.horizontalScale = Math.abs(Number(img.horizontalScale) || 100) * (geom.wantWpt / curW);
        }
        if (curH > 0.01) {
            img.verticalScale = Math.abs(Number(img.verticalScale) || 100) * (geom.wantHpt / curH);
        }
        tl = img.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES, false)[0];
        tr = img.resolve(AnchorPoint.TOP_RIGHT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES, false)[0];
        var br = img.resolve(AnchorPoint.BOTTOM_RIGHT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES, false)[0];
        bl = img.resolve(AnchorPoint.BOTTOM_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES, false)[0];
        var icx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
        var icy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
        img.move(undefined, [geom.spreadCenter[0] - icx, geom.spreadCenter[1] - icy]);
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
            "var rotDeg = " + num(p.rotDeg) + ";\n" +
            "var cropLeft = " + num(p.cropLeft) + ";\n" +
            "var cropTop = " + num(p.cropTop) + ";\n" +
            "var cropRight = " + num(p.cropRight) + ";\n" +
            "var cropBottom = " + num(p.cropBottom) + ";\n" +
            "var predW = " + num(p.predW) + ";\n" +
            "var predH = " + num(p.predH) + ";\n" +
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
            "  if (Math.abs(rotDeg) > 0.05) work.rotateCanvas(rotDeg);\n" +
            "  var sx = predW > 1 ? px(work.width) / predW : 1;\n" +
            "  var sy = predH > 1 ? px(work.height) / predH : 1;\n" +
            "  var w = px(work.width);\n" +
            "  var h = px(work.height);\n" +
            "  var left = cropLeft * sx;\n" +
            "  var top = cropTop * sy;\n" +
            "  var right = cropRight * sx;\n" +
            "  var bottom = cropBottom * sy;\n" +
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
            "    var rs = Math.min(targetW / cw, targetH / ch);\n" +
            "    var ow = Math.max(1, Math.round(cw * rs));\n" +
            "    var oh = Math.max(1, Math.round(ch * rs));\n" +
            "    work.resizeImage(ow, oh, dpi, ResampleMethod.BICUBIC);\n" +
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
            "  return 'OK sx=' + sx + ' sy=' + sy + ' canvas=' + w + 'x' + h;\n" +
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
        var lines = String(txt || "").split("\n");
        var i;
        for (i = 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            w.add("statictext", undefined, lines[i]);
        }
        w.add("button", undefined, "OK", { name: "ok" });
        w.show();
    }
})();
