// pipeline/lib/sheets.mjs
// Fetch + parseo de los Google Sheets publicados como CSV, y utilidades genéricas
// de transformación (unpivot) que replican los pasos equivalentes de Power Query.

/**
 * Parser CSV simple pero correcto (RFC4180): soporta comillas dobles, comas y
 * saltos de línea dentro de campos citados, y comillas escapadas ("").
 * No usamos una librería externa porque las fuentes son CSV públicos simples
 * (Google Sheets "publish to web") y así mantenemos el pipeline sin dependencias.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Normaliza CRLF -> LF para simplificar el escaneo.
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // último campo/fila (si el archivo no termina en \n)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Descarta filas totalmente vacías al final (líneas en blanco del CSV).
  while (rows.length && rows[rows.length - 1].every((v) => v === "")) {
    rows.pop();
  }

  return rows;
}

/** Convierte filas crudas (array de arrays) en objetos usando la primera fila como encabezado. */
export function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = r[c] !== undefined ? r[c] : "";
    }
    out.push(obj);
  }
  return out;
}

/** Descarga un CSV publicado de Google Sheets y lo devuelve como array de objetos (fila -> {col: valor}). */
export async function fetchCsvObjects(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetchCsvObjects: HTTP ${res.status} al descargar ${url}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  return rowsToObjects(rows);
}

/**
 * Replica Table.UnpivotOtherColumns: dado un array de objetos "anchos" (una
 * columna por fecha, p.ej. Inventarios Unitarios GS), y la lista de columnas
 * "id" que se mantienen, convierte cada columna restante en una fila con
 * {..idColumns, attributeName: <nombre de columna>, valueName: <valor>}.
 */
export function unpivotOtherColumns(objects, idColumns, attributeName = "Attribute", valueName = "Value") {
  const out = [];
  for (const obj of objects) {
    const idPart = {};
    for (const k of idColumns) idPart[k] = obj[k];
    for (const key of Object.keys(obj)) {
      if (idColumns.includes(key)) continue;
      out.push({ ...idPart, [attributeName]: key, [valueName]: obj[key] });
    }
  }
  return out;
}

/** Parsea un número al estilo Power Query (acepta vacío/"-" como blank, coma o punto decimal). */
export function toNumberOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parsea una fecha a un objeto Date (UTC, medianoche exacta -- SIEMPRE, para que las
 * comparaciones por igualdad de timestamp (sameDay) sean seguras entre distintas fuentes).
 * Soporta: "dd/mm/yyyy", "yyyy-mm-dd" y "D-Mon-YYYY" (p.ej. "8-Sep-2026", formato que usa
 * la hoja "Salidas y Mermas Ancestral").
 *
 * IMPORTANTE: NUNCA se usa `new Date(string)` como fallback genérico -- ese constructor
 * interpreta fechas ambiguas en la zona horaria LOCAL del proceso que corre el pipeline
 * (que puede no ser UTC), lo que desplazaba la hora (p.ej. a 04:00 UTC) y rompía las
 * comparaciones de "mismo día" (getTime()) contra fechas construidas con Date.UTC(). Todas
 * las ramas de abajo construyen explícitamente con Date.UTC(y, m, d) para evitar eso.
 */
export function toDateOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;

  // dd/mm/yyyy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  }

  // D-Mon-YYYY (p.ej. "8-Sep-2026", "11-Oct-2025")
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const [, d, monStr, y] = m;
    const mo = MONTH_ABBR[monStr.toLowerCase()];
    if (mo !== undefined) {
      return new Date(Date.UTC(Number(y), mo, Number(d)));
    }
  }

  // Último recurso: dejar que Date lo interprete, pero re-anclar a medianoche UTC usando
  // los getters LOCALES (Date ya habrá resuelto correctamente año/mes/día en la zona local
  // al parsear el string; solo normalizamos la hora para que sea comparable).
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Formatea un Date (UTC) como YYYY-MM-DD. */
export function fmtDate(d) {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Suma/resta N días a una fecha UTC, devuelve un nuevo Date. */
export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}
