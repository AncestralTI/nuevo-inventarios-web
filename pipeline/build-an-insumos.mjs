#!/usr/bin/env node
// pipeline/build-an-insumos.mjs
// Orquesta el pipeline completo del módulo piloto "An. Insumos":
//   1. Descarga los 4 Google Sheets publicados (Compras Insumos, Salidas y Mermas Ancestral,
//      Matriz_de_Relaciones Ancestral, Inventarios Unitarios GS).
//   2. Descarga las ventas iZi de Ancestral (login + /facturas, últimos 60 días).
//   3. Replica las columnas calculadas / tablas calculadas del modelo (Peso Porcion,
//      PromedioSinOutliers, Porciones calculadas, Calendar/WeekYear).
//   4. Calcula las medidas de la carpeta "Anc. Insumos" por Insumo y semana.
//   5. Escribe data/an-insumos.json.
//
// Uso:
//   IZI_EMAIL=... IZI_PASSWORD=... node pipeline/build-an-insumos.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchCsvObjects, toNumberOrNull, toDateOrNull, fmtDate, addDays } from "./lib/sheets.mjs";
import { weekYear, weekdayIso, weekdayName, mondayOf } from "./lib/calendar.mjs";
import { getVentasAncestral } from "./lib/izi-api.mjs";
import * as M from "./lib/measures-an-insumos.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ75zxBFs61BR1asMscyYFYKIblAKmz1QXyIaOMPFophgCXeG22j-iy8GgU6Fl2tIxKkZM1YkDEj21l/pub";

const URLS = {
  comprasInsumos: `${SHEET_BASE}?gid=1477437632&single=true&output=csv`,
  salidasMermas: `${SHEET_BASE}?gid=1579941617&single=true&output=csv`,
  matrizRelaciones: `${SHEET_BASE}?gid=178005519&single=true&output=csv`,
  inventariosUnitarios: `${SHEET_BASE}?gid=614318944&single=true&output=csv`,
};

// Insumos excluidos por el filtro de página "An. Insumos" (sección 4.3 de ANALISIS_PBIX.md):
// Matriz_de_Relaciones Ancestral[Insumo] NOT IN {Entraña, HUARI, (en blanco)}.
const INSUMOS_EXCLUIDOS = new Set(["Entraña", "HUARI", ""]);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// 1. Carga y limpieza de las 4 hojas
// ---------------------------------------------------------------------------

async function loadComprasInsumos() {
  const raw = await fetchCsvObjects(URLS.comprasInsumos);
  // M: filtra Fecha<>null/"" y Empresa<>"Catering"; arma Fecha = FechaPorcion ?? Fecha1;
  // reemplaza "Tapa de pecho" -> "Keperi" en Producto.
  const out = [];
  for (const r of raw) {
    const fecha1 = toDateOrNull(r["Fecha1"] ?? r["Fecha"]);
    const fechaPorcion = toDateOrNull(r["Fecha Porcion"]);
    if (!fecha1 && !fechaPorcion) continue;
    const empresa = (r["Empresa"] || "").trim();
    if (empresa === "Catering") continue;
    let producto = (r["Producto"] || "").trim();
    if (producto === "Tapa de pecho") producto = "Keperi";
    out.push({
      fecha: fechaPorcion || fecha1,
      fecha1,
      fechaPorcion,
      codProducto: (r["Cod Producto"] || "").trim(),
      producto,
      cantidad: toNumberOrNull(r["Cantidad"] ?? r["Cantidad Compra"]),
      empresa,
      categoria: (r["Categoria"] || "").trim(),
      porciones: toNumberOrNull(r["Porciones"]),
      pesoReal: toNumberOrNull(r["Peso Real"]),
      insumo: producto, // en este modelo, Producto de Compras Insumos = Insumo (relación Compras Insumos.Producto -> Matriz.Insumo)
    });
  }
  return out;
}

async function loadSalidasMermas() {
  const raw = await fetchCsvObjects(URLS.salidasMermas);
  const out = [];
  for (const r of raw) {
    const fecha = toDateOrNull(r["Fecha"]);
    if (!fecha) continue;
    out.push({
      fecha,
      producto: (r["Producto"] || "").trim(),
      insumo: (r["Producto"] || "").trim(),
      peso: toNumberOrNull(r["Peso"]),
      comentarios: r["Comentarios"] || "",
      porciones: toNumberOrNull(r["Porciones"]),
    });
  }
  return out;
}

