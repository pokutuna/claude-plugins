window.dgCopy = (function () {
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function write(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallback(text); });
    }
    fallback(text);
    return Promise.resolve();
  }

  function button(text, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dg-copy';
    btn.textContent = 'copy';
    btn.setAttribute('aria-label', label || 'コピー');
    btn.addEventListener('click', function () {
      write(text).then(function () {
        btn.textContent = 'copied';
        setTimeout(function () { btn.textContent = 'copy'; }, 1200);
      });
    });
    return btn;
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('pre:not(.dg-mermaid)').forEach(function (pre) {
      var host = document.createElement('div');
      host.className = 'dg-code';
      pre.parentNode.insertBefore(host, pre);
      host.appendChild(pre);
      host.appendChild(button(pre.textContent.replace(/\n$/, ''), 'コードをコピー'));
    });
  });

  return { write: write, button: button };
})();
