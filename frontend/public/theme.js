// Setzt die Darstellung (hell oder dunkel), bevor die Seite gezeichnet wird – sonst blitzt
// beim Laden kurz die helle Ansicht auf. Die Auswahl selbst verwaltet src/theme.ts.
(function () {
  var choice = null;
  try {
    choice = window.localStorage.getItem("werkbank-darstellung");
  } catch {
    // Speicher gesperrt: Einstellung des Geräts verwenden
  }
  var dark =
    choice === "dunkel" ||
    (choice !== "hell" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dunkel" : "hell";
})();
