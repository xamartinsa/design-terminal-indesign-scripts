// Получаем активный документ
var doc = app.activeDocument;

// Получаем путь и имя файла без расширения
var filePath = doc.filePath;
var fileName = doc.name.replace(/\.indd$/, '');

// Сохраняем документ в формате INDD
var inddFile = new File(filePath + "/" + fileName + ".indd");
doc.save(inddFile);

// Сохраняем документ в формате IDML
var idmlFile = new File(filePath + "/" + fileName + ".idml");
doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);

//alert("Файл успешно сохранен в форматах INDD и IDML.");
