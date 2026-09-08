(function () {
  function attach(item) {
    var root = item.typesetRoot;
    if (!root || !root.parentNode || !window.dgCopy) return;
    var display = item.display;
    var wrap = document.createElement(display ? 'div' : 'span');
    wrap.className = display ? 'dg-math-block' : 'dg-math-inline';
    root.parentNode.insertBefore(wrap, root);
    wrap.appendChild(root);
    var tex = display ? '$$' + item.math + '$$' : '$' + item.math + '$';
    wrap.appendChild(window.dgCopy.button(tex, '数式の LaTeX をコピー'));
  }

  window.MathJax = {
    tex: {
      inlineMath: [['$', '$']],
      displayMath: [['$$', '$$']],
      processEscapes: true
    },
    svg: { fontCache: 'global' },
    options: {
      ignoreHtmlClass: 'dg-copy|dg-mermaid|hljs',
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    },
    startup: {
      pageReady: function () {
        return MathJax.startup.defaultPageReady().then(function () {
          for (var item of MathJax.startup.document.math) { attach(item); }
        });
      }
    }
  };
})();
