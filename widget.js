/* vibedom widget — botón flotante con la semilla incrustada.
   Sin dependencias: el motor y Tone.js se cargan solo al primer clic.
   Uso: <script src="https://vibedom.dev/widget.js" data-seed="<base64>" defer></script> */
(function () {
  "use strict";

  var self = document.currentScript;
  if (!self) return;

  var encoded = self.getAttribute("data-seed");
  if (!encoded) return;

  var seed;
  try {
    var bytes = Uint8Array.from(atob(encoded), function (c) { return c.charCodeAt(0); });
    seed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    return;
  }

  var base = new URL(".", self.src).href;
  var theme = seed.uiTheme || {};
  var hex = function (value, fallback) {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "") ? value : fallback;
  };
  var accent = hex(theme.accentColor, "#8C6A43");
  var bg = hex(theme.backgroundColor, "#111111");
  var fg = hex(theme.textColor, "#FFFFFF");
  if (accent.toLowerCase() === bg.toLowerCase()) accent = fg;

  var en = /^en/i.test(document.documentElement.lang || "");
  var label = self.getAttribute("data-label") || (en ? "Play this website" : "Escuchar esta web");
  var stopLabel = en ? "Pause" : "Pausar";
  var busyLabel = en ? "Loading audio…" : "Cargando audio…";
  var errorLabel = en ? "Couldn't load the audio" : "No se pudo cargar el audio";

  var host = document.createElement("div");
  host.setAttribute("data-vibedom", "");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483000;bottom:0;right:0";
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    "<style>" +
      ":host{all:initial}" +
      "button{position:fixed;right:20px;bottom:20px;display:grid;place-items:center;width:54px;height:54px;padding:0;border:1px solid " + accent + "55;border-radius:50%;background:" + bg + ";color:" + fg + ";cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28);transition:transform .2s ease,box-shadow .2s ease;font:600 12px/1 system-ui,sans-serif}" +
      "button:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,.32)}" +
      "button:focus-visible{outline:3px solid " + accent + ";outline-offset:3px}" +
      "button[data-busy]{cursor:wait}" +
      ".bars{display:flex;align-items:center;gap:3px;height:20px}" +
      ".bars i{display:block;width:3px;height:6px;border-radius:2px;background:" + accent + ";transition:height .2s ease}" +
      "button[aria-pressed=true] .bars i{animation:vibedom-wave 1s ease-in-out infinite}" +
      "button[aria-pressed=true] .bars i:nth-child(2){animation-delay:.15s}" +
      "button[aria-pressed=true] .bars i:nth-child(3){animation-delay:.3s}" +
      "button[aria-pressed=true] .bars i:nth-child(4){animation-delay:.45s}" +
      "@keyframes vibedom-wave{0%,100%{height:5px}50%{height:18px}}" +
      "@media(prefers-reduced-motion:reduce){button,.bars i{transition:none;animation:none!important}button[aria-pressed=true] .bars i{height:12px}}" +
      ".ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid transparent;border-top-color:" + accent + ";opacity:0;animation:vibedom-spin .8s linear infinite}" +
      "button[data-busy] .ring{opacity:1}" +
      "button[data-busy] .bars{opacity:.25}" +
      "@keyframes vibedom-spin{to{transform:rotate(360deg)}}" +
    "</style>" +
    '<button type="button" aria-pressed="false">' +
      '<span class="ring" aria-hidden="true"></span>' +
      '<span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
    "</button>";

  var button = root.querySelector("button");
  var player = null;
  var loading = null;

  function render(playing, busy, message) {
    button.setAttribute("aria-pressed", String(playing));
    button.toggleAttribute("data-busy", Boolean(busy));
    var text = message || (busy ? busyLabel : playing ? stopLabel : label);
    button.setAttribute("aria-label", text);
    button.title = text;
  }

  render(false, false);

  async function toggle() {
    if (loading) return;

    if (player) {
      if (player.isPlaying) {
        await player.stop();
        render(false, false);
      } else {
        await player.start();
        render(true, false);
      }
      return;
    }

    loading = (async function () {
      render(false, true);
      var mod = await import(base + "widget-player.js");
      player = await mod.createPlayer(seed);
      render(true, false);
    })();

    try {
      await loading;
    } catch (err) {
      player = null;
      render(false, false, errorLabel);
      console.error("[vibedom]", err);
    } finally {
      loading = null;
    }
  }

  button.addEventListener("click", toggle);

  if (document.body) document.body.appendChild(host);
  else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(host); }, { once: true });
})();
