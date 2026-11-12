#target illustrator
// AIToInDesign runner. The real script and its helpers live in the sandbox repo:
// C:/Users/Karen/Desktop/gitlab/design-terminal/sandbox/scripts/Illustrator - AIToInDesign/
// Edit them there, not here.
// On other computers it runs the copy from Design Terminal Kit (InDesign Scripts panel,
// folder "AI to InDesign"), installed by Update-DT-Scripts.bat (Windows) or
// Update-DT-Scripts.command (Mac).
(function () {
    var target = new File("C:/Users/Karen/Desktop/gitlab/design-terminal/sandbox/scripts/Illustrator - AIToInDesign/AIToInDesign.jsx");
    if (!target.exists) {
        target = findInKit();
    }
    if (!target) {
        alert("AIToInDesign is not installed on this computer.\n\nInstall Design Terminal Kit (Update-DT-Scripts.bat on Windows, Update-DT-Scripts.command on Mac), then run this again:\nhttps://gitlab.com/xamartinsa/design-terminal-indesign-scripts");
        return;
    }
    $.evalFile(target);

    function findInKit() {
        // Windows: %APPDATA%\Adobe\InDesign\Version *\<locale>\Scripts\Scripts Panel
        // Mac: ~/Library/Preferences/Adobe InDesign/Version */<locale>/Scripts/Scripts Panel
        var isMac = File.fs == "Macintosh";
        var root = isMac ? new Folder("~/Library/Preferences/Adobe InDesign") : new Folder(Folder.userData.fsName + "/Adobe/InDesign");
        if (!root.exists) { return null; }
        var best = null;
        var bestVersion = -1;
        var versions = root.getFiles("Version *");
        for (var v = 0; v < versions.length; v++) {
            if (!(versions[v] instanceof Folder)) { continue; }
            var num = parseFloat(String(versions[v].name).replace(/^Version(\s|%20)+/i, "")) || 0;
            var locales = versions[v].getFiles();
            for (var l = 0; l < locales.length; l++) {
                if (!(locales[l] instanceof Folder)) { continue; }
                var dir = new Folder(locales[l].fsName + "/Scripts/Scripts Panel/Design Terminal Kit/AI to InDesign");
                if (!dir.exists) { continue; }
                var files = dir.getFiles("AIToInDesign*.jsx");
                if (files.length && num > bestVersion) {
                    best = files[0];
                    bestVersion = num;
                }
            }
        }
        return best;
    }
})();
