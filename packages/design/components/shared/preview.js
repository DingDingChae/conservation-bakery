// Shared preview-harness behaviour for packages/design/components/*.html.
//
// This is scaffolding, not part of the design language: it wires the
// scheme <select> and Kid mode <input type="checkbox"> that appear at the
// top of every preview page to the two attributes the token files actually
// read (data-theme, data-mode) on <html>, so a reviewer can flip schemes
// live and see every component reading the same token names resolve to
// different values. Plain script tag, no module system, no bundler.
'use strict';

(function initPreviewToolbar() {
  function wire() {
    var themeSelect = document.querySelector('[data-role="theme-select"]');
    var kidToggle = document.querySelector('[data-role="kid-toggle"]');
    var root = document.documentElement;

    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        if (themeSelect.value === 'system') {
          root.removeAttribute('data-theme');
        } else {
          root.setAttribute('data-theme', themeSelect.value);
        }
      });
    }

    if (kidToggle) {
      kidToggle.addEventListener('change', function () {
        if (kidToggle.checked) {
          root.setAttribute('data-mode', 'kid');
        } else {
          root.removeAttribute('data-mode');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
