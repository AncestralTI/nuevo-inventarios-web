// pipeline/lib/anc-beb-vin-pipeline.mjs
// Orquestador COMPARTIDO para las páginas reales "An. Vinos" y "An. Bebidas" del PBIX original:
// ambas usan exactamente el mismo layout, las mismas 15 medidas de "Anc. Beb y Vin" (ver
// measures-anc-beb.mjs) y las mismas fuentes -- solo cambia la lista de
// Dim_Producto_iZi[Categoria] con la que se filtra la página. Por eso toda la lógica de descarga +
// cálculo vive aquí, parametrizada por `categorias`, y build-an-vinos.mjs (y, más adelante,
// build-an-bebidas.mjs) son wrappers delgados que solo fijan la config y escriben el JSON.
//
// Fuentes (verificadas contra el TMDL crudo del modelo real, no solo contra el resumen):
//   - 'Apertura Vinos por Copa'   : Google Sheet id 2PACX-1vRxSq...LUYPR_ (gid=451366995)
//   - 'Inventarios GS'            : MISMO Google Sheet que Apertura Vinos por Copa (gid=0) +
//                                    'Inventarios Bebidas' (gid=809483540, misma spreadsheet,
//                                    Table.Combine de ambas en el M original) -- OJO: este es un
//                                    spreadsheet DISTINTO al usado por Compras Insumos/Matriz/
//                                    Pesos platos (que sí es el mismo que usa An. Insumos).
//   - 'Compras Totales'           : Table.Combine({Compras Insumos}) + merge con 'Pesos platos'
//                                    (la columna 'Cantidad.1' resultante del merge NO se usa en
//                                    ninguna medida de Beb/Vin; 'Compras Anc Beb' suma la columna
//                                    'Cantidad' original de Compras Insumos). Reutiliza el mismo
//                                    Google Sheet / gid que 'Compras Insumos' de An. Insumos.
//   - 'Dim_Producto_iZi'          : API iZi, GET /items-inventarios (login previo).
//   - 'fac_ventas_Ancestral_iZi'  : API iZi, GET /facturas (misma lógica que getVentasAncestral).
//   - 'fac_ventas_Ancestral_Productos_Extra' : derivada de fac_ventas_Ancestral_iZi + merge con
//                                    'Matriz_de_Relaciones Ancestral' filtrado a Cod Insumo="ANC00007".
//                                    OJO (verificado en vivo con dax_query_operations, corrige el
//                                    resumen que traía este dato): "ANC00007" NO es el código de
//                                    Chuletón en esta tabla -- Matriz_de_Relaciones Ancestral solo
//                                    tiene UNA fila con Cod Insumo="ANC00007" y es
//                                    {Insumo="HUARI", Cod Producto="ANC00010" (MICHELADA ANCESTRAL)}.
//                                    Es decir, ese código de insumo (usado en otra parte del modelo
//                                    para Chuletón/insumos de comida) fue REUTILIZADO aquí como el
//                                    código de insumo de la cerveza HUARI dentro de la receta de la
//                                    Michelada Ancestral -- una coincidencia real de los datos, no un
//                                    error nuestro. El efecto neto (correcto, ya validado): las ventas
//                                    de "MICHELADA ANCESTRAL" que consumen HUARI como insumo alimentan
//                                    `Vtas Ext. Anc Beb` del producto "HUARI" (que SÍ cae dentro del
//                                    filtro de categoría CERVEZA de "An. Vinos"/"An. Bebidas").
//   - 'Mov Inv omuh (5)'          : API iZi, GET /movimientos (últimos 1 mes), codigoInventario
//                                    que contiene "58".

import { fetchCsvObjects, toNumberOrNull, toDateOrNull, fmtDate, addDays } from "./sheets.mjs";
import { weekYear, weekdayIso, mondayOf, weekYearToRange } from "./calendar.mjs";
import {
  login,
  fetchFacturas,
  expandFacturasAncestral,
  fetchDimProducto,
  fetchMovimientosBeb,
} from "./izi-api.mjs";
import * as M from "./measures-anc-beb.mjs";

