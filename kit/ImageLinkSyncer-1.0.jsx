#target "indesign"

// Получаем путь к папке Links
var doc = app.activeDocument;
var docPath = doc.fullName.parent.fsName;
var packagePath = docPath + "/Links";

// Проверяем папку Links
var linksFolder = new Folder(packagePath);
if (!linksFolder.exists) {
    alert("⚠ Не найдена папка Links!");
    exit();
}

// Получаем все линки в документе
var allLinks = doc.links;
var copiedCount = 0;
var usedFiles = {};

// Функция для нормализации пути
function normalizePath(path) {
    return decodeURI(path).replace(/\\/g, "/");
}

// Собираем список используемых файлов и копируем их
for (var i = 0; i < allLinks.length; i++) {
    var link = allLinks[i];
    var linkName = decodeURI(link.name);
    usedFiles[linkName] = true;
    
    var currentPath = normalizePath(link.filePath);
    var correctPath = normalizePath(packagePath + "/" + link.name);
    
    if (currentPath !== correctPath) {
        try {
            // Проверяем существует ли уже файл в папке Links
            var existingFile = new File(packagePath + "/" + link.name);
            if (existingFile.exists) {
                existingFile.remove();
            }
            
            // Копируем файл
            link.copyLink(packagePath);
            
            // Обновляем ссылку в документе
            var newFile = new File(packagePath + "/" + link.name);
            if (newFile.exists) {
                link.relink(newFile);
                link.update();
            }
            
            copiedCount++;
        } catch(e) {
            alert("Ошибка при копировании " + linkName + ": " + e);
        }
    }
}

// Проверяем и удаляем неиспользуемые файлы
var existingFiles = linksFolder.getFiles();
var removedCount = 0;

for (var i = 0; i < existingFiles.length; i++) {
    var fileName = decodeURI(existingFiles[i].name);
    if (!usedFiles[fileName]) {
        if (existingFiles[i].remove()) {
            removedCount++;
        }
    }
}

// Формируем отчет
var report = "";
if (copiedCount > 0) {
    report += "✓ Скопировано файлов: " + copiedCount + "\n";
}
if (removedCount > 0) {
    report += "✓ Удалено неиспользуемых файлов: " + removedCount;
}
if (copiedCount === 0 && removedCount === 0) {
    report = "✓ Все файлы уже в порядке!";
}

alert(report); 