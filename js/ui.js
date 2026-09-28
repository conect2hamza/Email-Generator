/*
 * DOM helpers. All user and CSV content is inserted as text, never as HTML.
 */
(function (ROG) {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  /** Create an element: el('button', { class: 'btn', type: 'button' }, 'Label', child, ...) */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var v = attrs[key];
        if (v == null || v === false) return;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(key.slice(2), v);
        else node.setAttribute(key, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function announce(message) {
    var region = $('liveRegion');
    if (!region) return;
    region.textContent = '';
    setTimeout(function () { region.textContent = message; }, 30);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'offscreen';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  /** Temporarily swap a button's label (e.g. "Copied!") without changing its width. */
  function flashButton(button, label, className) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.style.minWidth = button.offsetWidth + 'px';
    button.textContent = label;
    button.classList.add(className || 'is-flashed');
    clearTimeout(button._flashTimer);
    button._flashTimer = setTimeout(function () {
      button.textContent = button.dataset.label;
      button.classList.remove(className || 'is-flashed');
      button.style.minWidth = '';
    }, 1400);
  }

  /** Insert text at the cursor of an input/textarea, keeping undo history where supported. */
  function insertAtCursor(field, text) {
    field.focus();
    var inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (e) {
      inserted = false;
    }
    if (!inserted) {
      var start = field.selectionStart == null ? field.value.length : field.selectionStart;
      var end = field.selectionEnd == null ? start : field.selectionEnd;
      field.setRangeText(text, start, end, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Ask for a name in the shared name dialog.
   * validate(name) returns an error message or '' when valid.
   * Resolves to the trimmed name, or null when cancelled.
   */
  function askName(title, initial, submitLabel, validate) {
    var dialog = $('nameDialog');
    var form = $('nameForm');
    var input = $('nameInput');
    var error = $('nameError');
    $('nameDialogTitle').textContent = title;
    $('nameSubmit').textContent = submitLabel || 'Save';
    input.value = initial || '';
    error.textContent = '';
    error.hidden = true;

    return new Promise(function (resolve) {
      function onSubmit(event) {
        var submitter = event.submitter;
        if (submitter && submitter.value === 'cancel') return;
        var name = input.value.trim();
        var message = !name ? 'Please enter a name.' : validate ? validate(name) : '';
        if (message) {
          event.preventDefault();
          error.textContent = message;
          error.hidden = false;
          input.focus();
        }
      }
      function onClose() {
        form.removeEventListener('submit', onSubmit);
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      }
      form.addEventListener('submit', onSubmit);
      dialog.addEventListener('close', onClose);
      dialog.returnValue = '';
      dialog.showModal();
      input.select();
    });
  }

  ROG.ui = {
    $: $,
    el: el,
    clear: clear,
    announce: announce,
    copyText: copyText,
    flashButton: flashButton,
    insertAtCursor: insertAtCursor,
    askName: askName
  };
})((window.ROG = window.ROG || {}));
