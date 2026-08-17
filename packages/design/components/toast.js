// Toast / status line demo behaviour.
//
// The status region stays in the DOM at all times (see toast.html) — only
// its data-visible attribute and text content change — because inserting
// and removing a live region is inconsistently announced across screen
// readers, while updating one already present is reliable.
'use strict';

(function initToastDemo() {
  var AUTO_DISMISS_MS = 6000;

  function wire() {
    var showBtn = document.getElementById('toast-show');
    var toast = document.getElementById('demo-toast');
    var message = document.getElementById('demo-toast-message');
    var dismissBtn = document.getElementById('demo-toast-dismiss');
    if (!showBtn || !toast || !message || !dismissBtn) return;

    var timer = null;

    function hide() {
      toast.setAttribute('data-visible', 'false');
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function show() {
      message.textContent = 'Batch 4471 packaging complete — 240 units to pallet.';
      toast.setAttribute('data-visible', 'true');
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(hide, AUTO_DISMISS_MS);
    }

    showBtn.addEventListener('click', show);
    dismissBtn.addEventListener('click', hide);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
