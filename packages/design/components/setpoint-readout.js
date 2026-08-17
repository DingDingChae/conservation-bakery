// Interactive setpoint-vs-process-value readout demo.
//
// Steps through a fixed, deterministic sequence of process values (no
// randomness — this package has no seeded RNG of its own, and a preview
// should behave identically on every run) to show the status text and
// marker position updating together.
'use strict';

(function initSpvDemo() {
  var SETPOINT = 176.0;
  var TOLERANCE = 2.0;
  // A fixed walk from cold start, through the tolerance band, to a high
  // deviation — deterministic, same every time the demo is opened.
  var SEQUENCE = [150.0, 168.5, 174.4, 176.0, 175.3, 177.8, 181.2];

  function statusFor(pv) {
    var delta = pv - SETPOINT;
    if (Math.abs(delta) <= TOLERANCE) return 'Within tolerance';
    return delta > 0 ? 'Deviation high' : 'Deviation low';
  }

  function wire() {
    var pvValue = document.getElementById('spv-pv-value');
    var status = document.getElementById('spv-status');
    var marker = document.getElementById('spv-marker');
    var nudgeBtn = document.getElementById('spv-nudge');
    if (!pvValue || !status || !marker || !nudgeBtn) return;

    var index = 0;
    var minPv = 140;
    var maxPv = 220;

    function render() {
      var pv = SEQUENCE[index];
      pvValue.textContent = pv.toFixed(1);
      status.textContent = statusFor(pv);
      var pct = ((pv - minPv) / (maxPv - minPv)) * 100;
      marker.style.left = Math.max(0, Math.min(100, pct)) + '%';
    }

    nudgeBtn.addEventListener('click', function () {
      index = (index + 1) % SEQUENCE.length;
      render();
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