const SHEET_BEB_VIN_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxSq2o86st5D9pK6lzNuXRS5IitoiPU5739PRf8hL-lPWtFu9ypphWVP867sRfRSnSyUb8oAlUYPR_/pub";

const SHEET_ANCESTRAL_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ75zxBFs61BR1asMscyYFYKIblAKmz1QXyIaOMPFophgCXeG22j-iy8GgU6Fl2tIxKkZM1YkDEj21l/pub";

const URLS = {
  aperturaVinosPorCopa: `${SHEET_BEB_VIN_BASE}?gid=451366995&single=true&output=csv`,
  inventariosGS: `${SHEET_BEB_VIN_BASE}?gid=0&single=true&output=csv`,
  inventariosBebidas: `${SHEET_BEB_VIN_BASE}?gid=809483540&single=true&output=csv`,
  comprasInsumos: `${SHEET_ANCESTRAL_BASE}?gid=1477437632&single=true&output=csv`,
  matrizRelaciones: `${SHEET_ANCESTRAL_BASE}?gid=178005519&single=true&output=csv`,
};

// Cod Insumo usado por fac_ventas_Ancestral_Productos_Extra (ver nota arriba: en la práctica es el
// código de insumo de HUARI dentro de la receta de "MICHELADA ANCESTRAL", no de Chuletón).
const COD_INSUMO_VTAS_EXTRA = "ANC00007";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// Carga de fuentes
// ---------------------------------------------------------------------------

async function loadAperturaVinosPorCopa() {
  const raw = await fetchCsvObjects(URLS.aperturaVinosPorCopa);
  const out = [];
  for (const r of raw) {
    const codigoProducto = (r["Codigo Producto"] || "").trim();
    if (codigoProducto === "") continue; // M: Filtered Rows [Codigo Producto] <> ""
    const fecha = toDateOrNull(r["Fecha"]);
    if (!fecha) continue;
    out.push({
      fecha,
      codigoProducto,
      numBotellas: toNumberOrNull(r["#Botellas"]),
    });
  }
  return out;
}

/** Réplica genérica del patrón unpivot de 'Inventarios GS' / 'Inventarios Bebidas' (CSV ancho ->
 *  largo). A diferencia de 'Inventarios Unitarios GS' (An. Insumos), aquí SÍ hay columna propia
 *  'Cod Producto' en el CSV (id column), así que no hace falta pasar por un join con la Matriz. */
async function loadInventariosWide(url) {
  const raw = await fetchCsvObjects(url);
  if (raw.length === 0) return [];
  const headers = Object.keys(raw[0]);
  const idCols = ["Categoria", "Producto", "Cod Producto"];
  const dateCols = headers.filter((h) => h !== "Vigente" && !idCols.includes(h));

  const out = [];
  for (const row of raw) {
    const codProducto = (row["Cod Producto"] || "").trim();
    if (codProducto === "") continue;
    for (const col of dateCols) {
      const fecha = toDateOrNull(col);
      if (!fecha) continue; // columna que no es fecha -> descartada (Table.RemoveRowsWithErrors)
      let val = row[col];
      if (val === "-") val = "";
      const cantidad = toNumberOrNull(val);
      if (cantidad === null) continue;
      out.push({ codProducto, fecha, cantidad });
    }
  }
  return out;
}

/** 'Inventarios GS' = Table.Combine(unpivot(gid=0), unpivot('Inventarios Bebidas', gid=809483540)). */
async function loadInventariosGS() {
  const [propias, bebidas] = await Promise.all([
    loadInventariosWide(URLS.inventariosGS),
    loadInventariosWide(URLS.inventariosBebidas),
  ]);
  return [...propias, ...bebidas];
}

/**
 * 'Compras Totales'[Cantidad] / [Fecha] / [Cod Producto] / [Empresa]: hereda directamente de
 * 'Compras Insumos' (Table.Combine({Compras Insumos})), que ya trae Fecha = Fecha Porcion ?? Fecha1
 * calculada en su propio M y ya filtra Empresa<>"Catering". Solo necesitamos esas 4 columnas (la
 * columna 'Cantidad.1' del merge con Pesos platos no la usa ninguna medida de Beb/Vin).
 */
