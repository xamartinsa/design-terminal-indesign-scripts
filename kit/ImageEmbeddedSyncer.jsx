#target "indesign"

// Проверяем, открыт ли документ
if (app.documents.length === 0) {
    alert("⚠ Нет открытых документов!");
    exit();
}

// Получаем активный документ
var doc = app.activeDocument;

// Получаем и проверяем путь к папке Links
var docPath = doc.fullName.parent.fsName;
var packagePath = docPath + "/Links";
var linksFolder = new Folder(packagePath);

// Проверяем существование папки Links
if (!linksFolder.exists) {
    try {
        linksFolder.create();
        if (!linksFolder.exists) {
            alert("⚠ Не удалось создать папку Links!\nПроверьте права доступа к " + docPath);
            exit();
        }
    } catch(e) {
        alert("⚠ Ошибка при создании папки Links:\n" + e);
        exit();
    }
}

// Массивы для хранения найденных изображений
var embeddedImages = [];
var skippedQRCodes = [];

// Функция для проверки, является ли изображение QR-кодом
function isQRCode(name) {
    // Проверяем, содержит ли имя файла "QR" или "Code" в начале имени или после разделителей
    var nameParts = name.split(/[-_\s.]/);
    for (var i = 0; i < nameParts.length; i++) {
        var part = nameParts[i].toLowerCase();
        if (part === "qr" || part === "code" || part.indexOf("qrcode") === 0) {
            return true;
        }
    }
    return false;
}

// Функция для генерации уникального имени файла
function generateFileName(frame, index) {
    var date = new Date();
    var timestamp = date.getFullYear() + 
                   ("0" + (date.getMonth() + 1)).slice(-2) + 
                   ("0" + date.getDate()).slice(-2) + 
                   ("0" + date.getHours()).slice(-2) + 
                   ("0" + date.getMinutes()).slice(-2);
    return "image_" + timestamp + "_" + index + ".png";
}

// Функция для поиска всех изображений в документе
function findAllImages() {
    // Проходим по всем страницам документа
    for (var i = 0; i < doc.pages.length; i++) {
        var page = doc.pages[i];
        
        // Получаем все графические фреймы на странице
        for (var j = 0; j < page.allGraphics.length; j++) {
            var graphic = page.allGraphics[j];
            var frame = graphic.parent;
            
            try {
                // Проверяем наличие связи
                if (!graphic.itemLink) {
                    // Генерируем имя для изображения
                    var fileName = generateFileName(frame, embeddedImages.length + 1);
                    
                    // Пропускаем QR-коды
                    if (isQRCode(fileName)) {
                        skippedQRCodes.push(fileName);
                        continue;
                    }
                    
                    embeddedImages.push({
                        frame: frame,
                        graphic: graphic,
                        name: fileName
                    });
                }
            } catch(e) {
                alert("Ошибка при проверке изображения: " + e);
            }
        }
    }
}

// Ищем все изображения
findAllImages();

// Если найдены встроенные изображения
if (embeddedImages.length > 0) {
    var message = "⚠ В документе найдены встроенные изображения (" + embeddedImages.length + " шт.):\n";
    
    for (var i = 0; i < embeddedImages.length; i++) {
        message += "- " + embeddedImages[i].name + "\n";
    }
    
    if (skippedQRCodes.length > 0) {
        message += "\nПропущены QR-коды (" + skippedQRCodes.length + " шт.):\n";
        for (var i = 0; i < skippedQRCodes.length; i++) {
            message += "- " + skippedQRCodes[i] + "\n";
        }
    }
    
    message += "\nВыберите действие:\n";
    message += "OK - извлечь изображения в папку Links\n";
    message += "Отмена - оставить встроенными";
    
    var dialog = new Window("dialog", "Встроенные изображения");
    dialog.margins = [20, 10, 20, 20]; // [left, top, right, bottom]
    dialog.preferredSize.width = 300; // Фиксированная ширина диалога
    
    // Добавляем текст сообщения
    var messageText = dialog.add("statictext", undefined, message, {multiline: true});
    messageText.alignment = "left";
    
    // Создаем группу для кнопок
    var buttonGroup = dialog.add("group");
    buttonGroup.orientation = "row";
    buttonGroup.alignment = "center";
    buttonGroup.margins = [0, 10, 0, 0]; // отступ сверху между текстом и кнопками
    
    // Добавляем кнопки
    var extractButton = buttonGroup.add("button", undefined, "Вытащить в линк");
    var keepButton = buttonGroup.add("button", undefined, "Оставить картинки вшитыми");
    
    var userChoice = false;
    
    extractButton.onClick = function() {
        userChoice = true;
        dialog.close();
    }
    
    keepButton.onClick = function() {
        userChoice = false;
        dialog.close();
    }
    
    dialog.show();
    
    if (userChoice) {
        var extractedCount = 0;
        var errorLinks = [];
        
        // Пробуем извлечь каждое встроенное изображение
        for (var i = 0; i < embeddedImages.length; i++) {
            try {
                var frame = embeddedImages[i].frame;
                var fileName = embeddedImages[i].name;
                var newFile = new File(packagePath + "/" + fileName);
                
                // Экспортируем изображение напрямую
                embeddedImages[i].graphic.exportFile(ExportFormat.PNG_FORMAT, newFile);
                
                // Если файл успешно создан, создаем связь и удаляем встроенное изображение
                if (newFile.exists) {
                    // Сохраняем ссылку на графику перед заменой
                    var oldGraphic = embeddedImages[i].graphic;
                    
                    // Создаем новую связь
                    frame.place(newFile);
                    
                    try {
                        // Пытаемся отвязать и удалить старое изображение
                        if (oldGraphic.itemLink) {
                            oldGraphic.itemLink.unlink();
                        }
                        oldGraphic.unembed();
                    } catch(e) {
                        // Если не получилось - просто продолжаем
                    }
                    
                    extractedCount++;
                }
            } catch(e) {
                errorLinks.push(fileName + " (" + e.message + ")");
            }
        }
        
        // Формируем отчет о результатах
        var report = "";
        if (extractedCount > 0) {
            report += "✓ Извлечено изображений: " + extractedCount + " из " + embeddedImages.length + "\n";
        }
        if (errorLinks.length > 0) {
            report += "\n⚠ Не удалось извлечь следующие изображения:\n";
            for (var i = 0; i < errorLinks.length; i++) {
                report += "   - " + errorLinks[i] + "\n";
            }
        }
        if (skippedQRCodes.length > 0) {
            report += "\nℹ QR-коды оставлены встроенными: " + skippedQRCodes.length + " шт.";
        }
        alert(report);
    } else {
        alert("Изображения оставлены встроенными");
    }
} else {
    var message = "✓ Встроенных изображений не найдено!";
    if (skippedQRCodes.length > 0) {
        message += "\n\nℹ Пропущены QR-коды (" + skippedQRCodes.length + " шт.):\n";
        for (var i = 0; i < skippedQRCodes.length; i++) {
            message += "   - " + skippedQRCodes[i] + "\n";
        }
    }
    alert(message);
}
