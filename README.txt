# DT InDesign Scripts

Скрипты для панели **Scripts** в Adobe InDesign.  
Ставятся в отдельную папку **Design Terminal Git** — ваши остальные скрипты не трогает.

---

## Скачать апдейтер

| Компьютер | Скачать (одна кнопка / ссылка) |
|-----------|--------------------------------|
| **Windows** | **[⬇ Update-DT-Scripts.bat](https://gitlab.com/xamartinsa/design-terminal-indesign-scripts/-/raw/main/Update-DT-Scripts.bat?inline=false)** |
| **Mac** | **[⬇ Update-DT-Scripts.command](https://gitlab.com/xamartinsa/design-terminal-indesign-scripts/-/raw/main/Update-DT-Scripts.command?inline=false)** |

Скачивай из браузера по ссылке выше. Не пересылай файл через Telegram, если можно — на Mac из‑за этого часто «файл повреждён».

После скачивания файл обычно лежит в папке **Загрузки / Downloads**.

---

## Windows — куда нажать

1. Открой ссылку **Windows** выше → файл сохранится (или браузер спросит «Сохранить»).
2. В папке **Загрузки** найди `Update-DT-Scripts.bat`.
3. **Дважды кликни** по нему.
4. Если Windows спросит «разрешить этому приложению вносить изменения / открыть» — **Да / Run**.
5. Подожди, пока в чёрном окне напишет **Done**. Нажми любую клавишу, чтобы закрыть.
6. Открой (или перезапусти) **InDesign** → панель **Scripts** → папка **Design Terminal Git**.

Админ-права не нужны.

---

## Mac — куда нажать

1. Открой ссылку **Mac** выше → сохрани `Update-DT-Scripts.command` в **Downloads**.
2. В Finder открой **Downloads**.
3. **Не** обычный двойной клик с первого раза.  
   **Правый клик** (или Control+клик) по файлу → **Open** / **Открыть**.
4. Если спросит подтверждение — снова **Open**.
5. Откроется Terminal, дождись **Done**, нажми Enter.
6. Открой (или перезапусти) **InDesign** → **Scripts** → **Design Terminal Git**.

Админ-права не нужны.

### Если Mac пишет «повреждено» и предлагает Корзину

Это карантин (часто после Telegram). Сделай так:

1. Открой **Программы → Утилиты → Терминал** (или Spotlight → `Terminal`).
2. **Скопируй целиком** одну строку ниже и вставь в Terminal (Cmd+V), нажми Enter:

```bash
xattr -cr ~/Downloads/Update-DT-Scripts.command && chmod +x ~/Downloads/Update-DT-Scripts.command && open ~/Downloads/Update-DT-Scripts.command
```

3. Если файл лежит не в Downloads или называется иначе (например `Update-DT-Scripts (2).command`) — подставь свой путь, например:

```bash
xattr -cr ~/Downloads/Update-DT-Scripts\ \(2\).command && chmod +x ~/Downloads/Update-DT-Scripts\ \(2\).command && open ~/Downloads/Update-DT-Scripts\ \(2\).command
```

Или ещё проще (тоже в Terminal, Enter):

```bash
bash ~/Downloads/Update-DT-Scripts.command
```

---

## Что внутри набора

- TerminalPreparator  
- LegalParagraphSetup  
- ImageCroper  
- ImageLinkSyncer  
- FontSyncer  
- SaveAsInddAndIdml  
- TerminalBelarusPreparator  
- AutoFontSizeGrep  
- LegalBarcodeInsert  

## Если апдейтер уже открылся, но упал с ошибкой

Пришли файл лога:

| Система | Где лежит лог |
|---------|----------------|
| Mac | `~/Library/Logs/DesignTerminal/update-last.log` |
| Windows | `%LOCALAPPDATA%\DesignTerminal\update-last.log` |
| Оба | рядом со скриптами: `Design Terminal Git/_update-last.log` |

На Mac в Finder: Cmd+Shift+G → вставь путь → Enter.

---

# English (short)

| OS | Download |
|----|----------|
| **Windows** | **[Update-DT-Scripts.bat](https://gitlab.com/xamartinsa/design-terminal-indesign-scripts/-/raw/main/Update-DT-Scripts.bat?inline=false)** |
| **Mac** | **[Update-DT-Scripts.command](https://gitlab.com/xamartinsa/design-terminal-indesign-scripts/-/raw/main/Update-DT-Scripts.command?inline=false)** |

- **Windows:** double-click the `.bat` → wait for Done → InDesign Scripts → **Design Terminal Git**.  
- **Mac:** right-click → Open (first time). If macOS says “damaged”, run in Terminal:

```bash
xattr -cr ~/Downloads/Update-DT-Scripts.command && chmod +x ~/Downloads/Update-DT-Scripts.command && open ~/Downloads/Update-DT-Scripts.command
```

Logs: macOS `~/Library/Logs/DesignTerminal/update-last.log` · Windows `%LOCALAPPDATA%\DesignTerminal\update-last.log` · or `Design Terminal Git/_update-last.log`
