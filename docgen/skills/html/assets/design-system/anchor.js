document.addEventListener('DOMContentLoaded', function () {
  var used = {};
  document.querySelectorAll('[id]').forEach(function (el) { used[el.id] = true; });

  function slug(text) {
    var s = text.trim().toLowerCase()
      .replace(/[\s　]+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '')
      .replace(/^-+|-+$/g, '');
    return s || 'section';
  }

  document.querySelectorAll('main h2, main h3').forEach(function (h) {
    if (!h.id) {
      var base = slug(h.textContent), id = base, n = 2;
      while (used[id]) id = base + '-' + n++;
      h.id = id;
      used[id] = true;
    }
    var a = document.createElement('a');
    a.className = 'dg-anchor';
    a.href = '#' + h.id;
    a.textContent = '#';
    a.setAttribute('aria-label', 'この見出しへのリンク');
    h.appendChild(a);
  });
});
