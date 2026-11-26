// Página mínima de /api/stats. Sin assets: el backend de Render la sirve sola.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

function cell(value) {
  return `<td>${escapeHtml(value)}</td>`;
}

function table(title, rows, key) {
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${cell(row[key])}${cell(row.pageview)}${cell(row.scan)}${cell(row.widget)}${cell(row.total)}</tr>`,
        )
        .join("")
    : `<tr><td colspan="5">Sin datos en esta ventana.</td></tr>`;

  return `<h3>${escapeHtml(title)}</h3>
<table>
  <thead><tr><th>${escapeHtml(key === "host" ? "Referrer" : key === "path" ? "Ruta" : "Ref")}</th><th>Páginas</th><th>Escaneos</th><th>Widgets</th><th>Total</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

function windowSection(summary) {
  const { totals } = summary;
  return `<section>
  <h2>Últimos ${escapeHtml(summary.days)} días</h2>
  <p class="range">${escapeHtml(summary.from)} – ${escapeHtml(summary.to)} (UTC)</p>
  <ul>
    <li>Páginas vistas: <strong>${escapeHtml(totals.pageview)}</strong></li>
    <li>Escaneos empezados: <strong>${escapeHtml(totals.scan)}</strong></li>
    <li>Widgets cargados: <strong>${escapeHtml(totals.widget)}</strong></li>
    <li>Visitantes únicos, sumados por día: <strong>${escapeHtml(summary.uniques)}</strong></li>
  </ul>
  ${table("Por ref", summary.byRef, "ref")}
  ${table("Por referrer", summary.byReferrer, "host")}
  ${table("Por ruta", summary.byPath, "path")}
</section>`;
}

/** HTML autónomo con las ventanas de 7 y 30 días. */
export function renderStatsPage(report) {
  const durable = report.storage?.durable;
  const note = durable
    ? "Almacén: Upstash Redis. Los agregados sobreviven a los reinicios de Render."
    : "Almacén: memoria de este proceso. Render no conserva el disco: sin UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN estos números se pierden al dormir el servicio.";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Visitas · vibedom</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0 auto; max-width: 52rem; padding: 2rem 1.25rem 4rem; font: 16px/1.5 system-ui, sans-serif; background: #0a0a0c; color: #f4f1e8; }
    h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
    h2 { margin-top: 2rem; font-size: 1.25rem; }
    h3 { margin-bottom: 0.35rem; font-size: 1rem; }
    a { color: #d8ff4f; }
    .note, .range { color: #b7b3a8; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 1.25rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #2a2a30; }
    th { color: #d8ff4f; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Visitas de vibedom</h1>
  <p class="note">${escapeHtml(note)}</p>
  <p class="note">Agregados sin cookies. No hay IP, user-agent ni identificador persistente. El único de cada día es un hash con sal que rota a medianoche UTC: la suma de 7 o 30 días no es gente distinta, es la suma de los días. Quien envía Do Not Track o Global Privacy Control no entra.</p>
  ${windowSection(report.days[7])}
  ${windowSection(report.days[30])}
</body>
</html>`;
}
