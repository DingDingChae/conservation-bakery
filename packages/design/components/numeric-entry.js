// Numeric-entry range validation demo.
//
// Mirrors a real setpoint field's guard: a value outside [min, max] is
// flagged with a visible error AND aria-invalid, and the error text is a
// role="alert" region so a screen reader hears it the moment it appears.
'use strict';

(function initNumericEntryDemo() {
  function wire() {
    var wrapper = document.getElementById('numeric-entry-demo');
    var input = document.getElementById('numeric-entry-input');
    var error = document.getElementById('numeric-entry-error');
    if (!wrapper || !input || !error) return;

    var min = parseFloat(input.min);
    var max = parseFloat(input.max);

    function validate() {
      var value = parseFloat(input.value);
      var invalid = Number.isNaN(value) || value < min || value > max;
      wrapper.setAttribute('data-invalid', String(invalid));
      input.setAttribute('aria-invalid', String(invalid));
      error.textContent = invalid
        ? 'Value must be between ' + min.toFixed(1) + ' and ' + max.toFixed(1) + ' °C.'
        : '';
    }

    input.addEventListener('input', validate);
    validate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
