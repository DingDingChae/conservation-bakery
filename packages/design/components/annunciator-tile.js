// Interactive annunciator-tile demo behaviour.
//
// Models the real ISA-style annunciator sequence: normal -> active,
// unacknowledged (flashing) -> active, acknowledged (steady) -> cleared
// (steady, different colour, still lit) -> normal (only once reset is
// pressed). Every transition updates the tile's icon and text label AND
// writes a sentence into a shared aria-live region, so the same transition
// is available to a screen reader as it is to a sighted operator watching
// the tile change.
'use strict';

(function initAnnunciatorDemo() {
  var STATE_CONTENT = {
    normal: { icon: '○', label: 'Mixer overload', state: 'Normal' },
    'active-unacknowledged': { icon: '▲', label: 'Mixer overload', state: 'Active — unacknowledged' },
    'active-acknowledged': { icon: '■', label: 'Mixer overload', state: 'Active — acknowledged' },
    cleared: { icon: '◆', label: 'Mixer overload', state: 'Cleared — press reset' },
  };

  var ANNOUNCE = {
    normal: 'Mixer overload alarm: normal.',
    'active-unacknowledged': 'Mixer overload alarm: active, unacknowledged.',
    'active-acknowledged': 'Mixer overload alarm: active, acknowledged.',
    cleared: 'Mixer overload alarm: condition cleared, press reset.',
  };

  function wire() {
    var tile = document.getElementById('demo-tile');
    var live = document.getElementById('demo-live');
    var simulateBtn = document.getElementById('demo-simulate');
    var ackBtn = document.getElementById('demo-ack');
    var clearBtn = document.getElementById('demo-clear');
    var resetBtn = document.getElementById('demo-reset');
    if (!tile || !live || !simulateBtn || !ackBtn || !clearBtn || !resetBtn) return;

    function setState(next) {
      tile.setAttribute('data-state', next);
      var content = STATE_CONTENT[next];
      tile.querySelector('.cb-annunciator-tile__icon').textContent = content.icon;
      tile.querySelector('.cb-annunciator-tile__state').textContent = content.state;
      tile.setAttribute('aria-label', content.label + ': ' + content.state.toLowerCase());
      live.textContent = ANNOUNCE[next];

      simulateBtn.disabled = next !== 'normal';
      ackBtn.disabled = next !== 'active-unacknowledged';
      clearBtn.disabled = next !== 'active-acknowledged';
      resetBtn.disabled = next !== 'cleared';
    }

    simulateBtn.addEventListener('click', function () {
      setState('active-unacknowledged');
    });
    ackBtn.addEventListener('click', function () {
      setState('active-acknowledged');
    });
    clearBtn.addEventListener('click', function () {
      setState('cleared');
    });
    resetBtn.addEventListener('click', function () {
      setState('normal');
    });

    setState('normal');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
