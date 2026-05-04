(() => {
  if (window.__igMediaControlsBackgroundPlaybackInstalled) return;
  window.__igMediaControlsBackgroundPlaybackInstalled = true;

  const blockedDocumentEvents = new Set([
    "visibilitychange",
    "webkitvisibilitychange"
  ]);

  const blockedWindowEvents = new Set([
    "blur",
    "pagehide"
  ]);

  function defineConstantGetter(target, property, value) {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        get() {
          return value;
        }
      });
    } catch (_) {
      // Ignore safely if the browser does not allow overriding this field.
    }
  }

  function blockEventHandlerProperty(target, property) {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        get() {
          return null;
        },
        set() {
          // Ignore page handlers that would pause media when the tab is hidden.
        }
      });
    } catch (_) {
      // Ignore safely.
    }
  }

  defineConstantGetter(Document.prototype, "hidden", false);
  defineConstantGetter(Document.prototype, "webkitHidden", false);
  defineConstantGetter(Document.prototype, "visibilityState", "visible");
  defineConstantGetter(Document.prototype, "webkitVisibilityState", "visible");

  blockEventHandlerProperty(document, "onvisibilitychange");
  blockEventHandlerProperty(document, "onwebkitvisibilitychange");
  blockEventHandlerProperty(window, "onblur");
  blockEventHandlerProperty(window, "onpagehide");

  const originalAddEventListener = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
    const eventType = String(type || "");

    if (this === document && blockedDocumentEvents.has(eventType)) {
      return originalAddEventListener.call(this, eventType, function ignoredVisibilityListener() {}, options);
    }

    if (this === window && blockedWindowEvents.has(eventType)) {
      return originalAddEventListener.call(this, eventType, function ignoredBackgroundListener() {}, options);
    }

    return originalAddEventListener.call(this, type, listener, options);
  };
})();
