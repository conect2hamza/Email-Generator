/*
 * Small LocalStorage wrapper. Every access is guarded because storage can be
 * unavailable (private mode, blocked site data) or full.
 */
(function (ROG) {
  'use strict';

  var PREFIX = 'rog.v1.';

  function get(key, fallback) {
    try {
      var raw = window.localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch (e) { /* ignore */ }
  }

  /**
   * Store a value under `group.sig`, keeping only the most recent `cap`
   * entries of that group so per-file data cannot grow without bound.
   */
  function setKeyed(group, sig, value, cap) {
    var indexKey = group + '._index';
    var index = get(indexKey, []);
    if (!Array.isArray(index)) index = [];
    index = [sig].concat(index.filter(function (s) { return s !== sig; }));
    while (index.length > (cap || 20)) remove(group + '.' + index.pop());
    set(indexKey, index);
    return set(group + '.' + sig, value);
  }

  function getKeyed(group, sig, fallback) {
    return get(group + '.' + sig, fallback);
  }

  /** Remove every key written by this application. */
  function clearAll() {
    try {
      var keys = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { window.localStorage.removeItem(k); });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Fast, non-cryptographic string hash (FNV-1a) used for storage keys. */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  ROG.storage = {
    get: get,
    set: set,
    remove: remove,
    setKeyed: setKeyed,
    getKeyed: getKeyed,
    clearAll: clearAll,
    hash: hash
  };
})((window.ROG = window.ROG || {}));
