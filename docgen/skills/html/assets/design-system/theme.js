(function () {
  var KEY = 'dg-theme';
  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function current() {
    return root.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light');
  }

  var s = stored();
  if (s === 'dark' || s === 'light') root.setAttribute('data-theme', s);

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.3 8.3 0 0 1 9.5 4a8.4 8.4 0 1 0 10.5 10.5z"/></svg>';

  function build() {
    if (document.querySelector('.dg-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-theme-toggle';

    function paint() {
      var dark = current() === 'dark';
      btn.innerHTML = dark ? SUN : MOON;
      var label = dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }

    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      save(next);
      paint();
      document.dispatchEvent(new CustomEvent('dg:themechange', { detail: { theme: next } }));
    });

    paint();
    document.body.appendChild(btn);

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (!stored()) {
          paint();
          document.dispatchEvent(new CustomEvent('dg:themechange', { detail: { theme: current() } }));
        }
      };
      mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
