// pipeline/lib/omuh-pipeline.mjs
// Loader + orquestador COMPARTIDO para "Om. Insumos" y "Om. Bebidas" (páginas reales del lado
// omuH del PBIX -- ver ANALISIS_PBIX.md secciones 3.2, 4.4, 4.5). Sigue el mismo estilo que
// pipeline/lib/anc-beb-vin-pipeline.mjs (loader parametrizable, fetch + transform en un solo
// lugar) pero aquí la razón de compartir es más profunda que solo el filtro de categoría: las
// medidas de "Omuh Beb" REUTILIZAN literalmente medidas de "Omuh Insumos"
// ([Vtas Anc Izi Om Ins], [Cortesias Om Ins] -- ver pipeline/lib/measures-omuh.mjs), así que
// ambos módulos comparten aquí las mismas fuentes cargadas y las mismas funciones de atribución
// (código de producto -> insumo / producto).
//
// Fuentes nuevas (verificadas contra el TMDL crudo del modelo real Y contra el spreadsheet en
// vivo, no asumidas):
//   - Spreadsheet omuH (Google Sheets, id 2PACX-1vSbk4txiHVLCOPicpvOX9kHQO-VfGLEUSfLwCTe91rvlyUo-
//     NdBKURpRd1JvCFeyhtKWh0vPQFWBJRh) -- OJO: este es un spreadsheet DISTINTO al usado por
//     "Apertura Vinos por Copa"/Inventarios GS de An. Vinos/An. Bebidas (ese es
//     2PACX-1vRxSq2o86st5...), y también distinto al de Ancestral (An. Insumos / Compras Insumos /
//     Matriz_de_Relaciones Ancestral / Pesos platos, que sí siguen siendo
//     2PACX-1vQ75zxBFs61BR...). Confirmado leyendo cada .tmdl individualmente, no copiado del
//     prompt (que sugería reutilizar el de Beb/Vin -- es incorrecto, son tres spreadsheets
//     distintos).
//       - 'Inventarios Unitarios GS omuh' : gid=831896933
//       - 'Compras Insumos omuH'          : gid=1479238698
//       - 'Salidas y Mermas omuH'         : gid=1579941617
//       - 'Inventarios OMUH'              : gid=1483260326
//   - Spreadsheet "Fuente Pedidos ya" (Excel workbook multi-hoja, id
//     2PACX-1vSC58DTA6f4kAYJHQCCKQz0OHBDOtjD6eek0uYcyaQFmWmEoXKgEtaaKStQMtidWy-6XaABEW1xJPJK) --
//     el M original usa Excel.Workbook(...) y selecciona hoja por nombre, pero cada hoja
//     publicada de un Google Sheet también es exportable individualmente como CSV vía su propio
//     gid (confirmado en vivo: /pubhtml expone el gid de cada pestaña), así que evitamos parsear
//     XLSX a mano:
//       - "Ventas Pedidos Ya"  : gid=281878973  -> fac_ventas_omuH_PedidosYa
//       - "Ventas Extras iZi"  : gid=1047262785 -> 'Extras - iZi omuH' (+ 'Vegetarianas')
//   - 'Pesos platos' (spreadsheet Ancestral, gid=178005519 -- MISMO gid/hoja que
//     'Matriz_de_Relaciones Ancestral', ya usado por anc-beb-vin-pipeline.mjs para otro fin; aquí
//     se vuelve a descargar de forma independiente porque ese módulo no se modifica) -- da
//     Cod Producto -> Cantidad (peso de merma por plato), usado para 'fac_ventas_Ancestral_iZi
//     [Cantidad2]' = Cantidad * Merma% (RELATED('Pesos platos'[Cantidad])), IF(Merma%=BLANK(),
//     Cantidad, Cantidad*Merma%).
//   - iZi API: Dim_Producto_iZi (reutiliza izi-api.mjs::fetchDimProducto), facturas de omuH
//     (sucursal 81761, reutiliza fetchFacturas genérico con expand propio -- ventas omuH NO
//     excluye ningún código como sí hace Ancestral con "AN000046", pero SÍ filtra anulada=0),
//     facturas de Ancestral (sucursal 79344, para 'Vtas Anc Izi Om Ins' -- ventas cruzadas: los
//     mismos productos omuH vendidos por el POS de Ancestral), y 'Mov Inv omuh (5)' (reutiliza
//     izi-api.mjs::fetchMovimientosBeb sin cambios, YA usado por "An. Bebidas"/"An. Vinos" para
//     'Cortesias Anc Beb' -- misma tabla real del modelo).

import { fetchCsvObjects, toNumberOrNull, toDateOrNull, fmtDate, addDays } from "./sheets.mjs";
import { weekYear, weekdayIso, mondayOf } from "./calendar.mjs";
import { login, fetchFacturas, fetchDimProducto, fetchMovimientosBeb } from "./izi-api.mjs";
import * as M from "./measures-omuh.mjs";
import { norm } from "./measures-omuh.mjs";

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

const SHEET_OMUH_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSbk4txiHVLCOPicpvOX9kHQO-VfGLEUSfLwCTe91rvlyUo-NdBKURpRd1JvCFeyhtKWh0vPQFWBJRh/pub";

const SHEET_PEDIDOSYA_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSC58DTA6f4kAYJHQCCKQz0OHBDOtjD6eek0uYcyaQFmWmEoXKgEtaaKStQMtidWy-6XaABEW1xJPJK/pub";

const SHEET_ANCESTRAL_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ75zxBFs61BR1asMscyYFYKIblAKmz1QXyIaOMPFophgCXeG22j-iy8GgU6Fl2tIxKkZM1YkDEj21l/pub";

