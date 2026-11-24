// Historial de escaneos recientes en el navegador del visitante (localStorage).
// Nada viaja al servidor: solo la URL y la semilla, para poder re-escuchar
// sin gastar otro análisis.

export const HISTORY_KEY = "vibedom:history";
export const HISTORY_LIMIT = 6;

/** Acepta localStorage, un Storage mock o nada; nunca lanza. */
function usable(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  return storage;
}

function validEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.url === "string" &&
    /^https?:\/\//i.test(entry.url) &&
    typeof entry.seed === "object" &&
    entry.seed !== null
  );
}

/** Lee el historial ya saneado: formato raro o JSON corrupto devuelven []. */
export function readHistory(storage) {
  const store = usable(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validEntry).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Antepone una entrada (o la mueve arriba si la URL ya estaba) y recorta al
 * límite. Devuelve el historial resultante; un almacen bloqueado
 * (modo privado, cuota llena) no rompe el flujo.
 */
export function addHistoryEntry(storage, { url, seed } = {}) {
  const store = usable(storage);
  if (!store || !validEntry({ url, seed })) return readHistory(store);

  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    // la validez de la URL la garantiza quien llama; esto es defensivo
  }

  const entry = {
    url,
    host,
    vibe: seed?.metadata?.detectedVibe ?? "",
    at: Date.now(),
    seed: structuredClone(seed),
  };

  const entries = [entry, ...readHistory(store).filter((item) => item.url !== url)].slice(
    0,
    HISTORY_LIMIT,
  );

  try {
    store.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // cuota llena o modo privado: el escaneo acaba de funcionar igualmente
  }
  return readHistory(store);
}

/** Borra el historial. Nunca lanza. */
export function clearHistory(storage) {
  const store = usable(storage);
  if (!store) return;
  try {
    store.removeItem(HISTORY_KEY);
  } catch {
    // ignorado a propósito
  }
}
