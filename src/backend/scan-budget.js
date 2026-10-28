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

const parsedDaily = Number(process.env.SCAN_DAILY_LIMIT);
const parsedPerIp = Number(process.env.SCAN_IP_DAILY_LIMIT);
const DEFAULT_DAILY_LIMIT = Number.isFinite(parsedDaily) ? Math.max(0, Math.floor(parsedDaily)) : 200;
const DEFAULT_IP_LIMIT = Number.isFinite(parsedPerIp) ? Math.max(0, Math.floor(parsedPerIp)) : 30;

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
