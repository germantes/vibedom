// Puente DOM → motor: velocidad de scroll (suavizada, con caída) y hover sobre elementos interactivos.

const INTERACTIVE = "a, button, [role='button'], input, select, textarea, summary";
const PX_PER_SEC_FULL = 3000; // velocidad de scroll que equivale a intensidad 1
const ATTACK = 0.35; // cuánto sigue la intensidad a un pico de velocidad por frame
const DECAY_PER_SEC = 1.6; // caída hacia 0 cuando se deja de hacer scroll

export function attachReactivity(engine, { win = window, doc = document } = {}) {
  let lastY = win.scrollY;
  let lastT = performance.now();
  let intensity = 0;
  let target = 0;
  let sentIntensity = -1;
  let frame = 0;

  const onScroll = () => {
    const now = performance.now();
    const dt = Math.max(1, now - lastT) / 1000;
    const velocity = Math.abs(win.scrollY - lastY) / dt;
    target = Math.max(target, Math.min(1, velocity / PX_PER_SEC_FULL));
    lastY = win.scrollY;
    lastT = now;
    if (!frame) frame = win.requestAnimationFrame(tick);
  };

  let lastTick = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    intensity += (target - intensity) * ATTACK;
    target = Math.max(0, target - DECAY_PER_SEC * dt);
    if (Math.abs(intensity - sentIntensity) > 0.01) {
      engine.setScrollIntensity(intensity);
      sentIntensity = intensity;
    }
    if (intensity > 0.001 || target > 0) {
      frame = win.requestAnimationFrame(tick);
    } else {
      frame = 0;
      engine.setScrollIntensity(0);
      sentIntensity = 0;
    }
  };

  const onPointerOver = (event) => {
    const el = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
    if (el && !el.contains(event.relatedTarget)) engine.hoverNote();
  };

  win.addEventListener("scroll", onScroll, { passive: true });
  doc.addEventListener("pointerover", onPointerOver, { passive: true });

  return function detach() {
    win.removeEventListener("scroll", onScroll);
    doc.removeEventListener("pointerover", onPointerOver);
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
  };
}