async function loadComprasTotales() {
  const raw = await fetchCsvObjects(URLS.comprasInsumos);
  const out = [];
  for (const r of raw) {
    const fecha1 = toDateOrNull(r["Fecha1"] ?? r["Fecha"]);
    const fechaPorcion = toDateOrNull(r["Fecha Porcion"]);
    const fecha = fechaPorcion || fecha1; // = Compras Totales[Fecha], la relación ACTIVA a Calendar aquí
    if (!fecha) continue;
    const empresa = (r["Empresa"] || "").trim();
    if (empresa === "Catering") continue;
    out.push({
      fecha,
      codProducto: (r["Cod Producto"] || "").trim(),
      cantidad: toNumberOrNull(r["Cantidad"] ?? r["Cantidad Compra"]),
      empresa,
    });
  }
  return out;
}

/** Solo las filas de Matriz_de_Relaciones Ancestral con Cod Insumo="ANC00007" (en la práctica, la fila HUARI/MICHELADA ANCESTRAL -- ver nota arriba), que son
 *  las únicas que sobreviven al filtro de fac_ventas_Ancestral_Productos_Extra. */
async function loadMatrizChuleton() {
  const raw = await fetchCsvObjects(URLS.matrizRelaciones);
  const out = [];
  for (const r of raw) {
    const codProducto = (r["Cod Producto"] || "").trim();
    if (codProducto === "") continue;
    const codInsumo = (r["Cod Insumo"] || "").trim();
    if (codInsumo !== COD_INSUMO_VTAS_EXTRA) continue;
    const cantidadUsada = toNumberOrNull(r["Cantidad usada (kg o u)"] ?? r["Cantidad usada"]);
    if (cantidadUsada === null) continue;
    out.push({ codProducto, cantidadUsada });
  }
  return out;
}

/** Suma N meses (con clamp al último día del mes destino) a una fecha UTC -- réplica de
 *  Date.AddMonths de Power Query, usado para el rango de 'Mov Inv omuh (5)' (Date.AddMonths(Hoy,-1)). */
function addMonthsUtc(date, n) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + n, Math.min(d, lastDayOfTarget)));
}

// ---------------------------------------------------------------------------
// Join / atribución a Dim_Producto_iZi[Producto]
// ---------------------------------------------------------------------------

function buildCodProductoMap(dimProductoRows) {
  const map = new Map();
  for (const r of dimProductoRows) map.set(r.codProducto, r.producto);
  return map;
}

/** Adjunta `producto` (Dim_Producto_iZi[Producto]) a cada fila vía su columna de código, y
 *  descarta las filas cuyo código no matchea ningún producto del catálogo (igual que una relación
 *  *:1 real: sin match, la fila no propaga filtro/no aporta a ninguna medida agrupada por Producto). */
function attachProducto(rows, codKey, codMap) {
  const out = [];
  for (const r of rows) {
    const producto = codMap.get(r[codKey]);
    if (producto === undefined) continue;
    out.push({ ...r, producto });
  }
  return out;
}

/**
 * fac_ventas_Ancestral_Productos_Extra: para cada venta cuyo codigoInventario matchea una fila de
 * Matriz (ya filtrada a Cod Insumo="ANC00007"), Cantidad = Matriz.CantidadUsada * venta.Cantidad
 * (cruda, no 'Cantidad Chuleton'), con codigoInventario reescrito a "ANC00007" (el FK real hacia
 * Dim_Producto_iZi vía Matriz_de_Relaciones.Cod Insumo).
 */
