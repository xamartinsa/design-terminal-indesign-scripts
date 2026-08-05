# DT InDesign Scripts

Скрипты для InDesign Scripts Panel.

Обновление: запусти Update-DT-Scripts.bat (Windows) или Update-DT-Scripts.command (macOS).
Файлы ставятся в отдельную папку **Design Terminal Git** — другие скрипты не трогает.

## macOS

1. Скачай `Update-DT-Scripts.command` из браузера (не из Telegram, если можно).
2. Первый запуск: правый клик → Open.
3. Если macOS пишет «повреждено» (часто после Telegram) — открой Terminal и выполни (подставь свой путь):

```bash
xattr -cr ~/Downloads/Update-DT-Scripts.command
chmod +x ~/Downloads/Update-DT-Scripts.command
open ~/Downloads/Update-DT-Scripts.command
```

Или просто: `bash ~/Downloads/Update-DT-Scripts.command`

Админ-права не нужны.

## Лог (если что-то пошло не так уже в окне Terminal)

- macOS: `~/Library/Logs/DesignTerminal/update-last.log`
- Windows: `%LOCALAPPDATA%\DesignTerminal\update-last.log`
- Копия рядом со скриптами: `Design Terminal Git/_update-last.log`

В наборе:
- TerminalPreparator
- LegalParagraphSetup
- ImageCroper
- ImageLinkSyncer
- SaveAsInddAndIdml
- TerminalBelarusPreparator

---

# DT InDesign Scripts

Scripts for the InDesign Scripts Panel.

Update: run Update-DT-Scripts.bat (Windows) or Update-DT-Scripts.command (macOS).
Files go into a separate folder **Design Terminal Git** — other scripts are left alone.

## macOS

1. Prefer downloading `Update-DT-Scripts.command` in a browser (not Telegram).
2. First launch: right-click → Open.
3. If macOS says the file is “damaged” (common after Telegram), run in Terminal:

```bash
xattr -cr ~/Downloads/Update-DT-Scripts.command
chmod +x ~/Downloads/Update-DT-Scripts.command
open ~/Downloads/Update-DT-Scripts.command
```

Or: `bash ~/Downloads/Update-DT-Scripts.command`

No admin rights needed.

## Log (only if the updater already opened Terminal)

- macOS: `~/Library/Logs/DesignTerminal/update-last.log`
- Windows: `%LOCALAPPDATA%\DesignTerminal\update-last.log`
- Copy next to scripts: `Design Terminal Git/_update-last.log`

Included:
- TerminalPreparator
- LegalParagraphSetup
- ImageCroper
- ImageLinkSyncer
- SaveAsInddAndIdml
- TerminalBelarusPreparator
