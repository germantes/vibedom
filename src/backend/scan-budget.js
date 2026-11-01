// Tope diario de escaneos facturables.
//
// El limitador por IP protege de un visitante abusivo, pero no de muchas IPs
// distintas: con una API de pago eso se traduce en factura. Este presupuesto
// global corta las llamadas a la IA al llegar al límite y deja que el servidor
// responda con la semilla local, que no cuesta nada.
//
// El contador vive en memoria y se reinicia a medianoche UTC. Es suficiente
// para una sola instancia (Render free); si algún día hay varias, habría que
// moverlo a un almacén compartido.
//
// `0` desactiva el tope, igual que en `SCAN_RATE_LIMIT`.
//
// Los límites configurados se recortan a un máximo seguro: si el panel de
// Render conserva un valor antiguo (por ejemplo, 200/día), la app no puede
// disparar la factura sin querer. Para subir el techo hay que declararlo con
// `SCAN_DAILY_LIMIT_MAX` / `SCAN_IP_DAILY_LIMIT_MAX`; así un cambio de panel
// no basta por sí solo.

function envInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

const SAFE_DAILY_MAX = envInt("SCAN_DAILY_LIMIT_MAX") ?? 25;
const SAFE_IP_MAX = envInt("SCAN_IP_DAILY_LIMIT_MAX") ?? 8;

const parsedDaily = envInt("SCAN_DAILY_LIMIT");
const parsedPerIp = envInt("SCAN_IP_DAILY_LIMIT");

function resolveLimit(configured, fallback, max) {
  const value = configured ?? fallback;
  if (value === 0) return 0;
  return Math.min(value, max);
}

const DEFAULT_DAILY_LIMIT = resolveLimit(parsedDaily, 25, SAFE_DAILY_MAX);
const DEFAULT_IP_LIMIT = resolveLimit(parsedPerIp, 8, SAFE_IP_MAX);

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfNextDay(timestamp) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS + DAY_MS;
}

export function createScanBudget({
  dailyLimit = DEFAULT_DAILY_LIMIT,
  ipLimit = DEFAULT_IP_LIMIT,
  now = Date.now,
} = {}) {
  let day = Math.floor(now() / DAY_MS);
  let used = 0;
  const byIp = new Map();

  function rollover() {
    const today = Math.floor(now() / DAY_MS);
    if (today === day) return;
    day = today;
    used = 0;
    byIp.clear();
  }

  const secondsUntilReset = () => Math.max(1, Math.ceil((startOfNextDay(now()) - now()) / 1000));

  return {
    /**
     * Consume una llamada a la IA. Devuelve `{ ok: false, scope }` sin contar
     * nada cuando el tope ya está agotado, para no castigar dos veces.
     */
    take(ip = "unknown") {
      rollover();

      if (dailyLimit && used >= dailyLimit) {
        return { ok: false, scope: "global", retryAfter: secondsUntilReset() };
      }

      const fromIp = byIp.get(ip) ?? 0;
      if (ipLimit && fromIp >= ipLimit) {
        return { ok: false, scope: "ip", retryAfter: secondsUntilReset() };
      }

      used += 1;
      byIp.set(ip, fromIp + 1);
      return {
        ok: true,
        remaining: dailyLimit ? dailyLimit - used : Infinity,
        ipRemaining: ipLimit ? ipLimit - fromIp - 1 : Infinity,
      };
    },

    /** Estado para `/api/health`, sin exponer IPs. */
    snapshot() {
      rollover();
      return { usedToday: used, dailyLimit, perIpDailyLimit: ipLimit };
    },
  };
}
