// pipeline/lib/izi-api.mjs
// Réplica del login + fetch de facturas de la API REST de iZi Soluciones,
// tal como lo hace el M embebido en `expressions.tmdl` (expression fuente_iZi_Ancestral).
//
// Credenciales: SOLO desde process.env.IZI_EMAIL / process.env.IZI_PASSWORD.
// Nunca hardcodear ni escribir en archivos que se commiteen.

const BASE_URL = "https://api.beta.izisoluciones.com";

export async function login(email, password) {
  if (!email || !password) {
    throw new Error(
      "izi-api: faltan credenciales. Exporta IZI_EMAIL e IZI_PASSWORD como variables de entorno."
    );
  }
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      correoElectronico: email,
      contrasena: password,
      cadena: "",
    }),
  });
  if (!res.ok) {
    throw new Error(`izi-api login: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json.token) {
    throw new Error("izi-api login: la respuesta no incluye 'token'");
  }
  return json.token;
}

/**
 * GET /facturas para una sucursal/contribuyente y rango de fechas dado.
 * Replica los query params exactos usados en el M: desde, contribuyente, hasta,
 * isPruebas=false, offset=0, prefactura=false, sucursal.
 * Devuelve el array crudo de facturas (json.facturas), o [] si no existe.
 */
export async function fetchFacturas(token, { desde, hasta, contribuyente = "79818", sucursal = "79344" }) {
  const params = new URLSearchParams({
    desde,
    contribuyente,
    hasta,
    isPruebas: "false",
    offset: "0",
    prefactura: "false",
    sucursal,
  });
  const url = `${BASE_URL}/facturas?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "izi-contribuyente": contribuyente,
      "izi-sucursal": sucursal,
    },
  });
  if (!res.ok) {
    throw new Error(`izi-api fetchFacturas: HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json.facturas) ? json.facturas : [];
}

/**
 * Replica la transformación M de `fac_ventas_Ancestral_iZi`:
 *  - Fecha Bolivia = fechaPago (UTC) - 4 horas, tomamos solo la fecha (Date).
 *  - Expande listaItems -> filas {articulo, cantidad, precioTotal, codigoInventario}.
 *  - Descarta el código AN000046.
 *  - Columna calculada 'Cantidad Chuleton' = IF(codigoInventario="ANC00090", 1, Cantidad).
 * Devuelve filas planas: { fecha (Date UTC sin hora), producto, cantidad, codigoInventario, cantidadChuleton }.
 */
export function expandFacturasAncestral(facturas) {
  const out = [];
  for (const f of facturas) {
    if (!f.fechaPago) continue;
    const utcDate = new Date(f.fechaPago);
    if (Number.isNaN(utcDate.getTime())) continue;
    // Bolivia = UTC-4. Restamos 4 horas y tomamos la fecha calendario resultante.
    const boliviaMs = utcDate.getTime() - 4 * 3600 * 1000;
    const bolivia = new Date(boliviaMs);
    const fecha = new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));

    const items = Array.isArray(f.listaItems) ? f.listaItems : [];
    for (const item of items) {
      const codigoInventario = item.codigoInventario;
      if (codigoInventario === "AN000046") continue;
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad)) continue;
      const cantidadChuleton = codigoInventario === "ANC00090" ? 1 : cantidad;
      out.push({
        fecha,
        producto: item.articulo,
        cantidad,
        codigoInventario,
        cantidadChuleton,
      });
    }
  }
  return out;
}

/** Orquesta login + fetch + expand para Ancestral (sucursal 79344, contribuyente 79818). */
export async function getVentasAncestral(email, password, { desde, hasta }) {
  const token = await login(email, password);
  const facturas = await fetchFacturas(token, { desde, hasta, contribuyente: "79818", sucursal: "79344" });
  return expandFacturasAncestral(facturas);
}
