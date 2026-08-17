// Command palette demo behaviour: opens on a trigger button or Ctrl+Shift+F,
// filters a fixed command list by a pattern the four toggles turn into an
// anchored regular expression, and is fully keyboard-operable (arrow keys
// move the active option, Enter runs it, Escape closes — Escape and focus
// trapping come from the native <dialog>.showModal(), not from custom code).
'use strict';

(function initCommandPalette() {
  var COMMANDS = [
    { id: 'open-mixer-2', label: 'Open mixer line 2 faceplate' },
    { id: 'ack-all', label: 'Acknowledge all annunciator tiles' },
    { id: 'jump-oven-trend', label: 'Jump to oven zone 1 trend' },
    { id: 'toggle-kid', label: 'Toggle Kid mode' },
    { id: 'toggle-scheme', label: 'Toggle dark colour scheme' },
    { id: 'export-audit', label: 'Export audit log as CSV' },
    { id: 'reset-group-a', label: 'Reset annunciator group A' },
    { id: 'open-oven-setpoint', label: 'Open numeric entry: oven zone 1 setpoint' },
    { id: 'show-provenance', label: 'Show provenance for lot 4471' },
    { id: 'open-cooler', label: 'Open spiral cooler faceplate' },
  ];

  /**
   * Builds a RegExp from a raw pattern and the palette's anchor/word/case
   * toggles. Throws if the resulting pattern is not a valid RegExp — the
   * caller is responsible for catching that and showing it as a status
   * message rather than crashing the palette.
   */
  function buildAnchoredRegex(raw, opts) {
    var source = raw;
    if (opts.wholeWord) source = '\\b(?:' + source + ')\\b';
    if (opts.anchorStart) source = '^' + source;
    if (opts.anchorEnd) source = source + '$';
    return new RegExp(source, opts.caseSensitive ? '' : 'i');
  }

  function wire() {
    var dialog = document.getElementById('command-palette');
    var openBtn = document.getElementById('palette-open');
    var input = document.getElementById('palette-input');
    var wholeWord = document.getElementById('palette-whole-word');
    var caseSensitive = document.getElementById('palette-case-sensitive');
    var anchorStart = document.getElementById('palette-anchor-start');
    var anchorEnd = document.getElementById('palette-anchor-end');
    var status = document.getElementById('palette-status');
    var list = document.getElementById('palette-list');
    var closeBtn = document.getElementById('palette-close');
    if (!dialog || !openBtn || !input || !list || !status) return;
    if (typeof dialog.showModal !== 'function') return; // no <dialog> support: leave static markup visible

    var activeIndex = -1;
    var visibleIds = [];

    function optionsState() {
      return {
        wholeWord: wholeWord.checked,
        caseSensitive: caseSensitive.checked,
        anchorStart: anchorStart.checked,
        anchorEnd: anchorEnd.checked,
      };
    }

    function render() {
      var raw = input.value;
      var matches = COMMANDS;
      var errorText = '';

      if (raw.length > 0) {
        try {
          var regex = buildAnchoredRegex(raw, optionsState());
          matches = COMMANDS.filter(function (command) {
            return regex.test(command.label);
          });
        } catch (err) {
          errorText = 'Invalid pattern: ' + err.message;
          matches = [];
        }
      }

      list.innerHTML = '';
      visibleIds = [];

      if (errorText) {
        status.textContent = errorText;
        status.setAttribute('data-error', 'true');
      } else {
        status.textContent = matches.length + (matches.length === 1 ? ' match' : ' matches');
        status.setAttribute('data-error', 'false');
      }

      if (matches.length === 0 && !errorText) {
        var empty = document.createElement('li');
        empty.className = 'cb-command-palette__empty';
        empty.textContent = 'No commands match.';
        list.appendChild(empty);
      }

      matches.forEach(function (command) {
        var item = document.createElement('li');
        item.id = 'palette-option-' + command.id;
        item.className = 'cb-command-palette__option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = command.label;
        item.addEventListener('click', function () {
          runCommand(command);
        });
        list.appendChild(item);
        visibleIds.push(item.id);
      });

      activeIndex = visibleIds.length > 0 ? 0 : -1;
      updateActive();
    }

    function updateActive() {
      visibleIds.forEach(function (id, index) {
        var el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-selected', String(index === activeIndex));
      });
      if (activeIndex >= 0) {
        input.setAttribute('aria-activedescendant', visibleIds[activeIndex]);
        var activeEl = document.getElementById(visibleIds[activeIndex]);
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function runCommand(command) {
      dialog.close();
      status.textContent = 'Ran: ' + command.label;
    }

    function open() {
      input.value = '';
      dialog.showModal();
      render();
      input.focus();
    }

    openBtn.addEventListener('click', open);
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        dialog.close();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey && event.shiftKey && (event.key === 'F' || event.key === 'f')) {
        event.preventDefault();
        open();
      }
    });

    input.addEventListener('input', render);
    [wholeWord, caseSensitive, anchorStart, anchorEnd].forEach(function (toggle) {
      toggle.addEventListener('change', render);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (visibleIds.length > 0) {
          activeIndex = (activeIndex + 1) % visibleIds.length;
          updateActive();
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (visibleIds.length > 0) {
          activeIndex = (activeIndex - 1 + visibleIds.length) % visibleIds.length;
          updateActive();
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0) {
          var id = visibleIds[activeIndex];
          var index = id.replace('palette-option-', '');
          var command = COMMANDS.filter(function (c) {
            return c.id === index;
          })[0];
          if (command) runCommand(command);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
