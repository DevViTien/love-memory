/*
 * LoveGift bootstrap of an `html` template (`template-viewer-runtime`). The importer copies this
 * file into every html artifact as `love-gift.js`, the first script of its document, with the
 * version's field mapping in place of the marker below. A stored copy is never edited.
 *
 * In the gift page it waits for the host's `INIT`, merges the gift's values into a copy of the
 * `gift-config` defaults by path, exposes `window.LoveGift` and answers `READY`. The template's
 * deferred scripts run in order on the first `PLAY` (the recipient's `Mở quà`); later `PAUSE` and
 * `PLAY` become the window events `lovegift:pause` and `lovegift:play`. Opened directly (not in a
 * frame) it starts at once with the defaults. It never uses the network or storage.
 */
(function () {
  "use strict";

  /** @type {ReadonlyArray<{ id: string; path: string; type: string }>} */
  var FIELDS = /* love-gift:fields */ [];
  var PROTOCOL_VERSION = 1;
  var DEFERRED_SCRIPT_SELECTOR = 'script[type="application/x-love-gift-script"]';

  var parentWindow = window.parent;
  var framed = parentWindow !== window;
  /** `waiting` → `ready` (configured) → `starting` → `started`, or `failed`. */
  var state = "waiting";
  var config = null;
  var reducedMotion = false;
  var pendingInit = null;
  var playRequested = false;
  /** The last `PAUSE` or `PLAY` received while the scripts load; dispatched once they started. */
  var pendingCommand = null;
  /**
   * Photos requested at `INIT`, kept alive so that the template's later `img.src` (after `PLAY`)
   * hits the image cache even when the short-lived signed URLs have expired meanwhile.
   */
  var preloadedImages = [];

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  function post(message) {
    if (framed) parentWindow.postMessage(message, "*");
  }

  function fail() {
    if (state === "failed") return;
    state = "failed";
    post({ code: "RUNTIME_ERROR", type: "ERROR" });
  }

  function readDefaults() {
    var element = document.getElementById("gift-config");
    var parsed = JSON.parse(element ? element.textContent : "{}");
    return isRecord(parsed) ? parsed : {};
  }

  function text(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  }

  function assetUrl(assets, assetId) {
    return typeof assetId === "string" &&
      hasOwn(assets, assetId) &&
      typeof assets[assetId] === "string"
      ? assets[assetId]
      : undefined;
  }

  function nonEmpty(list) {
    return list.length > 0 ? list : undefined;
  }

  function defined(value) {
    return value !== undefined;
  }

  /** The configuration value of one field, or `undefined` to keep the template default. */
  function fieldValue(field, value, assets) {
    switch (field.type) {
      case "textList":
        return Array.isArray(value) ? nonEmpty(value.map(text).filter(defined)) : undefined;
      case "image":
        return assetUrl(assets, value);
      case "imageList":
        return Array.isArray(value)
          ? nonEmpty(
              value
                .map(function (assetId) {
                  return assetUrl(assets, assetId);
                })
                .filter(defined),
            )
          : undefined;
      case "captionedImageList":
        if (!Array.isArray(value)) return undefined;
        var items = [];
        value.forEach(function (item) {
          var src = isRecord(item) ? assetUrl(assets, item.assetId) : undefined;
          if (src !== undefined) items.push({ caption: text(item.caption) || "", src: src });
        });
        return nonEmpty(items);
      default:
        return text(value);
    }
  }

  function setPath(target, path, value) {
    var segments = path.split(".");
    var node = target;
    for (var index = 0; index < segments.length - 1; index += 1) {
      var key = segments[index];
      if (!hasOwn(node, key) || !isRecord(node[key])) node[key] = {};
      node = node[key];
    }
    node[segments[segments.length - 1]] = value;
  }

  /** A copy of the defaults with every field that has a value set at its path. */
  function mergeConfig(defaults, payload, assets) {
    var merged = JSON.parse(JSON.stringify(defaults));
    FIELDS.forEach(function (field) {
      var value = hasOwn(payload, field.id)
        ? fieldValue(field, payload[field.id], assets)
        : undefined;
      if (value !== undefined) setPath(merged, field.path, value);
    });
    return merged;
  }

  /** Whether `DOMContentLoaded` or the window `load` has already been dispatched. */
  function alreadyDispatched(target, type) {
    if (type === "DOMContentLoaded") return document.readyState !== "loading";
    return type === "load" && target === window && document.readyState === "complete";
  }

  /**
   * Template scripts run once the document is parsed. Listeners they add for a `DOMContentLoaded`
   * or `load` that has already happened are called on the next task instead of never.
   */
  function deferLateLoadListeners() {
    var targets = [window, document];
    targets.forEach(function (target) {
      var original = target.addEventListener;
      target.addEventListener = function (type, listener, options) {
        if (alreadyDispatched(target, type)) {
          setTimeout(function () {
            var event = new Event(type);
            if (typeof listener === "function") listener.call(target, event);
            else if (listener && typeof listener.handleEvent === "function") {
              listener.handleEvent(event);
            }
          }, 0);
          return;
        }
        return original.call(target, type, listener, options);
      };
    });
    return function restore() {
      targets.forEach(function (target) {
        delete target.addEventListener;
      });
    };
  }

  function runScripts(done) {
    var placeholders = Array.prototype.slice.call(
      document.querySelectorAll(DEFERRED_SCRIPT_SELECTOR),
    );
    var index = 0;
    function next() {
      if (state !== "starting") return;
      if (index >= placeholders.length) {
        done();
        return;
      }
      var placeholder = placeholders[index];
      index += 1;
      var script = document.createElement("script");
      script.async = false;
      script.onload = next;
      script.onerror = fail;
      script.src = placeholder.getAttribute("data-src");
      placeholder.parentNode.insertBefore(script, placeholder.nextSibling);
    }
    next();
  }

  var IMAGE_FIELD_TYPES = ["image", "imageList", "captionedImageList"];

  function readPath(target, path) {
    var node = target;
    var segments = path.split(".");
    for (var index = 0; index < segments.length; index += 1) {
      if (!isRecord(node) || !hasOwn(node, segments[index])) return undefined;
      node = node[segments[index]];
    }
    return node;
  }

  /** Starts loading every photo of the merged configuration now, while its URL is valid. */
  function preloadImages(merged) {
    FIELDS.forEach(function (field) {
      if (IMAGE_FIELD_TYPES.indexOf(field.type) === -1) return;
      var value = readPath(merged, field.path);
      var urls = Array.isArray(value) ? value : [value];
      urls.forEach(function (entry) {
        var url = isRecord(entry) ? entry.src : entry;
        if (typeof url !== "string" || url === "") return;
        var image = new Image();
        image.src = url;
        preloadedImages.push(image);
      });
    });
  }

  function setReducedMotion(value) {
    reducedMotion = value === true;
    if (reducedMotion) document.documentElement.setAttribute("data-reduced-motion", "true");
    else document.documentElement.removeAttribute("data-reduced-motion");
  }

  /** Merges the configuration; `false` when the defaults cannot be read. */
  function configure(payload, assets, prefersReducedMotion) {
    try {
      config = mergeConfig(readDefaults(), payload, assets);
    } catch {
      fail();
      return false;
    }
    preloadImages(config);
    setReducedMotion(prefersReducedMotion);
    state = "ready";
    return true;
  }

  /** Runs the template's scripts in order; an error while they start is a `RUNTIME_ERROR`. */
  function runTemplate() {
    if (state !== "ready") return;
    state = "starting";
    var onloadBefore = window.onload;
    var restoreListeners = deferLateLoadListeners();
    window.addEventListener("error", fail);
    runScripts(function () {
      restoreListeners();
      var onload = window.onload;
      if (
        typeof onload === "function" &&
        onload !== onloadBefore &&
        alreadyDispatched(window, "load")
      ) {
        setTimeout(function () {
          onload.call(window, new Event("load"));
        }, 0);
      }
      // After the deferred listeners above, so an error they throw is still a start failure.
      setTimeout(function () {
        window.removeEventListener("error", fail);
        if (state !== "starting") return;
        state = "started";
        var command = pendingCommand;
        pendingCommand = null;
        if (command) window.dispatchEvent(new Event("lovegift:" + command));
      }, 0);
    });
  }

  function isValidInit(message) {
    if (message.protocolVersion !== PROTOCOL_VERSION || !isRecord(message.payload)) return false;
    var context = message.context;
    if (!isRecord(context) || typeof context.locale !== "string") return false;
    if (typeof context.prefersReducedMotion !== "boolean") return false;
    var assets = message.assets === undefined ? {} : message.assets;
    if (!isRecord(assets)) return false;
    return Object.keys(assets).every(function (key) {
      return typeof assets[key] === "string";
    });
  }

  function initialize(message) {
    var assets = message.assets || {};
    if (!configure(message.payload, assets, message.context.prefersReducedMotion)) return;
    post({ protocolVersion: PROTOCOL_VERSION, type: "READY" });
    if (playRequested) runTemplate();
  }

  /** The first `PLAY` starts the template; later ones and `PAUSE` become window events. */
  function command(type) {
    if (type === "PLAY" && state === "waiting") playRequested = true;
    else if (type === "PLAY" && state === "ready") runTemplate();
    else if (state === "starting") pendingCommand = type.toLowerCase();
    else if (state === "started") window.dispatchEvent(new Event("lovegift:" + type.toLowerCase()));
  }

  window.addEventListener("message", function (event) {
    if (!framed || event.source !== parentWindow) return;
    var message = event.data;
    if (!isRecord(message)) return;
    if (message.type === "PLAY" || message.type === "PAUSE") {
      command(message.type);
      return;
    }
    // `DESTROY` needs nothing: the host removes the frame.
    if (message.type !== "INIT") return;
    if (!isValidInit(message)) {
      post({ code: "INVALID_MESSAGE", type: "ERROR" });
      return;
    }
    if (state === "waiting") {
      // An `INIT` that arrives while the document is still parsing waits for the parsed document.
      if (document.readyState === "loading") pendingInit = message;
      else initialize(message);
    } else if (state !== "failed") {
      // The handshake repeats `INIT` until `READY` arrives; the first one configured the gift.
      post({ protocolVersion: PROTOCOL_VERSION, type: "READY" });
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    var message = pendingInit;
    pendingInit = null;
    if (message && state === "waiting") initialize(message);
  });

  /** Opened directly, outside the gift page: the author's preview, with the defaults. */
  function startTopLevel() {
    if (state !== "waiting") return;
    var prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (configure({}, {}, prefersReduced)) runTemplate();
  }

  var api = {
    /** Tells the host that the gift reached its end. */
    complete: function () {
      post({ type: "COMPLETE" });
    },
    /** The defaults merged with the gift's values, from `READY` on. */
    config: function () {
      if (config === null) throw new Error("LoveGift.config() is available once the gift starts.");
      return config;
    },
    /** Whether the recipient asked for reduced motion (the host's `INIT` context). */
    reducedMotion: function () {
      return reducedMotion;
    },
    /** Tells the host that the gift reached a named scene (1 to 80 characters). */
    scene: function (sceneId) {
      if (typeof sceneId === "string" && sceneId.length >= 1 && sceneId.length <= 80) {
        post({ sceneId: sceneId, type: "SCENE" });
      }
    },
  };
  Object.defineProperty(window, "LoveGift", { enumerable: true, value: Object.freeze(api) });

  // Framed, the host's `INIT` and `PLAY` drive the gift; only a top-level open starts by itself.
  if (!framed) {
    if (document.readyState === "complete") startTopLevel();
    else window.addEventListener("load", startTopLevel);
  }
})();
