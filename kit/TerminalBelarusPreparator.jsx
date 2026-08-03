#target "indesign"

var doc = app.activeDocument;

// Очищаем все настройки поиска перед началом работы
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;
app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;

// Включаем все опции поиска
app.findChangeTextOptions.includeFootnotes = true;
app.findChangeTextOptions.includeMasterPages = true;
app.findChangeTextOptions.includeHiddenLayers = true;
app.findChangeTextOptions.caseSensitive = false;

// Замена символа рубля
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

app.findTextPreferences.findWhat = "₽";
app.changeTextPreferences.changeTo = "[country.currencySign]";
var rubleCount = doc.changeText().length;

// Если не нашли рубль, пробуем через GREP юникод
if (rubleCount === 0) {
    app.findGrepPreferences = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
    
    app.findGrepPreferences.findWhat = "\\u20BD";
    app.changeGrepPreferences.changeTo = "[country.currencySign]";
    rubleCount = doc.changeGrep().length;
}

// Замена "р." на [country.currencySign]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

app.findGrepPreferences = NothingEnum.nothing;
app.changeGrepPreferences = NothingEnum.nothing;

// Используем GREP для поиска "р." только как отдельного слова
app.findGrepPreferences.findWhat = "\\bр\\.\\b";
app.changeGrepPreferences.changeTo = "[country.currencySign]";
var rDotCount = doc.changeGrep().length;

// Замена [company.stateNumber] на [company.stateNumberLong]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

app.findTextPreferences.findWhat = "[company.stateNumber]";
app.changeTextPreferences.changeTo = "[company.stateNumberLong]";
var stateNumberCount = doc.changeText().length;

// Замена [company.ogrn] на [company.stateNumber]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

app.findTextPreferences.findWhat = "[company.ogrn]";
app.changeTextPreferences.changeTo = "[company.stateNumber]";
var ogrnCount = doc.changeText().length;

// Замена [company.legalAdress] на [company.legalAddress]
app.findTextPreferences = NothingEnum.nothing;
app.changeTextPreferences = NothingEnum.nothing;

app.findTextPreferences.findWhat = "[company.legalAdress]";
app.changeTextPreferences.changeTo = "[company.legalAddress]";
var addressCount = doc.changeText().length;

// Формируем отчет
var report = "Подготовка макета к Беларуси завершена:\n\n";
report += "Заменено символов рубля (₽ → [country.currencySign]): " + rubleCount + "\n";
report += "Заменено 'р.' на [country.currencySign]: " + rDotCount + "\n";
report += "Заменено stateNumber: " + stateNumberCount + "\n";
report += "Заменено OGRN на stateNumber: " + ogrnCount + "\n";
report += "Заменено legalAdress на legalAddress: " + addressCount + "\n\n";
report += "Все замены выполнены успешно.";

alert(report); 