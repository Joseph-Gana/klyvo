(function () {
  try {
    var stored = localStorage.getItem('klyvo-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    var root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  } catch (e) {}
})();