async function loadMatrizRelaciones() {
  const raw = await fetchCsvObjects(URLS.matrizRelaciones);
  // M: filtra Cod Producto <> ""; Cantidad = 'Cantidad usada (kg o u)' / (1 - Merma%);
  // Porciones null -> 1; filtra Porciones <> 0.
  const out = [];
  for (const r of raw) {
    const codProducto = (r["Cod Producto"] || "").trim();
    if (codProducto === "") continue;
    const cantidadUsada = toNumberOrNull(r["Cantidad usada (kg o u)"] ?? r["Cantidad usada"]);
    let mermaRaw = r["Merma (%)"] ?? r["Merma %"] ?? r["Merma"];
    let merma = 0;
    if (mermaRaw !== undefined && mermaRaw !== null && String(mermaRaw).trim() !== "") {
      const s = String(mermaRaw).trim().replace("%", "");
      const n = Number(s.replace(",", "."));
      merma = Number.isFinite(n) ? (s.includes("%") || n > 1 ? n / 100 : n) : 0;
      // Nota: si la hoja ya trae "10%" como texto, Percentage.Type de Power Query lo interpretaría 0.10.
      if (String(mermaRaw).trim().endsWith("%")) merma = n / 100;
      else merma = n; // valor ya decimal tipo 0.1
    }
    let porciones = toNumberOrNull(r["Porciones"]);
    if (porciones === null) porciones = 1;
    if (porciones === 0) continue;
    const cantidad =
      cantidadUsada !== null && merma !== 1 ? cantidadUsada / (1 - merma) : null;
    out.push({
      insumo: (r["Insumo"] || "").trim(),
      codProducto,
      productoIzi: (r["Producto (izi)"] || "").trim(),
      cantidad,
      porciones,
      codInsumo: (r["Cod Insumo"] || "").trim(),
    });
  }
  return out;
}

