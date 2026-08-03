#target "indesign";
#targetengine "session";

// ------------------------------------------------------------
// ImageCroper 5.0
// Экспорт изображения из выбранного фрейма InDesign без артефактов
// прозрачности (полосок) – только силами InDesign.
// ------------------------------------------------------------

/***************** УТИЛИТЫ ************************/ 
function getMinPPI(area) {
    if (area <= 62370)  return 300;
    if (area <= 124740) return 256;
    if (area <= 249480) return 182;
    if (area <= 499554) return 129;
    if (area <= 999949) return 92;
    return 65;
}

function showMessage(title, txt) {
    var w = new Window("dialog", title);
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    var lines = txt.split('\n');
    for (var i = 0; i < lines.length; i++) {
        w.add("statictext", undefined, lines[i]);
    }
    w.add("button", undefined, "OK", {name: "ok"});
    w.show();
}

/***************** ГЛАВНОЕ ************************/ 
function main(){
    if(app.documents.length===0){ showMessage("Ошибка","Нет открытых документов."); return; }
    var doc = app.activeDocument;
    if(doc.selection.length===0 || !doc.selection[0].hasOwnProperty("images") || doc.selection[0].images.length===0){
        showMessage("Ошибка","Выберите фрейм с изображением."); return;
    }

    var frame = doc.selection[0];
    var img   = frame.images[0];
    if(img.itemLink.status!==LinkStatus.NORMAL){ showMessage("Ошибка","Связь с изображением потеряна."); return; }

    var origFile = new File(img.itemLink.filePath);

    // dpi
    var pageArea   = doc.documentPreferences.pageWidth * doc.documentPreferences.pageHeight;
    var targetDpi  = getMinPPI(Math.round(pageArea));
    var effective  = Math.min(img.effectivePpi[0], img.effectivePpi[1]);
    var finalDpi   = effective < targetDpi ? Math.round(effective) : targetDpi;
    var warn = (effective < targetDpi) ? "\n\n⚠ Разрешение исходника ("+finalDpi+" ppi) ниже требуемого ("+targetDpi+" ppi)." : "";

    // параметры экспорта
    var ext = origFile.name.substr(origFile.name.lastIndexOf('.')).toLowerCase();
    var newExt, exportFormat;
    if(ext==='.jpg' || ext==='.jpeg'){
        exportFormat = ExportFormat.JPG;
        newExt = '.jpg';
        app.jpegExportPreferences.properties = {
            jpegQuality:JPEGOptionsQuality.MAXIMUM,
            exportResolution:finalDpi,
            jpegColorSpace:JpegColorSpaceEnum.RGB,
            useDocumentBleeds:false
        };
    }else{
        exportFormat = ExportFormat.PNG_FORMAT;
        newExt = '.png';
        app.pngExportPreferences.properties = {
            transparentBackground:true,
            pngQuality:PNGQualityEnum.HIGH,
            pngColorSpace:PNGColorSpaceEnum.RGB,
            exportResolution:finalDpi,
            antiAlias:true
        };
    }

    var newPath = origFile.path + "/" + origFile.name.replace(/\.[^\.]+$/, "") + "_cropped" + newExt;
    var newFile = new File(newPath);

    try{
        frame.exportFile(exportFormat, newFile, false);
        img.itemLink.relink(newFile);
        doc.recompose();
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        frame.fit(FitOptions.CENTER_CONTENT);
        showMessage("Готово","Изображение экспортировано без артефактов!"+warn);
    }catch(e){
        showMessage("Ошибка","Не удалось экспортировать изображение:\n"+e.message);
    }
}

main(); 