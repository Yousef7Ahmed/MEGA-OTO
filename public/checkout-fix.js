(function() {
  var LOG = '[checkout-fix]';
  console.log(LOG, 'script loaded on', window.location.pathname);

  function applyPrice(radio) {
    var price = parseFloat(radio.value) || 0;
    var form  = document.getElementById('formdata');
    if (!form) { console.warn(LOG, '#formdata not found'); return; }

    var old = form.querySelector('input[name="delivery_price"]');
    if (old) old.remove();

    var h = document.createElement('input');
    h.type  = 'hidden';
    h.name  = 'delivery_price';
    h.value = price;
    form.appendChild(h);

    var label = document.querySelector('label[for="' + radio.id + '"]');
    console.log(LOG, 'delivery_price set to', price,
      '(' + (label ? label.textContent.trim() : radio.id) + ')');
  }

  function attachListeners() {
    var radios = document.querySelectorAll('input.shipping_mode[name="shipping_id"]');
    var attached = 0;
    radios.forEach(function(r) {
      if (r.dataset.cfAttached) return;
      r.dataset.cfAttached = '1';
      r.addEventListener('change', function() { applyPrice(this); });
      attached++;
    });
    if (attached) {
      console.log(LOG, 'attached to', attached, 'new radio(s),', radios.length, 'total');
    }

    var checked = document.querySelector('input.shipping_mode[name="shipping_id"]:checked');
    if (checked && !checked.dataset.cfApplied) {
      checked.dataset.cfApplied = '1';
      applyPrice(checked);
    }
  }

  new MutationObserver(attachListeners)
    .observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachListeners);
  } else {
    attachListeners();
  }

  document.addEventListener('submit', function(e) {
    if (e.target && e.target.id === 'formdata') {
      var dp = e.target.querySelector('input[name="delivery_price"]');
      console.log(LOG, 'FORM SUBMIT — delivery_price =',
        dp ? dp.value : '(field missing!)');
    }
  }, true);

  console.log(LOG, 'ready');
})();