async function loadInventariosUnitarios(matrizRows) {
  const raw = await fetchCsvObjects(URLS.inventariosUnitarios);
  if (raw.length === 0) return [];
  const headers = Object.keys(raw[0]);
  const idCols = ["Categoria", "Producto"];
  // columnas a ignorar tal como el M: "Vigente" se quita antes del unpivot;
  // "Cod Producto" / "Cantidad usada (g)" (si existen como columnas propias del CSV) no son fechas
  // y se descartan igual que en el M (fallan el cast a fecha y se eliminan como errores).
  const dateCols = headers.filter((h) => h !== "Vigente" && !idCols.includes(h));

  const matrizByInsumo = new Set(matrizRows.map((m) => m.insumo));

  const out = [];
  for (const row of raw) {
    const categoria = row["Categoria"];
    const producto = (row["Producto"] || "").trim();
    for (const col of dateCols) {
      const fecha = toDateOrNull(col);
      if (!fecha) continue; // Attribute que no es fecha -> Table.RemoveRowsWithErrors lo descarta
      let raw2 = row[col];
      if (raw2 === "-") raw2 = "";
      const cantidad = toNumberOrNull(raw2);
      if (cantidad === null) continue; // Filtered Rows1: [Cantidad] <> null
      out.push({
        categoria,
        producto,
        insumo: producto, // relación Inventarios Unitarios GS.Producto -> Matriz.Insumo
        fecha,
        cantidad,
        tieneInsumo: matrizByInsumo.has(producto),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const email = process.env.IZI_EMAIL;
  const password = process.env.IZI_PASSWORD;

  log("Descargando Google Sheets (Ancestral)...");
  const [comprasRowsRaw, salidasRowsRaw, matrizRows] = await Promise.all([
    loadComprasInsumos(),
    loadSalidasMermas(),
    loadMatrizRelaciones(),
  ]);
  log(
    `  Compras Insumos: ${comprasRowsRaw.length} filas | Salidas y Mermas: ${salidasRowsRaw.length} filas | Matriz: ${matrizRows.length} filas`
  );

  log("Descargando Inventarios Unitarios GS (unpivot)...");
  const inventariosRows = await loadInventariosUnitarios(matrizRows);
  log(`  Inventarios Unitarios GS: ${inventariosRows.length} filas (tras unpivot)`);

  let ventasRows = [];
  if (email && password) {
    log("Login + fetch de ventas iZi Ancestral (60 días)...");
    const desde = fmtDate(addDays(todayUtc, -60));
    const hasta = fmtDate(todayUtc);
    try {
      ventasRows = await getVentasAncestral(email, password, { desde, hasta });
      log(`  fac_ventas_Ancestral_iZi: ${ventasRows.length} líneas de factura`);
    } catch (err) {
      log("  ADVERTENCIA: fallo al obtener ventas iZi:", err.message);
    }
  } else {
    log("  IZI_EMAIL / IZI_PASSWORD no configurados: se omite 'Vtas Anc Ins' (quedará en 0).");
  }

  // --- Peso Porcion / PromedioSinOutliers -> Porciones calculadas ---
  const pesoPorcionRows = M.buildPesoPorcion(comprasRowsRaw, todayUtc);
  const promedioMap = M.buildPromedioSinOutliers(pesoPorcionRows);

  const comprasRows = comprasRowsRaw.map((r) => ({
    ...r,
    porcionesCalculadas: M.comprasPorcionesCalculadas(r, promedioMap),
  }));
  const salidasRows = salidasRowsRaw.map((r) => ({
    ...r,
    porcionesCalculadas: M.salidasPorcionesCalculadas(r, promedioMap),
  }));

  // --- Lista de insumos (filtro de página: excluye Entraña, HUARI, en blanco) ---
  const insumosSet = new Set(matrizRows.map((m) => m.insumo).filter((i) => !INSUMOS_EXCLUIDOS.has(i)));
  const insumos = [...insumosSet].sort((a, b) => a.localeCompare(b, "es"));

  // --- Semanas a calcular: últimas 10 semanas completas + la semana actual ---
  const currentMonday = mondayOf(todayUtc);
  const weeks = [];
  for (let i = 0; i < 10; i++) {
    const monday = addDays(currentMonday, -7 * i);
    weeks.push({ weekYear: weekYear(monday), monday, sunday: addDays(monday, 6) });
  }
  // orden descendente ya garantizado por el loop (i=0 es la semana actual)

  log(`Calculando medidas para ${insumos.length} insumos x ${weeks.length} semanas...`);

  const resumenSemanal = [];
  const serieSemanalMap = { Vtas: [], Salidas: [], "Vtas Tot": [], "Compras (Un)": [] };

  for (const w of weeks) {
    for (const insumo of insumos) {
      const invMenos7 = M.invMenos7AncIns(inventariosRows, insumo, w.weekYear, w.monday);
      const compras = M.comprasAncIns(comprasRows, insumo, w.weekYear);
      const vtas = M.vtasAncIns(matrizRows, ventasRows, insumo, w.weekYear);
      const salidas = M.salidasAncIns(salidasRows, insumo, w.weekYear);
      const vtasTot = M.vtasTotAncIns(salidas, vtas);
      const inv = M.invAncIns(inventariosRows, insumo, w.weekYear);
      const cierre = M.cierreAncIns(invMenos7, compras, vtas, salidas);
      const dif = M.difAncIns(inv, cierre);

      resumenSemanal.push({
        insumo,
        weekYear: w.weekYear,
        invMenos7,
        compras,
        vtas,
        salidas,
        vtasTot,
        inv,
        cierre,
        dif,
      });
    }
  }

  // --- Series semanales para el gráfico de barras (últimas 6 semanas, Most Anc Ins=1 en el
  //     original; para el JSON estático agregamos TODOS los insumos por semana, ya que el
  //     filtro "Most" depende del slicer Filtro Dif elegido en el frontend). ---
  const last6 = weeks.slice(0, 6).reverse(); // orden cronológico ascendente para el gráfico
  for (const w of last6) {
    const rowsSemana = resumenSemanal.filter((r) => r.weekYear === w.weekYear);
    serieSemanalMap["Vtas"].push({ weekYear: w.weekYear, valor: sumField(rowsSemana, "vtas") });
    serieSemanalMap["Salidas"].push({ weekYear: w.weekYear, valor: sumField(rowsSemana, "salidas") });
    serieSemanalMap["Vtas Tot"].push({ weekYear: w.weekYear, valor: sumField(rowsSemana, "vtasTot") });
    serieSemanalMap["Compras (Un)"].push({ weekYear: w.weekYear, valor: sumField(rowsSemana, "compras") });
  }

  // --- Detalle diario (tabla "DETALLE DE MOVIMIENTOS POR PRODUCTO") ---
  // Se genera para la semana actual y la anterior (suficiente para navegar el detalle reciente
  // sin inflar demasiado el JSON; el pipeline corre cada 30 min así que se refresca seguido).
  const detalleDiario = [];
  const diasParaDetalle = weeks.slice(0, 2); // semana actual + anterior
  for (const w of diasParaDetalle) {
    for (let d = 0; d < 7; d++) {
      const fecha = addDays(w.monday, d);
      if (fecha.getTime() > todayUtc.getTime()) continue; // no proyectar días futuros
      for (const insumo of insumos) {
        const compras = sum1(
          comprasRows.filter(
            // OJO: bucketing por Fecha1 (única relación activa a Calendar), no por la Fecha fusionada
            // (Fecha Porcion ?? Fecha1) -- ver nota en measures-an-insumos.mjs::comprasAncIns.
            (r) => r.insumo === insumo && r.empresa === "Ancestral" && sameDay(r.fecha1, fecha)
          ).map((r) => r.porcionesCalculadas)
        );
        const salidasDia = sum1(
          salidasRows.filter((r) => r.insumo === insumo && sameDay(r.fecha, fecha)).map((r) => r.porcionesCalculadas)
        );
        const vtasDia = vtasDelDia(matrizRows, ventasRows, insumo, fecha);
        const acumComp = M.acumComprasAncIns(comprasRows, insumo, w.weekYear, fecha);
        const acumSal = M.acumVtasTotAncIns(salidasRows, matrizRows, ventasRows, insumo, w.weekYear, fecha);
        const invEsperado = M.invEspAncIns(inventariosRows, insumo, w.weekYear, acumComp, acumSal);
        const invReal = M.invAncIns(
          inventariosRows.filter((r) => sameDay(r.fecha, fecha)),
          insumo,
          w.weekYear
        );

        // Solo emitimos filas con algún movimiento o conteo real, para no inflar el JSON con ceros.
        if (compras === 0 && salidasDia === 0 && vtasDia === 0 && invReal === null) continue;

        detalleDiario.push({
          insumo,
          fecha: fmtDate(fecha),
          dia: DIA_ABBR[weekdayIso(fecha)],
          compras,
          vtas: vtasDia,
          salidas: salidasDia,
          invEsperado: round2(invEsperado),
          invIni: invReal !== null ? round2(invReal) : null,
          invFin: invReal !== null ? round2(invReal) : null,
          dif: invReal !== null ? round2(invReal - invEsperado) : null,
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
    insumos,
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
      filasCompras: comprasRows.length,
      filasSalidas: salidasRows.length,
      filasMatriz: matrizRows.length,
      filasInventarios: inventariosRows.length,
      filasVentasIzi: ventasRows.length,
    },
  };

  const outDir = path.join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "an-insumos.json");
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  log(`Escrito ${outPath} (${resumenSemanal.length} filas resumen, ${detalleDiario.length} filas detalle)`);
}

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

function vtasDelDia(matrizRows, ventasRows, insumo, fecha) {
  const grupos = M.buildMatrizGrupos(matrizRows, insumo);
  let total = 0;
  for (const { codProductos, porciones } of grupos.values()) {
    const ventasDelProducto = ventasRows.filter((v) => codProductos.has(v.codigoInventario) && sameDay(v.fecha, fecha));
    total += sum1(ventasDelProducto.map((v) => v.cantidadChuleton)) * porciones;
  }
  return round2(total);
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return n === undefined ? null : n;
  return Math.round(n * 100) / 100;
}

function roundRow(r) {
  const out = { ...r };
  for (const k of ["invMenos7", "compras", "vtas", "salidas", "vtasTot", "inv", "cierre", "dif"]) {
    out[k] = round2(out[k]);
  }
  return out;
}

main().catch((err) => {
  console.error("build-an-insumos: ERROR FATAL", err);
  process.exit(1);
});