const URLS = {
  inventariosUnitariosOmuh: `${SHEET_OMUH_BASE}?gid=831896933&single=true&output=csv`,
  comprasInsumosOmuh: `${SHEET_OMUH_BASE}?gid=1479238698&single=true&output=csv`,
  salidasMermasOmuh: `${SHEET_OMUH_BASE}?gid=1579941617&single=true&output=csv`,
  inventariosOmuh: `${SHEET_OMUH_BASE}?gid=1483260326&single=true&output=csv`,
  ventasPedidosYa: `${SHEET_PEDIDOSYA_BASE}?gid=281878973&single=true&output=csv`,
  ventasExtrasIzi: `${SHEET_PEDIDOSYA_BASE}?gid=1047262785&single=true&output=csv`,
  pesosPlato: `${SHEET_ANCESTRAL_BASE}?gid=178005519&single=true&output=csv`,
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------------------------
// Dim_Producto_iZi[Categoria Bebidas] -- usada SOLO por 'Inventarios OMUH' (relación real del
// modelo: 'Inventarios OMUH'[Producto] -> Dim_Producto_iZi[Categoria Bebidas], NO -> [Producto]
// directo -- verificado en relationships.tmdl). Chop Cerveza / Chop Cerveza 2X1 se consolidan
// bajo "Cerveza Paceña (para chops)"; el resto de productos usa su propio nombre tal cual.
// ---------------------------------------------------------------------------------------------
function categoriaBebidas(producto) {
  if (producto === "Chop Cerveza" || producto === "Chop Cerveza 2X1") return "Cerveza Paceña (para chops)";
  return producto;
}

// ---------------------------------------------------------------------------------------------
// Carga: Inventarios Unitarios GS omuh (unpivot CSV ancho -> largo, idéntico patrón a
// 'Inventarios Unitarios GS' de An. Insumos, pero SIN el filtro Vigente="Si", igual que el M
// original -- ver comentario en build-an-insumos.mjs::loadInventariosUnitarios).
// ---------------------------------------------------------------------------------------------
async function loadInventariosUnitariosOmuh() {
  const raw = await fetchCsvObjects(URLS.inventariosUnitariosOmuh);
  if (raw.length === 0) return [];
  const headers = Object.keys(raw[0]);
  const idCols = ["Categoria", "Producto"];
  const dateCols = headers.filter((h) => h !== "Vigente" && !idCols.includes(h));

  const out = [];
  for (const row of raw) {
    const producto = (row["Producto"] || "").trim();
    // 'Categoria 3' calculada de esta tabla (SWITCH TRUE(), sin fallback -- BLANK() si no matchea
    // ninguno de los 3 nombres reales de Tabla[Insumo]).
    let insumo = null;
    const n = norm(producto);
    if (n === "carne molida") insumo = "Carne Molida 130g";
    else if (n === "pechuga de pollo") insumo = "Pechuga de Pollo";
    else if (n === "pesca amazonica" || n === "pesca amazónica") insumo = "Pesca Amazonica";
    for (const col of dateCols) {
      const fecha = toDateOrNull(col);
      if (!fecha) continue;
      let val = row[col];
      if (val === "-") val = "";
      const cantidad = toNumberOrNull(val);
      if (cantidad === null) continue;
      out.push({ producto, insumo, fecha, cantidad });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: Compras Insumos omuH
// ---------------------------------------------------------------------------------------------
async function loadComprasInsumosOmuh() {
  const raw = await fetchCsvObjects(URLS.comprasInsumosOmuh);
  const out = [];
  for (const r of raw) {
    const fecha1 = toDateOrNull(r["Fecha"]); // M: rename "Fecha" (crudo) -> "Fecha1"
    const fechaPorcion = toDateOrNull(r["Fecha Porcion"]);
    if (!fecha1) continue; // M: Filtered Rows2 [Fecha] <> null and <> ""
    const producto = (r["Producto"] || "").trim();
    const codProducto = (r["Cod Producto"] || "").trim();
    const producto2 = M.comprasProducto2(producto);
    out.push({
      fecha1,
      fechaPorcion,
      codProducto,
      producto,
      producto2,
      insumo: M.insumoPorComprasProducto2(producto),
      porciones: toNumberOrNull(r["Porciones"]),
      cantidad: toNumberOrNull(r["Cantidad Compra"] ?? r["Cantidad"]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: Salidas y Mermas omuH
// ---------------------------------------------------------------------------------------------
async function loadSalidasMermasOmuh(dimProductoRows) {
  const raw = await fetchCsvObjects(URLS.salidasMermasOmuh);
  // Para el join case-insensitive de Salidas -> Dim_Producto_iZi[Producto] (Om. Beb).
  const productoByNorm = new Map();
  for (const p of dimProductoRows) {
    const key = norm(p.producto);
    if (!productoByNorm.has(key)) productoByNorm.set(key, p.producto);
  }

  const out = [];
  for (const r of raw) {
    const fecha = toDateOrNull(r["Fecha"]);
    if (!fecha) continue;
    const producto = (r["Producto"] || "").trim();
    const cat3 = M.salidasCategoria3(producto);
    const producto2 = productoByNorm.get(norm(cat3)) || null; // match a Dim_Producto_iZi[Producto] (Om. Beb)
    out.push({
      fecha,
      producto,
      cat3,
      insumo: M.insumoPorSalidasProducto(producto),
      productoOmBeb: producto2,
      porciones: toNumberOrNull(r["Porciones"]),
      peso: toNumberOrNull(r["Peso (g / ml)"]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: Inventarios OMUH
// ---------------------------------------------------------------------------------------------
async function loadInventariosOmuh() {
  const raw = await fetchCsvObjects(URLS.inventariosOmuh);
  if (raw.length === 0) return [];
  const headers = Object.keys(raw[0]);
  const idCols = ["Categoria", "Producto", "Cod Producto"];
  const dateCols = headers.filter((h) => h !== "Vigente" && !idCols.includes(h));

  const out = [];
  for (const row of raw) {
    if ((row["Vigente"] || "").trim() !== "Si") continue; // M: Filtered Rows [Vigente]="Si"
    const producto = (row["Producto"] || "").trim();
    for (const col of dateCols) {
      const fecha = toDateOrNull(col);
      if (!fecha) continue;
      let val = row[col];
      if (val === "-") val = "";
      const cantidad = toNumberOrNull(val);
      if (cantidad === null) continue;
      out.push({ producto, fecha, cantidad });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: Pesos platos (Ancestral) -- Cod Producto -> Cantidad (peso de merma), usado para
// fac_ventas_Ancestral_iZi[Cantidad2].
// ---------------------------------------------------------------------------------------------
async function loadPesosPlatoMap() {
  const raw = await fetchCsvObjects(URLS.pesosPlato);
  const map = new Map();
  for (const r of raw) {
    const codProducto = (r["Cod Producto"] || "").trim();
    if (codProducto === "") continue;
    const cantidadUsada = toNumberOrNull(r["Cantidad usada (kg o u)"] ?? r["Cantidad usada"]);
    if (cantidadUsada === null) continue;
    let mermaRaw = r["Merma (%)"] ?? r["Merma %"] ?? r["Merma"];
    let merma = 0;
    if (mermaRaw !== undefined && mermaRaw !== null && String(mermaRaw).trim() !== "") {
      const s = String(mermaRaw).trim().replace("%", "");
      const n = Number(s.replace(",", "."));
      merma = Number.isFinite(n) ? n : 0;
    }
    if (merma === 1) continue;
    const cantidad = cantidadUsada / (1 - merma);
    map.set(codProducto, cantidad); // último valor gana si hay duplicados (no se observaron en la muestra)
  }
  return map;
}

// ---------------------------------------------------------------------------------------------
// Carga: ventas iZi (omuH y Ancestral) -- réplica de fac_ventas_omuH_iZi / fac_ventas_Ancestral_iZi
// ---------------------------------------------------------------------------------------------

/** fac_ventas_omuH_iZi: igual patrón que expandFacturasAncestral (izi-api.mjs) pero SIN excluir
 *  "AN000046" y filtrando anulada=0 (verificado en fac_ventas_omuH_iZi.tmdl). */
function expandFacturasOmuh(facturas) {
  const out = [];
  for (const f of facturas) {
    if (!f.fechaPago) continue;
    if (Number(f.anulada) === 1) continue; // M: Filtered Rows [anulada] = 0
    const utcDate = new Date(f.fechaPago);
    if (Number.isNaN(utcDate.getTime())) continue;
    const bolivia = new Date(utcDate.getTime() - 4 * 3600 * 1000);
    const fecha = new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
    const items = Array.isArray(f.listaItems) ? f.listaItems : [];
    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad)) continue;
      out.push({ fecha, producto: item.articulo, cantidad, codigoInventario: item.codigoInventario });
    }
  }
  return out;
}

/** fac_ventas_Ancestral_iZi con Cantidad2 (= Cantidad * Merma%, RELATED('Pesos platos'[Cantidad])
 *  por codigoInventario; IF(Merma%=BLANK(), Cantidad, Cantidad*Merma%)) -- necesario para
 *  'Vtas Anc Izi Om Ins'. NO reutiliza izi-api.mjs::expandFacturasAncestral porque esa función no
 *  calcula Cantidad2 (no lo necesitaba "An. Bebidas"/"An. Vinos"). */
function expandFacturasAncestralConCantidad2(facturas, pesosPlatoMap) {
  const out = [];
  for (const f of facturas) {
    if (!f.fechaPago) continue;
    const utcDate = new Date(f.fechaPago);
    if (Number.isNaN(utcDate.getTime())) continue;
    const bolivia = new Date(utcDate.getTime() - 4 * 3600 * 1000);
    const fecha = new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
    const items = Array.isArray(f.listaItems) ? f.listaItems : [];
    for (const item of items) {
      const codigoInventario = item.codigoInventario;
      if (codigoInventario === "AN000046") continue;
      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad)) continue;
      const merma = pesosPlatoMap.get(codigoInventario);
      const cantidad2 = merma === undefined ? cantidad : cantidad * merma;
      out.push({ fecha, codigoInventario, cantidad, cantidad2 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: fac_ventas_omuH_PedidosYa -- réplica pragmática del parseo de "Artículos" (combos entre
// corchetes) del M de 'Pedidos Ya - items' + normalización/alias + join a Dim_Producto_iZi.
// ---------------------------------------------------------------------------------------------

const LIMPIEZA_REGLAS = [
  ["]", ""],
  [" 600 ml", ""],
  [" 600ml", ""],
  [" 500 ml", ""],
  [" 500ml", ""],
  ["-", " "],
  ["sin azucar", "zero"],
  ["coca cola zero", "coca zero"],
  ["gaseosa ", ""],
  ["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"],
];

function limpiarProducto(txt) {
  let base = String(txt || "").toLowerCase();
  for (const [buscar, reemplazar] of LIMPIEZA_REGLAS) base = base.split(buscar).join(reemplazar);
  base = base.split(" ").filter((w) => w !== "").join(" ");
  return properCase(base.trim());
}

function properCase(txt) {
  return String(txt || "")
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function quitarTildes(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const ALIAS_PRODUCTO = new Map([
  ["burger clasica", "hamburguesa clasica"],
  ["burger parrillera", "hamburguesa parrillera"],
  ["burger tocino casero", "hamburguesa tocino casero"],
  ["burger tres quesos", "hamburguesa tres quesos"],
  ["burger katz pastrami", "hamburguesa pastrami"],
  ["cheeseburger", "hamburguesa cheese burger"],
  ["papas tradicionales", "papas fritas tradicionales"],
  ["combo chesse burger", "hamburguesa cheese burger"],
  ["combo cheeseburger", "hamburguesa cheese burger"],
  ["combo sando tartara", "sando tartara"],
]);

/** Réplica de SplitTopLevel: separa por comas que están FUERA de corchetes [ ]. */
function splitTopLevel(txt) {
  const chars = Array.from(txt);
  let depth = 0;
  let current = "";
  const parts = [];
  for (const ch of chars) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Réplica de GetQtyProduct: cantidad = primeros 1-2 caracteres si son numéricos, si no qty=1 y
 *  se usa el texto completo. */
function getQtyProduct(t) {
  const trimmed = t.trim();
  const first2 = trimmed.slice(0, 2).trim();
  const qtyNumber = Number(first2);
  const hasQty = first2 !== "" && Number.isFinite(qtyNumber) && /^\d+$/.test(first2);
  const firstSpace = trimmed.indexOf(" ");
  const afterFirstSpace = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const qty = hasQty ? qtyNumber : 1;
  const productRaw = hasQty ? afterFirstSpace : trimmed;
  return { cantidad: qty, producto: productRaw.toLowerCase() };
}

/** Réplica de ParseItemFull: un ítem "1 Burger X [1 Fanta, 1 Papas]" -> [Principal, ...Combo]. */
function parseItemFull(itemText) {
  const trimmed = itemText.trim();
  const bracketStart = trimmed.indexOf("[");
  const hasBracket = bracketStart !== -1;
  const bracketEnd = hasBracket ? trimmed.lastIndexOf("]") : -1;
  const mainPart = (hasBracket ? trimmed.slice(0, bracketStart) : trimmed).trim();
  const bracketContent = hasBracket && bracketEnd > bracketStart ? trimmed.slice(bracketStart + 1, bracketEnd).trim() : "";
  const mainQP = getQtyProduct(mainPart);
  const out = [{ cantidad: mainQP.cantidad, producto: mainQP.producto }];
  if (bracketContent) {
    const normalized = bracketContent.split("+").join(",");
    const comboRaw = normalized.split(",").map((s) => s.trim()).filter((s) => s !== "");
    for (const c of comboRaw) {
      const qp = getQtyProduct(c);
      out.push({ cantidad: qp.cantidad, producto: qp.producto });
    }
  }
  return out;
}

async function loadVentasPedidosYa(dimProductoRows) {
  const raw = await fetchCsvObjects(URLS.ventasPedidosYa);

  // Índice normalizado de Dim_Producto_iZi (Producto_ = Proper(Producto), normalizado sin tildes).
  const dimByNorm = new Map();
  for (const p of dimProductoRows) {
    const key = quitarTildes(properCase(p.producto));
    if (!dimByNorm.has(key)) dimByNorm.set(key, p);
  }

  const out = [];
  for (const r of raw) {
    if (r["Estado del pedido"] !== "Entregado") continue;
    const articulos = r["Artículos"];
    if (!articulos) continue;
    const fecha = toDateOrNull(r["Fecha del pedido"]);
    if (!fecha) continue;

    for (const item of splitTopLevel(articulos)) {
      for (const sub of parseItemFull(item)) {
        const productoLimpio = limpiarProducto(sub.producto);
        const normalizado = quitarTildes(productoLimpio);
        const match = quitarTildes(ALIAS_PRODUCTO.get(normalizado) || normalizado);
        const dim = dimByNorm.get(match);
        if (!dim) continue; // sin match en Dim_Producto_iZi -> descartada (igual que LeftOuter sin match filtrado después)
        if (dim.codProducto.includes("ANC")) continue; // M: not Text.Contains([Cod. Producto],"ANC")
        out.push({
          fecha,
          cantidad: sub.cantidad,
          producto: dim.producto,
          codProducto: dim.codProducto,
          insumo: M.insumoPorCodProducto(dim.codProducto),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Carga: 'Extras - iZi omuH' (+ 'Vegetarianas')
// ---------------------------------------------------------------------------------------------

async function loadExtrasIziOmuh(dimProductoRows) {
  const raw = await fetchCsvObjects(URLS.ventasExtrasIzi);

  const dimByProducto = new Map(); // exacto (para Vegetarianas: join por Producto tal cual, M usa {"Producto"}={"Producto"})
  const dimByNormProducto = new Map(); // case/acento-insensible (para el join de Value, colación por defecto de DAX)
  for (const p of dimProductoRows) {
    if (!dimByProducto.has(p.producto)) dimByProducto.set(p.producto, p);
    const key = norm(p.producto);
    if (!dimByNormProducto.has(key)) dimByNormProducto.set(key, p);
  }

  const out = [];

  // --- Partición principal: unpivot de Variable 1 / Variable 2 (cada una split por coma) ---
  for (const r of raw) {
    if (r["Estado de la Comanda"] !== "Facturada") continue;
    const fecha = toDateOrNull(r["Fecha"]);
    if (!fecha) continue;
    const cantidad1 = toNumberOrNull(r["Cantidad"]);
    if (cantidad1 === null) continue;
    const notas = r["Notas"] || "";
    const v1 = r["Variable 1"] || "";
    const v2 = r["Variable 2"] || "";
    const esVeg =
      notas &&
      norm(notas).includes("veg") &&
      (norm(v1).includes("carne extra") || norm(v2).includes("carne extra"));
    const cantidad = esVeg ? cantidad1 * -1 : cantidad1;

    const valores = [];
    for (const campo of [v1, v2]) {
      for (const part of String(campo).split(",")) {
        let value = part.trim();
        if (value === "" || value === "-") continue;
        // M: Table.ReplaceValue(...,"Huari Tradicional","Cerveza Huari",Replacer.ReplaceText,{"Value"})
        // -- reemplazo de subcadena (no exacto) ANTES del join a Dim_Producto_iZi.
        value = value.split("Huari Tradicional").join("Cerveza Huari");
        valores.push(value);
      }
    }
    for (const value of valores) {
      // Join case/acento-insensible contra Dim_Producto_iZi[Producto] (colación por defecto de
      // DAX) -- 'value' puede ser un código OMU00xxx (no matchea, se usa tal cual) o un nombre de
      // producto real (bebida) con distinta capitalización que en el catálogo.
      const dim = dimByNormProducto.get(norm(value));
      out.push({ fecha, cantidad, value, producto: dim ? dim.producto : value });
    }
  }

  // --- Vegetarianas: por Producto/Cantidad/Notas directo (SIN filtrar Estado de la Comanda -- así
  //     es el M original), join exacto a Dim_Producto_iZi[Producto], filtrado a Burgers/Sandos,
  //     Cantidad = Notas contiene "veg" ? -Cantidad1 : Cantidad1, y sólo se queda con Cantidad IN
  //     {-1,-2,-3} (extrae específicamente los ajustes vegetarianos pequeños). ---
  for (const r of raw) {
    const producto = (r["Producto"] || "").trim();
    const dim = dimByProducto.get(producto);
    if (!dim) continue;
    if (dim.categoria !== "1. Burgers" && dim.categoria !== "2. Sandos") continue;
    const fecha = toDateOrNull(r["Fecha"]);
    if (!fecha) continue;
    const cantidad1 = toNumberOrNull(r["Cantidad"]);
    if (cantidad1 === null) continue;
    const notas = r["Notas"] || "";
    const cantidad = notas && norm(notas).includes("veg") ? cantidad1 * -1 : cantidad1;
    if (cantidad !== -1 && cantidad !== -2 && cantidad !== -3) continue;
    out.push({ fecha, cantidad, value: dim.codProducto, producto: dim.producto });
  }

  return out.map((r) => ({
    ...r,
    insumo: M.insumoPorExtrasValue(r.value),
  }));
}

// ---------------------------------------------------------------------------------------------
// Orquestador: carga TODAS las fuentes compartidas de una vez.
// ---------------------------------------------------------------------------------------------

async function loadAllSources(config) {
  const { email = process.env.IZI_EMAIL, password = process.env.IZI_PASSWORD } = config;
  const today = config.todayUtc || new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const warnings = [];

  log("omuh-pipeline: descargando Google Sheets (omuH + Pesos platos)...");
  const [inventariosUnitariosRows, comprasRows, inventariosOmuhRaw, pesosPlatoMap] = await Promise.all([
    loadInventariosUnitariosOmuh(),
    loadComprasInsumosOmuh(),
    loadInventariosOmuh(),
    loadPesosPlatoMap(),
  ]);
  log(
    `  Inventarios Unitarios GS omuh: ${inventariosUnitariosRows.length} filas | Compras Insumos omuH: ${comprasRows.length} filas | ` +
      `Inventarios OMUH: ${inventariosOmuhRaw.length} filas | Pesos platos: ${pesosPlatoMap.size} productos`
  );

  let dimProductoRows = [];
  let ventasIziOmuhRaw = [];
  let ventasAncIziRaw = [];
  let movInvRows = [];
  let salidasRows = [];
  let ventasPyRows = [];
  let extrasRows = [];

  if (email && password) {
    log("omuh-pipeline: login iZi + fetch de Dim_Producto_iZi / ventas / movimientos...");
    try {
      const token = await login(email, password);
      dimProductoRows = await fetchDimProducto(token);
      log(`  Dim_Producto_iZi: ${dimProductoRows.length} productos`);

      const desdeVentas = fmtDate(addDays(todayUtc, -60));
      const hastaVentas = fmtDate(todayUtc);
      const [facturasOmuh, facturasAnc] = await Promise.all([
        fetchFacturas(token, { desde: desdeVentas, hasta: hastaVentas, contribuyente: "79818", sucursal: "81761" }),
        fetchFacturas(token, { desde: desdeVentas, hasta: hastaVentas, contribuyente: "79818", sucursal: "79344" }),
      ]);
      ventasIziOmuhRaw = expandFacturasOmuh(facturasOmuh);
      ventasAncIziRaw = expandFacturasAncestralConCantidad2(facturasAnc, pesosPlatoMap);
      log(`  fac_ventas_omuH_iZi: ${ventasIziOmuhRaw.length} líneas | fac_ventas_Ancestral_iZi: ${ventasAncIziRaw.length} líneas`);

      const desdeMov = fmtDate(addDays(todayUtc, -31));
      movInvRows = await fetchMovimientosBeb(token, { desde: desdeMov, hasta: fmtDate(todayUtc) });
      log(`  Mov Inv omuh (5): ${movInvRows.length} filas`);

      log("omuh-pipeline: descargando Salidas y Mermas omuH / PedidosYa / Extras iZi...");
      [salidasRows, ventasPyRows, extrasRows] = await Promise.all([
        loadSalidasMermasOmuh(dimProductoRows),
        loadVentasPedidosYa(dimProductoRows),
        loadExtrasIziOmuh(dimProductoRows),
      ]);
      log(
        `  Salidas y Mermas omuH: ${salidasRows.length} filas | fac_ventas_omuH_PedidosYa: ${ventasPyRows.length} filas | ` +
          `Extras - iZi omuH: ${extrasRows.length} filas`
      );
    } catch (err) {
      warnings.push(`Fallo al obtener datos de iZi: ${err.message}`);
      log("  ADVERTENCIA:", err.message);
    }
  } else {
    warnings.push("IZI_EMAIL / IZI_PASSWORD no configurados: Vtas/Cortesias/PedidosYa/Extras/Dim_Producto quedan vacíos.");
    log("  IZI_EMAIL / IZI_PASSWORD no configurados: se omiten fuentes de la API iZi y las que dependen de Dim_Producto_iZi.");
  }

  // Atribución de insumo/producto en las fuentes que dependen de Dim_Producto_iZi (necesitan el
  // catálogo, por eso se hace después del login).
  const codMap = new Map(dimProductoRows.map((p) => [p.codProducto, p]));
  const ventasIziOmuhRows = ventasIziOmuhRaw.map((r) => {
    const dim = codMap.get(r.codigoInventario);
    return { ...r, insumo: M.insumoPorCodProducto(r.codigoInventario), producto: dim ? dim.producto : r.producto };
  });
  const ventasAncIziRows = ventasAncIziRaw.map((r) => {
    const dim = codMap.get(r.codigoInventario);
    return { ...r, insumo: M.insumoPorCodProducto(r.codigoInventario), producto: dim ? dim.producto : null };
  });
  const movInvOmuhRows = movInvRows.map((r) => {
    const dim = codMap.get(r.codigoInventario);
    return { ...r, insumo: M.insumoPorCodProducto(r.codigoInventario), producto: dim ? dim.producto : null };
  });
  const inventariosOmuhRows = inventariosOmuhRaw.map((r) => ({
    ...r,
    // 'Inventarios OMUH'[Producto] se relaciona con Dim_Producto_iZi[Categoria Bebidas], no
    // [Producto] directo -- ver categoriaBebidas() arriba.
    categoriaBebidas: r.producto,
  }));

  return {
    todayUtc,
    warnings,
    dimProductoRows,
    inventariosUnitariosRows,
    comprasRows,
    inventariosOmuhRows,
    salidasRows,
    ventasIziOmuhRows,
    ventasAncIziRows,
    movInvOmuhRows,
    ventasPyRows,
    extrasRows,
  };
}

function weeksToCalc(todayUtc, count) {
  const currentMonday = mondayOf(todayUtc);
  const weeks = [];
  for (let i = 0; i < count; i++) {
    const monday = addDays(currentMonday, -7 * i);
    weeks.push({ weekYear: weekYear(monday), monday, sunday: addDays(monday, 6) });
  }
  return weeks;
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return n === undefined ? null : n;
  return Math.round(n * 100) / 100;
}

function sameDay(a, b) {
  return a && b && a.getTime() === b.getTime();
}

// ---------------------------------------------------------------------------------------------
// Om. Insumos (agrupado por Tabla[Insumo] -- sólo 3 valores, ver measures-omuh.mjs)
// ---------------------------------------------------------------------------------------------

export async function buildOmInsumosData(config = {}) {
  const src = await loadAllSources(config);
  const { todayUtc } = src;
  const weeks = weeksToCalc(todayUtc, 10);
  const insumos = M.TABLA_INSUMOS;

  const resumenSemanal = [];
  for (const w of weeks) {
    for (const insumo of insumos) {
      const invMenos7 = M.invMenos7OmIns(src.inventariosUnitariosRows, insumo, w.weekYear, w.monday);
      const compras = M.comprasOmIns(src.comprasRows, insumo, w.weekYear);
      const inv = M.invOmIns(src.inventariosUnitariosRows, insumo, w.weekYear);
      const salidas = M.salidasOmIns(src.salidasRows, insumo, w.weekYear);
      const cortesias = M.cortesiasOmIns(src.movInvOmuhRows, insumo, w.weekYear);
      const vtasIzi = M.vtasIziOmIns(src.ventasIziOmuhRows, insumo, w.weekYear);
      const vtasPY = M.vtasPyOmIns(src.ventasPyRows, insumo, w.weekYear);
      const vtasExt = M.vtasExtOmIns(src.extrasRows, insumo, w.weekYear);
      const vtasVegg = M.vtasVeggOmIns(src.extrasRows, insumo, w.weekYear);
      const vtasAncIzi = M.vtasAncIziOmIns(src.ventasAncIziRows, insumo, w.weekYear);
      const vtas = M.vtasOmIns(vtasIzi, vtasPY, cortesias, salidas, vtasAncIzi, vtasExt, vtasVegg);
      const cierre = M.cierreOmIns(invMenos7, compras, vtas);
      const dif = M.difOmIns(inv, cierre);

      resumenSemanal.push({
        insumo,
        weekYear: w.weekYear,
        invMenos7: round2(invMenos7),
        compras: round2(compras),
        vtasIzi: round2(vtasIzi),
        vtasAnc: round2(vtasAncIzi),
        vtasPY: round2(vtasPY),
        vtasExt: round2(vtasExt),
        vtasVegg: round2(vtasVegg),
        cortesias: round2(cortesias),
        salidas: round2(salidas),
        vtasTot: round2(vtas),
        inv: round2(inv),
        cierre: round2(cierre),
        dif: round2(dif),
      });
    }
  }

  const last6 = weeks.slice(0, 6).reverse();
  const FIELD_BY_LABEL = {
    Vtas: "vtasIzi",
    "Vtas Anc": "vtasAnc",
    "Vtas PY": "vtasPY",
    "Vtas Ext.": "vtasExt",
    Cortesias: "cortesias",
    Salidas: "salidas",
    "Vtas Tot.": "vtasTot",
    Compras: "compras",
  };
  const serieSemanalMap = {};
  for (const label of Object.keys(FIELD_BY_LABEL)) serieSemanalMap[label] = [];
  for (const w of last6) {
    const rowsSemana = resumenSemanal.filter((r) => r.weekYear === w.weekYear);
    for (const [label, field] of Object.entries(FIELD_BY_LABEL)) {
      const total = rowsSemana.reduce((acc, r) => acc + (r[field] || 0), 0);
      serieSemanalMap[label].push({ weekYear: w.weekYear, valor: round2(total) });
    }
  }

  // Detalle diario (semana actual + anterior) -- mismo patrón que An. Insumos, simplificado (ver
  // README / comentario en js/pages/om-insumos.js sobre la simplificación deliberada del frontend
  // de esta página: el PBIX original tiene 3 pivotTables, acá 1 resumen + 1 gráfico + 1 detalle).
  const detalleDiario = [];
  for (const w of weeks.slice(0, 2)) {
    for (let d = 0; d < 7; d++) {
      const fecha = addDays(w.monday, d);
      if (fecha.getTime() > todayUtc.getTime()) continue;

      for (const insumo of insumos) {
        const comprasDia = round2(
          src.comprasRows
            .filter((r) => r.insumo === insumo && sameDay(r.fecha1, fecha))
            .reduce((a, r) => a + (r.porciones || 0), 0)
        );
        const salidasDia = round2(
          src.salidasRows.filter((r) => r.insumo === insumo && sameDay(r.fecha, fecha)).reduce((a, r) => a + (r.porciones || 0), 0)
        );
        const vtasIziDia = round2(
          src.ventasIziOmuhRows.filter((r) => r.insumo === insumo && sameDay(r.fecha, fecha)).reduce((a, r) => a + factorForDay(r), 0)
        );
        const cortesiasDia = round2(
          M.cortesiasOmuh(src.movInvOmuhRows.filter((r) => r.insumo === insumo && sameDay(r.fecha, fecha)))
        );
        const vtasTotDia = round2(vtasIziDia + cortesiasDia + salidasDia);

        if (comprasDia === 0 && salidasDia === 0 && vtasIziDia === 0 && cortesiasDia === 0) continue;

        const hastaFecha = (r) => r.fecha && r.fecha.getTime() <= fecha.getTime();
        const acumComp = round2(
          src.comprasRows
            .filter((r) => r.insumo === insumo && r.fecha1 && weekYear(r.fecha1) === w.weekYear && hastaFecha({ fecha: r.fecha1 }))
            .reduce((a, r) => a + (r.porciones || 0), 0)
        );
        const acumVtasIzi = src.ventasIziOmuhRows
          .filter((r) => r.insumo === insumo && weekYear(r.fecha) === w.weekYear && hastaFecha(r))
          .reduce((a, r) => a + factorForDay(r), 0);
        const acumSalidas = src.salidasRows
          .filter((r) => r.insumo === insumo && weekYear(r.fecha) === w.weekYear && hastaFecha(r))
          .reduce((a, r) => a + (r.porciones || 0), 0);
        const acumCortesias = M.cortesiasOmuh(
          src.movInvOmuhRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === w.weekYear && hastaFecha(r))
        );
        const acumSal = round2(acumVtasIzi + acumSalidas + acumCortesias);

        const invMenos7Semana = M.invMenos7OmIns(src.inventariosUnitariosRows, insumo, w.weekYear, w.monday);
        const invEsperado = round2(Math.max(0, (invMenos7Semana ?? 0) + acumComp - acumSal));

        const invReal = M.invOmIns(
          src.inventariosUnitariosRows.filter((r) => sameDay(r.fecha, fecha)),
          insumo,
          w.weekYear
        );

        detalleDiario.push({
          insumo,
          fecha: fmtDate(fecha),
          dia: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][fecha.getUTCDay()],
          compras: comprasDia,
          vtas: vtasTotDia,
          salidas: salidasDia,
          invEsperado,
          invFin: invReal !== null ? round2(invReal) : null,
          dif: invReal !== null ? round2(invReal - invEsperado) : null,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rangoFechas: { desde: fmtDate(weeks[weeks.length - 1].monday), hasta: fmtDate(todayUtc) },
    insumos,
    semanas: weeks.map((w) => w.weekYear),
    semanasInfo: weeks.map((w) => ({ weekYear: w.weekYear, desde: fmtDate(w.monday), hasta: fmtDate(w.sunday) })),
    resumenSemanal,
    detalleDiario,
    serieSemanal: serieSemanalMap,
    meta: {
      ventasIziDisponibles: src.ventasIziOmuhRows.length > 0,
      filasDimProducto: src.dimProductoRows.length,
      filasInventariosUnitarios: src.inventariosUnitariosRows.length,
      filasCompras: src.comprasRows.length,
      filasSalidas: src.salidasRows.length,
      filasVentasIzi: src.ventasIziOmuhRows.length,
      filasVentasPY: src.ventasPyRows.length,
      filasExtras: src.extrasRows.length,
      filasMovInv: src.movInvOmuhRows.length,
      filasVentasAncIzi: src.ventasAncIziRows.length,
      warnings: src.warnings,
    },
  };
}

function factorForDay(row) {
  if (row.producto === "Chop Cerveza") return row.cantidad * 0.75;
  if (row.producto === "Chop Cerveza 2X1") return row.cantidad * 1.5;
  if (["OMU00052", "OMU00053", "OMU00086"].includes(row.codigoInventario)) return row.cantidad * 0.5;
  if (row.codigoInventario === "OMU00068") return 0;
  return row.cantidad;
}

/** Mismo SWITCH que factorVtasIziOmBeb en measures-omuh.mjs (incluye OMU00071), usado acá para el
 *  detalle diario de Om. Bebidas sin tener que re-filtrar por semana completa. */
function factorVtasIziBebForDay(row) {
  if (row.producto === "Chop Cerveza") return row.cantidad * 0.75;
  if (row.producto === "Chop Cerveza 2X1") return row.cantidad * 1.5;
  if (["OMU00052", "OMU00053", "OMU00071", "OMU00086"].includes(row.codigoInventario)) return row.cantidad * 0.5;
  if (row.codigoInventario === "OMU00068") return 0;
  return row.cantidad;
}

// ---------------------------------------------------------------------------------------------
// Om. Bebidas (agrupado por Dim_Producto_iZi[Producto], filtrado a categorías de bebidas)
// ---------------------------------------------------------------------------------------------

const CATEGORIAS_BEBIDAS_OMUH = ["5. Bebidas alcohólicas", "CERVEZA", "GASEOSA", "4. Bebidas no alcohólicas"];

export async function buildOmBebidasData(config = {}) {
  const src = await loadAllSources(config);
  const { todayUtc } = src;
  const weeks = weeksToCalc(todayUtc, 10);

  const catSet = new Set(CATEGORIAS_BEBIDAS_OMUH);
  const productos = [...new Set(src.dimProductoRows.filter((p) => catSet.has(p.categoria)).map((p) => p.producto))].sort(
    (a, b) => a.localeCompare(b, "es")
  );
  const codByProducto = new Map(src.dimProductoRows.map((p) => [p.producto, p.codProducto]));

  const resumenSemanal = [];
  for (const w of weeks) {
    for (const producto of productos) {
      const codProducto = codByProducto.get(producto);
      const catBeb = categoriaBebidas(producto);

      const invMenos7 = M.invMenos7OmBeb(
        src.inventariosOmuhRows.filter((r) => r.categoriaBebidas === catBeb),
        catBeb,
        w.weekYear,
        w.monday
      );
      const inv = M.invOmBeb(src.inventariosOmuhRows.filter((r) => r.categoriaBebidas === catBeb), catBeb, w.weekYear);
      const compras = M.comprasOmBeb(src.comprasRows, codProducto, w.weekYear);
      const vtasExt = M.vtasExtOmBeb(src.extrasRows, producto, w.weekYear);
      const vtasPY = M.vtasPyOmBeb(src.ventasPyRows, producto, w.weekYear);
      const vtasIzi = M.vtasIziOmBeb(src.ventasIziOmuhRows, producto, w.weekYear);
      const vtasAncIzi = M.vtasAncIziOmuh(
        src.ventasAncIziRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear)
      );
      const salidas = M.salidasOmBeb(src.salidasRows.map((r) => ({ ...r, producto: r.productoOmBeb })), producto, w.weekYear);
      const ventasTot = M.ventasTotOmBeb(vtasIzi, vtasPY, vtasExt, vtasAncIzi, salidas);
      const cortesias = M.cortesiasOmuh(
        src.movInvOmuhRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear)
      );
      const cierre = M.cierreOmBeb(invMenos7, compras, ventasTot, cortesias);
      const dif = M.difOmBeb(inv, cierre);

      resumenSemanal.push({
        producto,
        weekYear: w.weekYear,
        invMenos7: round2(invMenos7),
        compras: round2(compras),
        vtasIzi: round2(vtasIzi),
        vtasExt: round2(vtasExt),
        vtasPY: round2(vtasPY),
        vtasAnc: round2(vtasAncIzi),
        salidas: round2(salidas),
        vtasTot: round2(ventasTot),
        inv: round2(inv),
        cierre: round2(cierre),
        dif: round2(dif),
      });
    }
  }

  const last6 = weeks.slice(0, 6).reverse();
  const FIELD_BY_LABEL = {
    Vtas: "vtasIzi",
    "Vtas Ext.": "vtasExt",
    "Vtas PY": "vtasPY",
    "Vtas Tot.": "vtasTot",
    Compras: "compras",
  };
  const serieSemanalMap = {};
  for (const label of Object.keys(FIELD_BY_LABEL)) serieSemanalMap[label] = [];
  for (const w of last6) {
    const rowsSemana = resumenSemanal.filter((r) => r.weekYear === w.weekYear);
    for (const [label, field] of Object.entries(FIELD_BY_LABEL)) {
      const total = rowsSemana.reduce((acc, r) => acc + (r[field] || 0), 0);
      serieSemanalMap[label].push({ weekYear: w.weekYear, valor: round2(total) });
    }
  }

  // --- Detalle diario (semana actual + anterior), mismo patrón que An. Bebidas: "Inv. Vis." sólo
  //     tiene valor lunes (=Inv.-7) y domingo (=Inv.) porque el conteo físico de Inventarios OMUH
  //     es semanal, no diario (réplica de 'Inv. Vis. Beb Om'); "Inv. Día Esp." acumula
  //     compras/ventas día a día sobre el promedio de la semana anterior (réplica de
  //     'Inv. Esp. Beb Om' -- mismo patrón que 'Inv. Esp. Beb' de An. Bebidas, con
  //     USERELATIONSHIP('Inventarios OMUH'[Fecha-7],Calendar[Date]) en vez de 'Inventarios GS'). ---
  const detalleDiario = [];
  for (const w of weeks.slice(0, 2)) {
    for (let d = 0; d < 7; d++) {
      const fecha = addDays(w.monday, d);
      if (fecha.getTime() > todayUtc.getTime()) continue;
      const diaIso = weekdayIso(fecha);

      for (const producto of productos) {
        const codProducto = codByProducto.get(producto);
        const catBeb = categoriaBebidas(producto);

        const comprasDia = round2(
          src.comprasRows
            .filter((r) => r.codProducto === codProducto && sameDay(r.fecha1, fecha))
            .reduce((a, r) => a + (r.cantidad || 0), 0)
        );
        const vtasIziDia = round2(
          src.ventasIziOmuhRows
            .filter((r) => r.producto === producto && sameDay(r.fecha, fecha))
            .reduce((a, r) => a + factorVtasIziBebForDay(r), 0)
        );
        const vtasExtDia = round2(
          src.extrasRows.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)).reduce((a, r) => a + r.cantidad, 0)
        );
        const vtasPyDia = round2(
          src.ventasPyRows.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)).reduce((a, r) => a + r.cantidad, 0)
        );
        const vtasAncDia = round2(
          M.vtasAncIziOmuh(src.ventasAncIziRows.filter((r) => r.producto === producto && sameDay(r.fecha, fecha)))
        );
        const salidasDia = round2(
          src.salidasRows
            .filter((r) => r.productoOmBeb === producto && sameDay(r.fecha, fecha))
            .reduce((a, r) => a + (r.porciones || 0), 0)
        );

        if (comprasDia === 0 && vtasIziDia === 0 && vtasExtDia === 0 && vtasPyDia === 0 && vtasAncDia === 0 && salidasDia === 0) continue;

        const hastaFecha = (r) => r.fecha && r.fecha.getTime() <= fecha.getTime();
        const acumComp = round2(
          src.comprasRows.filter((r) => r.codProducto === codProducto && r.fecha1 && weekYear(r.fecha1) === w.weekYear && hastaFecha({ fecha: r.fecha1 })).reduce((a, r) => a + (r.cantidad || 0), 0)
        );
        const acumVtasIzi = src.ventasIziOmuhRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear && hastaFecha(r)).reduce((a, r) => a + factorVtasIziBebForDay(r), 0);
        const acumVtasExt = src.extrasRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear && hastaFecha(r)).reduce((a, r) => a + r.cantidad, 0);
        const acumVtasPy = src.ventasPyRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear && hastaFecha(r)).reduce((a, r) => a + r.cantidad, 0);
        const acumVtasAnc = M.vtasAncIziOmuh(src.ventasAncIziRows.filter((r) => r.producto === producto && weekYear(r.fecha) === w.weekYear && hastaFecha(r)));
        const acumSalidas = src.salidasRows.filter((r) => r.productoOmBeb === producto && weekYear(r.fecha) === w.weekYear && hastaFecha(r)).reduce((a, r) => a + (r.porciones || 0), 0);
        const acumSal = round2(acumVtasIzi + acumVtasExt + acumVtasPy + acumVtasAnc + acumSalidas);

        const invMenos7Semana = M.invMenos7OmBeb(src.inventariosOmuhRows.filter((r) => r.categoriaBebidas === catBeb), catBeb, w.weekYear, w.monday);
        const invEsperado = round2(Math.max(0, (invMenos7Semana ?? 0) + acumComp - acumSal));

        const invSemana = M.invOmBeb(src.inventariosOmuhRows.filter((r) => r.categoriaBebidas === catBeb), catBeb, w.weekYear);
        const invVis = diaIso === 1 ? invMenos7Semana : diaIso === 7 ? invSemana : null;

        detalleDiario.push({
          producto,
          fecha: fmtDate(fecha),
          dia: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][fecha.getUTCDay()],
          compras: comprasDia,
          vtas: vtasIziDia,
          vtasExt: vtasExtDia,
          vtasPY: vtasPyDia,
          vtasAnc: vtasAncDia,
          salidas: salidasDia,
          invEsperado,
          invIniFin: invVis !== null ? round2(invVis) : null,
          dif: invVis !== null ? round2(invVis - invEsperado) : null,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rangoFechas: { desde: fmtDate(weeks[weeks.length - 1].monday), hasta: fmtDate(todayUtc) },
    categorias: CATEGORIAS_BEBIDAS_OMUH,
    productos,
    semanas: weeks.map((w) => w.weekYear),
    semanasInfo: weeks.map((w) => ({ weekYear: w.weekYear, desde: fmtDate(w.monday), hasta: fmtDate(w.sunday) })),
    resumenSemanal,
    detalleDiario,
    serieSemanal: serieSemanalMap,
    meta: {
      ventasIziDisponibles: src.ventasIziOmuhRows.length > 0,
      filasDimProducto: src.dimProductoRows.length,
      filasInventariosOmuh: src.inventariosOmuhRows.length,
      filasCompras: src.comprasRows.length,
      filasSalidas: src.salidasRows.length,
      filasVentasIzi: src.ventasIziOmuhRows.length,
      filasVentasPY: src.ventasPyRows.length,
      filasExtras: src.extrasRows.length,
      filasMovInv: src.movInvOmuhRows.length,
      filasVentasAncIzi: src.ventasAncIziRows.length,
      warnings: src.warnings,
    },
  };
}
