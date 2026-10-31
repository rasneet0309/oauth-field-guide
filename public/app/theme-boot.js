// Applies the saved theme before first paint and marks JavaScript as available.
// A classic blocking script on purpose (loaded in <head>); the CSP forbids inline scripts.
(function () {
  const root = document.documentElement;
  root.classList.add("js");
  try {
    const saved = JSON.parse(window.localStorage.getItem("ofg3:theme"));
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {
    /* storage blocked: follow the OS */
  }
})();