function buildVentasExtraRows(ventasRows, matrizChuletonRows) {
  const porCodProducto = new Map();
  for (const m of matrizChuletonRows) {
    if (!porCodProducto.has(m.codProducto)) porCodProducto.set(m.codProducto, []);
    porCodProducto.get(m.codProducto).push(m);
  }
  const out = [];
  for (const v of ventasRows) {
    const matches = porCodProducto.get(v.codigoInventario);
    if (!matches) continue;
    for (const m of matches) {
      out.push({
        fecha: v.fecha,
        codigoInventario: COD_INSUMO_VTAS_EXTRA,
        cantidad: v.cantidad * m.cantidadUsada,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orquestador principal (parametrizable por categorías)
// ---------------------------------------------------------------------------

/**
 * @param {object} config
 * @param {string[]} config.categorias - Dim_Producto_iZi[Categoria] IN {...} del filtro de página.
 * @param {string} [config.email] - IZI_EMAIL (si falta, se omiten Vtas/VtasExt/Cortesias/DimProducto
 *   y se avisa con un warning; el resto de fuentes -Sheets- sí se descargan).
 * @param {string} [config.password] - IZI_PASSWORD.
 * @param {Date} [config.todayUtc] - fecha de referencia (por defecto: hoy, UTC medianoche).
 * @returns {Promise<object>} objeto listo para JSON.stringify -> data/an-*.json
 */
export async function buildAncBebVinData(config) {
  const { categorias, email = process.env.IZI_EMAIL, password = process.env.IZI_PASSWORD } = config;
  const today = config.todayUtc || new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const warnings = [];

  log("Descargando Google Sheets (Beb/Vin, Ancestral)...");
  const [aperturaRows, inventariosGsRows, comprasRows, matrizChuletonRows] = await Promise.all([
    loadAperturaVinosPorCopa(),
    loadInventariosGS(),
    loadComprasTotales(),
    loadMatrizChuleton(),
  ]);
  log(
    `  Apertura Vinos por Copa: ${aperturaRows.length} filas | Inventarios GS: ${inventariosGsRows.length} filas | ` +
      `Compras Totales: ${comprasRows.length} filas | Matriz (Cod Insumo=ANC00007): ${matrizChuletonRows.length} filas`
  );

  let dimProductoRows = [];
  let ventasRows = [];
  let movInvRows = [];

  if (email && password) {
    log("Login iZi + fetch de Dim_Producto_iZi / ventas / movimientos...");
    try {
      const token = await login(email, password);

      dimProductoRows = await fetchDimProducto(token);
      log(`  Dim_Producto_iZi: ${dimProductoRows.length} productos`);

      const desdeVentas = fmtDate(addDays(todayUtc, -60));
      const hastaVentas = fmtDate(todayUtc);
      const facturas = await fetchFacturas(token, {
        desde: desdeVentas,
        hasta: hastaVentas,
        contribuyente: "79818",
        sucursal: "79344",
      });
      ventasRows = expandFacturasAncestral(facturas);
      log(`  fac_ventas_Ancestral_iZi: ${ventasRows.length} líneas de factura`);

      const desdeMov = fmtDate(addMonthsUtc(todayUtc, -1));
      const hastaMov = fmtDate(todayUtc);
      movInvRows = await fetchMovimientosBeb(token, { desde: desdeMov, hasta: hastaMov });
      log(`  Mov Inv omuh (5): ${movInvRows.length} filas`);
    } catch (err) {
      warnings.push(`Fallo al obtener datos de iZi: ${err.message}`);
      log("  ADVERTENCIA:", err.message);
    }
  } else {
    warnings.push("IZI_EMAIL / IZI_PASSWORD no configurados: Vtas/Vtas Ext/Cortesias/Dim_Producto quedan vacíos.");
    log("  IZI_EMAIL / IZI_PASSWORD no configurados: se omiten fuentes de la API iZi.");
  }

  if (dimProductoRows.length === 0) {
    // Sin catálogo no hay a qué atribuir ninguna medida: devolvemos estructura vacía pero válida.
    warnings.push("Dim_Producto_iZi vacío: no se pudo calcular ningún producto.");
    return {
      generatedAt: new Date().toISOString(),
      rangoFechas: { desde: null, hasta: fmtDate(todayUtc) },
      categorias,
      productos: [],
      semanas: [],
      semanasInfo: [],
      resumenSemanal: [],
      detalleDiario: [],
      serieSemanal: {},
      meta: { warnings },
    };
  }

  const codMap = buildCodProductoMap(dimProductoRows);
  const productosPagina = M.filtrarProductosPorCategoria(dimProductoRows, categorias);
  const productos = [...new Set(productosPagina.map((p) => p.producto))].sort((a, b) => a.localeCompare(b, "es"));

  // Adjuntamos `producto` a cada fuente vía su columna de código (equivalente a la relación *:1
  // real con Dim_Producto_iZi). Las filas sin match se descartan (no propagan a ningún producto).
  const aperturaConProducto = attachProducto(aperturaRows, "codigoProducto", codMap);
  const inventariosConProducto = attachProducto(inventariosGsRows, "codProducto", codMap);
  const comprasConProducto = attachProducto(comprasRows, "codProducto", codMap);
  const ventasConProducto = attachProducto(ventasRows, "codigoInventario", codMap);
  const movInvConProducto = attachProducto(movInvRows, "codigoInventario", codMap);
  const ventasExtraRaw = buildVentasExtraRows(ventasRows, matrizChuletonRows);
  const ventasExtraConProducto = attachProducto(ventasExtraRaw, "codigoInventario", codMap);

  // --- Semanas a calcular: últimas 10 semanas completas + la semana actual (igual que An. Insumos) ---
  const currentMonday = mondayOf(todayUtc);
  const weeks = [];
  for (let i = 0; i < 10; i++) {
    const monday = addDays(currentMonday, -7 * i);
    weeks.push({ weekYear: weekYear(monday), monday, sunday: addDays(monday, 6) });
  }

  log(`Calculando medidas para ${productos.length} productos x ${weeks.length} semanas...`);

  const resumenSemanal = [];
  const serieSemanalMap = { Vtas: [], "Vtas Ext": [], Cortesias: [], "Vtas Tot": [], Salidas: [], Compras: [] };

  for (const w of weeks) {
    for (const producto of productos) {
      const invMenos7 = M.invMenos7AncBeb(inventariosConProducto, producto, w.weekYear, w.monday);
      const compras = M.comprasAncBeb(comprasConProducto, producto, w.weekYear);
      const vtas = M.vtasAncBeb(ventasConProducto, producto, w.weekYear);
      const vtasExt = M.vtasExtAncBeb(ventasExtraConProducto, producto, w.weekYear);
      const cortesias = M.cortesiasAncBeb(movInvConProducto, producto, w.weekYear, vtas);
      const apCopas = M.apCopasBajas(aperturaConProducto, producto, w.weekYear);
      const vtasTot = M.vtasTotAncBeb(cortesias, vtas, vtasExt, apCopas);
      const inv = M.invAncBeb(inventariosConProducto, producto, w.weekYear);
      const cierre = M.cierreAncBeb(invMenos7, compras, vtas, apCopas, vtasExt, cortesias);
      const dif = M.difAncBeb(inv, cierre);

      resumenSemanal.push({
        producto,
        weekYear: w.weekYear,
        invMenos7,
        compras,
        vtas,
        vtasExt,
        cortesias,
        salidas: apCopas, // "Sal." en la tabla = Ap Copas/Bajas
        vtasTot,
        inv,
        cierre,
        dif,
      });
    }
  }

  // --- Series semanales para el gráfico (últimas 6 semanas, orden cronológico ascendente) ---
  const last6 = weeks.slice(0, 6).reverse();
  const FIELD_BY_LABEL = {
    Vtas: "vtas",
    "Vtas Ext": "vtasExt",
    Cortesias: "cortesias",
    "Vtas Tot": "vtasTot",
    Salidas: "salidas",
    Compras: "compras",
  };
  for (const w of last6) {
    const rowsSemana = resumenSemanal.filter((r) => r.weekYear === w.weekYear);
    for (const [label, field] of Object.entries(FIELD_BY_LABEL)) {
      serieSemanalMap[label].push({ weekYear: w.weekYear, valor: sumField(rowsSemana, field) });
    }
  }

  // --- Detalle diario (semana actual + anterior, igual que An. Insumos) ---
  const detalleDiario = [];
  const semanasDetalle = weeks.slice(0, 2);
  for (const w of semanasDetalle) {
    for (let d = 0; d < 7; d++) {
      const fecha = addDays(w.monday, d);
      if (fecha.getTime() > todayUtc.getTime()) continue;
      const diaIso = weekdayIso(fecha);

      for (const producto of productos) {
        const comprasDia = sum1(
          comprasConProducto
            .filter((r) => r.producto === producto && r.empresa === "Ancestral" && r.fecha && sameDay(r.fecha, fecha))
            .map((r) => r.cantidad)
        );
        const vtasDia = sum1(
          ventasConProducto.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)).map((r) => r.cantidadChuleton)
        );
        const vtasExtDia = sum1(
          ventasExtraConProducto.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)).map((r) => r.cantidad)
        );
        const movDia = sum1(
          movInvConProducto
            .filter(
              (r) =>
                r.producto === producto &&
                sameDay(r.fecha, fecha) &&
                (r.tipoMovimiento === "interna" || r.tipoMovimiento === "prod-venta")
            )
            .map((r) => r.cantidad)
        );
        const cortesiasDia = Math.max(0, movDia - vtasDia);
        const apCopasDia = sum1(
          aperturaConProducto.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)).map((r) => r.numBotellas)
        );

        // Sin movimiento alguno ese día para este producto: no emitimos fila (igual que An. Insumos).
        if (comprasDia === 0 && vtasDia === 0 && vtasExtDia === 0 && cortesiasDia === 0 && apCopasDia === 0) continue;

        const acumComp = M.acumComprasAncBeb(comprasConProducto, producto, w.weekYear, fecha);
        const acumSal = M.acumSalAncBeb(
          ventasConProducto,
          ventasExtraConProducto,
          movInvConProducto,
          aperturaConProducto,
          producto,
          w.weekYear,
          fecha
        );
        const invEsperado = M.invEspBeb(inventariosConProducto, producto, w.weekYear, w.monday, acumComp, acumSal);

        const invMenos7Semana = M.invMenos7AncBeb(inventariosConProducto, producto, w.weekYear, w.monday);
        const invSemana = M.invAncBeb(inventariosConProducto, producto, w.weekYear);
        const invVis = M.invVisBeb(diaIso, invMenos7Semana, invSemana);

        detalleDiario.push({
          producto,
          fecha: fmtDate(fecha),
          dia: DIA_ABBR[diaIso],
          compras: round2(comprasDia),
          vtas: round2(vtasDia),
          vtasExt: round2(vtasExtDia),
          cortesias: round2(cortesiasDia),
          salidas: round2(apCopasDia),
          invEsperado: round2(invEsperado),
          invIniFin: invVis !== null ? round2(invVis) : null,
          dif: invVis !== null ? round2(invVis - invEsperado) : null,
        });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    rangoFechas: {
      desde: fmtDate(weeks[weeks.length - 1].monday),
      hasta: fmtDate(todayUtc),
    },
    categorias,
    productos,
    semanas: weeks.map((w) => w.weekYear),
    semanasInfo: weeks.map((w) => ({
      weekYear: w.weekYear,
      desde: fmtDate(w.monday),
      hasta: fmtDate(w.sunday),
    })),
    resumenSemanal: resumenSemanal.map(roundRow),
    detalleDiario,
    serieSemanal: serieSemanalMap,
    meta: {
      ventasIziDisponibles: ventasRows.length > 0,
      filasApertura: aperturaRows.length,
      filasInventariosGs: inventariosGsRows.length,
      filasCompras: comprasRows.length,
      filasMatrizChuleton: matrizChuletonRows.length,
      filasVentasIzi: ventasRows.length,
      filasMovInv: movInvRows.length,
      filasDimProducto: dimProductoRows.length,
      warnings,
    },
  };

  return output;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIA_ABBR = { 1: "lun", 2: "mar", 3: "mié", 4: "jue", 5: "vie", 6: "sáb", 7: "dom" };

function sameDay(a, b) {
  return a && b && a.getTime() === b.getTime();
}

function sum1(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return nums.reduce((a, b) => a + b, 0);
}

function sumField(rows, field) {
  return round2(sum1(rows.map((r) => r[field])));
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return n === undefined ? null : n;
  return Math.round(n * 100) / 100;
}

function roundRow(r) {
  const out = { ...r };
  for (const k of ["invMenos7", "compras", "vtas", "vtasExt", "cortesias", "salidas", "vtasTot", "inv", "cierre", "dif"]) {
    out[k] = round2(out[k]);
  }
  return out;
}
