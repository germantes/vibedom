// Defensa básica anti-SSRF para el escáner público.
//
// Bloquea URLs que apuntan a la propia máquina, a la red local o a rangos
// reservados. Se valida cada salto de redirección y cada hoja de estilos que
// se descarga. En desarrollo se puede desactivar con VIBEDOM_ALLOW_PRIVATE=1.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_LOOKUP_TIMEOUT_MS = 2500;
const DNS_TTL_MS = 5 * 60_000;
const DNS_CACHE_MAX = 200;

const dnsCache = new Map(); // host → { addresses, expires }

const BLOCKED_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "home.arpa",
  "test",
  "invalid",
];

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4IsPrivate(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // privada
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (metadatos cloud)
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // reservada / TEST-NET-1
    (a === 192 && b === 168) || // privada
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast y reservado
  );
}

function ipv6IsPrivate(ip) {
  const v = ip.toLowerCase().split("%")[0];
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) {
    const mapped = v.slice("::ffff:".length);
    return isIP(mapped) === 4 ? ipv4IsPrivate(mapped) : true;
  }
  if (v.startsWith("64:ff9b:")) return true; // NAT64: el destino real es incierto
  if (v.startsWith("100:")) return true; // discard-only
  if (v.startsWith("2001:db8:")) return true; // documentación
  if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
  if (/^fec/.test(v)) return true; // site-local obsoleto
  if (/^ff/.test(v)) return true; // multicast
  return false;
}

/** true si la IP (v4 o v6) pertenece a un rango no público. */
export function isPrivateIp(ip) {
  const version = isIP(ip.split("%")[0]);
  if (version === 4) return ipv4IsPrivate(ip);
  if (version === 6) return ipv6IsPrivate(ip);
  return true;
}

/** true si el hostname es local por convención (localhost, .local, .internal…). */
export function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return BLOCKED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UnsafeUrlError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Valida que una URL sea http(s) y apunte a un destino público.
 * Devuelve la URL normalizada o lanza UnsafeUrlError.
 */
export async function assertPublicUrl(
  raw,
  { lookupImpl = lookup, allowPrivate = process.env.VIBEDOM_ALLOW_PRIVATE === "1", lookupTimeoutMs = DEFAULT_LOOKUP_TIMEOUT_MS } = {},
) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Solo se pueden escanear URLs http o https");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("La URL no puede incluir credenciales");
  }

  if (allowPrivate) return url.href;

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("La URL no tiene host");

  if (isBlockedHostname(host)) {
    throw new UnsafeUrlError(`No se pueden escanear direcciones locales (${host})`);
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError(`No se pueden escanear direcciones privadas (${host})`);
    return url.href;
  }

  let addresses;
  const useCache = lookupImpl === lookup;
  const cached = useCache ? dnsCache.get(host) : null;
  if (cached && cached.expires > Date.now()) {
    addresses = cached.addresses;
  } else {
    try {
      addresses = await withTimeout(
        lookupImpl(host, { all: true, verbatim: true }),
        lookupTimeoutMs,
        `No se pudo resolver el dominio ${host} a tiempo`,
      );
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw err;
      throw new UnsafeUrlError(`No se pudo resolver el dominio ${host}`);
    }

    if (useCache) {
      if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.delete(dnsCache.keys().next().value);
      dnsCache.set(host, { addresses, expires: Date.now() + DNS_TTL_MS });
    }
  }

  if (!addresses?.length) throw new UnsafeUrlError(`No se pudo resolver el dominio ${host}`);
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new UnsafeUrlError(`El dominio ${host} resuelve a una dirección privada`);
  }

  return url.href;
}
