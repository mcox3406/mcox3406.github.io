(function () {
  var root = document.documentElement;

  // Dark mode toggle. Follows the OS until the visitor picks; then remembers the pick.
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
    btn.addEventListener('click', function () {
      var dark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  });

  // Copy button on fenced code blocks.
  if (navigator.clipboard) {
    Array.prototype.forEach.call(document.querySelectorAll('div.highlighter-rouge'), function (block) {
      var pre = block.querySelector('pre'); if (!pre) return;
      var btn = document.createElement('button');
      btn.className = 'copy'; btn.type = 'button'; btn.textContent = 'copy'; btn.setAttribute('aria-label', 'Copy code');
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.innerText).then(function () {
          btn.textContent = 'copied'; setTimeout(function () { btn.textContent = 'copy'; }, 1400);
        });
      });
      block.appendChild(btn);
    });
  }
})();
