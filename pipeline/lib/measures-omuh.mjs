// pipeline/lib/measures-omuh.mjs
// Réplica en JS puro de las 24 medidas DAX de las carpetas "Omuh Insumos" (9 medidas) y
// "Omuh Beb" (15 medidas) de la tabla `03omuh`, documentadas en ANALISIS_PBIX.md sección 3.2
// (líneas ~526-858) y verificadas contra el TMDL crudo del modelo real (Dim_Producto_iZi.tmdl,
// Tabla.tmdl, 'Compras Insumos omuH'.tmdl, 'Salidas y Mermas omuH'.tmdl, 'Extras - iZi omuH'.tmdl,
// 'Inventarios Unitarios GS omuh'.tmdl, 'Inventarios OMUH'.tmdl, fac_ventas_omuH_iZi.tmdl,
// fac_ventas_omuH_PedidosYa.tmdl, 'Mov Inv omuh (5)'.tmdl, fac_ventas_Ancestral_iZi.tmdl,
// relationships.tmdl) Y contra el modelo real en vivo (dax_query_operations / EVALUATE).
//
// ---------------------------------------------------------------------------------------------
// ARQUITECTURA COMPARTIDA (por qué Om. Insumos y Om. Bebidas viven en el mismo módulo de medidas)
// ---------------------------------------------------------------------------------------------
// `Ventas Tot Om Beb` (Om. Bebidas) usa literalmente [Vtas Anc Izi Om Ins], y `Cierre Om Beb`
// usa literalmente [Cortesias Om Ins] -- ambas son medidas de la carpeta "Omuh Insumos" pero se
// REUTILIZAN tal cual en "Omuh Beb", solo que evaluadas en un contexto de fila distinto (Producto
// en vez de Insumo/Tabla). En DAX esto funciona porque una medida se recalcula según el contexto
// de filtro activo; en JS puro no hay "contexto de filtro" implícito, así que replicamos el mismo
// efecto con funciones que reciben las filas YA ATRIBUIDAS (con campos `insumo` y/o `producto`
// adjuntos por el pipeline) y un DISCRIMINADOR de a qué grupo pertenece cada fila:
//   - `vtasAncIziOmuh(rows)` sólo suma con el SWITCH de factores; el CALLER (omuh-pipeline.mjs)
//     le pasa ya filtradas las filas de fac_ventas_Ancestral_iZi que matchean el Insumo (para
//     "Vtas Anc Izi Om Ins") o el Producto (para el término reusado dentro de "Ventas Tot Om Beb").
//   - `cortesiasOmuh(rows)` ídem, el caller filtra por insumo (Cortesias Om Ins) o por producto
//     (término reusado dentro de "Cierre Om Beb").
// Así la fórmula vive en un solo lugar y ambos módulos quedan consistentes por construcción --
// nunca se reimplementa la misma lógica de negocio dos veces de forma potencialmente inconsistente.
//
// ---------------------------------------------------------------------------------------------
// "Insumo" real de Om. Insumos: SOLO 3 valores (confirmado en vivo con `EVALUATE Tabla`, no
// asumido del resumen -- la tabla calculada `Tabla` tiene exactamente 3 filas)
// ---------------------------------------------------------------------------------------------
//   Tabla[Categoria]  | Tabla[Insumo]
//   "1. Burgers"      | "Carne Molida 130g"
//   "2. Sandos"        | "Pesca Amazonica"
//   "2. Sandos"        | "Pechuga de Pollo"
//
// La columna calculada `Dim_Producto_iZi[Categoria Carnes]` (SWITCH por Cod. Producto, ver
// CATEGORIA_CARNES_POR_COD abajo) también puede producir "Carne Molida 90g" y "Queso", pero
// NINGUNO de esos dos valores existe como fila de `Tabla`, así que cualquier producto/venta que
// caiga en esos dos buckets queda FUERA de "Om. Insumos" (no forma un grupo propio, ni se
// mezcla con los otros 3) -- comportamiento real del modelo, confirmado en vivo, no un bug
// nuestro. `Om. Insumos` es por tanto una página con muy pocas filas (3 insumos), consolidando
// muchas materias primas/ítems de inventario cárnico bajo 3 categorías.

import { weekYear, weekYearToRange } from "./calendar.mjs";
import { addDays } from "./sheets.mjs";

function sum(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return 0; // SUM/SUMX de DAX sobre conjunto vacío -> 0 en las medidas que se USAN dentro de otra suma (nunca se comparan contra BLANK() directamente)
  return nums.reduce((a, b) => a + b, 0);
}

function sumOrNull(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return null; // SUM() de DAX SIN "+0" sobre conjunto vacío -> BLANK() real (usado para Inv. Om Beb, comparado luego contra BLANK() en Dif)
  return nums.reduce((a, b) => a + b, 0);
}

function average(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (nums.length === 0) return null; // AVERAGE de DAX sobre conjunto vacío -> BLANK()
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function norm(s) {
  // Normalización case/acento-insensible, réplica de la colación por defecto de Analysis
  // Services/Power BI (comparaciones de texto case-insensitive) usada en varios SWITCH/relaciones
  // del modelo (p.ej. Salidas y Mermas omuH[Categoria 3] contra Tabla[Insumo]/Dim_Producto_iZi[Producto]).
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Dim_Producto_iZi[Categoria Carnes] -- SWITCH exacto verificado en Dim_Producto_iZi.tmdl.
// Mapea Cod. Producto -> categoría de insumo consolidada. Es la atribución "maestra" usada por
// todas las medidas de ventas (Vtas Izi/PY/Anc Izi Om Ins, Cortesias Om Ins) vía la relación real
// codigoInventario/Cod.Producto -> Dim_Producto_iZi -> Categoria Carnes -> Tabla.Insumo.
// ---------------------------------------------------------------------------
const CATEGORIA_CARNES_POR_COD = new Map([
  ["OMU00000000001", "Carne Molida 90g"],
  ["OMU00031", "Pechuga de Pollo"], ["OMU00057", "Pechuga de Pollo"], ["OMU00030", "Pechuga de Pollo"],
  ["OMU00029", "Pechuga de Pollo"], ["OMU00028", "Pechuga de Pollo"], ["OMU00027", "Pechuga de Pollo"],
  ["OMU00026", "Pechuga de Pollo"], ["OMU00051", "Pechuga de Pollo"], ["OMU00078", "Pechuga de Pollo"],
  ["OMU00079", "Pechuga de Pollo"], ["OMU00085", "Pechuga de Pollo"], ["OMU00071", "Pechuga de Pollo"],
  ["OMU00059", "Pesca Amazonica"], ["OMU00087", "Pesca Amazonica"],
  ["OMU00068", "Queso"],
  ["OMU00011", "Carne Molida 130g"], ["OMU00010", "Carne Molida 130g"], ["OMU00009", "Carne Molida 130g"],
  ["OMU00008", "Carne Molida 130g"], ["OMU00058", "Carne Molida 130g"], ["OMU00007", "Carne Molida 130g"],
  ["OMU00006", "Carne Molida 130g"], ["OMU00049", "Carne Molida 130g"], ["OMU00005", "Carne Molida 130g"],
  ["OMU00066", "Carne Molida 130g"], ["OMU00072", "Carne Molida 130g"], ["OMU00061", "Carne Molida 130g"],
  ["OMU00054", "Carne Molida 130g"], ["OMU00055", "Carne Molida 130g"], ["OMU00064", "Carne Molida 130g"],
  ["ANC00066", "Carne Molida 130g"], ["OMU00052", "Carne Molida 130g"], ["OMU00086", "Carne Molida 130g"],
  ["OMU00065", "Carne Molida 130g"], ["OMU00063", "Carne Molida 130g"], ["OMU00062", "Carne Molida 130g"],
  ["OMU00082", "Carne Molida 130g"], ["OMU00088", "Carne Molida 130g"],
]);

export const TABLA_INSUMOS = ["Carne Molida 130g", "Pechuga de Pollo", "Pesca Amazonica"];
const TABLA_INSUMOS_SET = new Set(TABLA_INSUMOS);

/** RELATED(Tabla[Insumo]) vía Dim_Producto_iZi[Categoria Carnes] -- null si el código no mapea a
 *  ninguno de los 3 insumos reales de Tabla (incluye "Carne Molida 90g"/"Queso", que no están en
 *  Tabla y por tanto no forman grupo en Om. Insumos -- ver nota de cabecera). */
export function insumoPorCodProducto(codProducto) {
  const v = CATEGORIA_CARNES_POR_COD.get(codProducto);
  return v && TABLA_INSUMOS_SET.has(v) ? v : null;
}

// ---------------------------------------------------------------------------
// 'Extras - iZi omuH'[Categoria 3] -- SWITCH PROPIO (distinto al de Dim_Producto_iZi: usa
// "OMU00071" en vez de "OMU00086" en la lista de Carne Molida 130g, y una lista más corta de
// Pechuga de Pollo -- verificado carácter por carácter en 'Extras - iZi omuH'.tmdl, no es un
// error nuestro, el modelo real mantiene dos SWITCH ligeramente distintos).
// ---------------------------------------------------------------------------
const EXTRAS_CARNE_MOLIDA_90 = new Set(["OMU00000000001"]);
const EXTRAS_PECHUGA_POLLO = new Set([
  "OMU00031", "OMU00057", "OMU00030", "OMU00029", "OMU00028", "OMU00027", "OMU00026", "OMU00051",
  "OMU00078", "OMU00079",
]);
const EXTRAS_PESCA_AMAZONICA = new Set(["OMU00059", "OMU00087"]);
const EXTRAS_QUESO = new Set(["OMU00068"]);
const EXTRAS_CARNE_MOLIDA_130 = new Set([
  "OMU00011", "OMU00010", "OMU00009", "OMU00008", "OMU00058", "OMU00007", "OMU00006", "OMU00049",
  "OMU00005", "OMU00066", "OMU00072", "OMU00061", "OMU00054", "OMU00055", "OMU00064", "ANC00066",
  "OMU00052", "OMU00071", "OMU00065", "OMU00063", "OMU00062", "OMU00082", "OMU00088",
]);

/** 'Extras - iZi omuH'[Categoria 3] evaluada sobre el campo Value de cada fila (que puede ser un
 *  código OMU00xxx, o texto libre "Carne Extra"/"Pollo Frito Extra" para las filas viejas). Sólo
 *  se usa para atribuir a Insumo (Om. Insumos); para Om. Bebidas se usa el `Value` crudo (ver
 *  vtasExtOmBeb). Devuelve null si no matchea ningún bucket (equivalente a BLANK()). */
export function extrasCategoria3(value) {
  if (EXTRAS_CARNE_MOLIDA_90.has(value)) return "Carne Molida 90g";
  if (EXTRAS_PECHUGA_POLLO.has(value)) return "Pechuga de Pollo";
  if (EXTRAS_PESCA_AMAZONICA.has(value)) return "Pesca Amazonica";
  if (EXTRAS_QUESO.has(value)) return "Queso";
  if (EXTRAS_CARNE_MOLIDA_130.has(value)) return "Carne Molida 130g";
  const n = norm(value);
  if (n === "carne extra") return "Carne Molida 130g";
  if (n === "pollo frito extra") return "Pechuga de Pollo";
  return null;
}

/** RELATED(Tabla[Insumo]) vía 'Extras - iZi omuH'[Categoria 3] -- igual filtro de pertenencia a
 *  Tabla que insumoPorCodProducto. */
export function insumoPorExtrasValue(value) {
  const v = extrasCategoria3(value);
  return v && TABLA_INSUMOS_SET.has(v) ? v : null;
}

// ---------------------------------------------------------------------------
// 'Salidas y Mermas omuH'[Categoria 3] -- SWITCH con FALLBACK al Producto original (a diferencia
// de los SWITCH de arriba, que caen a BLANK()): sólo remapea 3 nombres puntuales; cualquier otro
// Producto pasa tal cual. Esa columna sirve DOBLE propósito en el modelo real: como FK hacia
// Tabla[Insumo] (Om. Insumos, vía relación activa de una sola dirección) y como FK hacia
// Dim_Producto_iZi[Producto] (Om. Bebidas, vía USERELATIONSHIP en 'Salidas Om Beb') -- ambos
// conjuntos de valores (insumos cárnicos vs. nombres de bebidas) son disjuntos, así que no hay
// conflicto: una fila de Salidas sólo "cuenta" para uno de los dos módulos.
export function salidasCategoria3(producto) {
  const n = norm(producto);
  if (n === "carne molida") return "Carne Molida 130g";
  if (n === "pesca amazonica" || n === "pesca amazónica") return "Pesca Amazonica";
  if (n === "amstel") return "Cerveza Amstel 269 ml (pequeña)";
  return producto;
}

export function insumoPorSalidasProducto(producto) {
  const v = norm(salidasCategoria3(producto));
  for (const insumo of TABLA_INSUMOS) {
    if (norm(insumo) === v) return insumo;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 'Compras Insumos omuH'[Producto 2] = IF(Producto="Carne molida","Carne Molida 130g",Producto)
// ---------------------------------------------------------------------------
export function comprasProducto2(producto) {
  return norm(producto) === "carne molida" ? "Carne Molida 130g" : producto;
}

export function insumoPorComprasProducto2(producto) {
  const v = norm(comprasProducto2(producto));
  for (const insumo of TABLA_INSUMOS) {
    if (norm(insumo) === v) return insumo;
  }
  return null;
}

// ===============================================================================================
// Omuh Insumos (9 medidas, agrupadas por Tabla[Insumo] -- sólo 3 valores posibles)
// ===============================================================================================

/** Inv. -7 Om Ins = CALCULATE(AVERAGE('Inventarios Unitarios GS omuh'[Cantidad]), USERELATIONSHIP(Fecha-7,Date)) */
export function invMenos7OmIns(inventariosRows, insumo, weekYearStr, anchorDate) {
  const range = weekYearToRange(weekYearStr, anchorDate);
  if (!range) return null;
  const prevStart = addDays(range.start, -7);
  const prevEnd = addDays(range.end, -7);
  const rows = inventariosRows.filter(
    (r) => r.insumo === insumo && r.fecha.getTime() >= prevStart.getTime() && r.fecha.getTime() <= prevEnd.getTime()
  );
  return average(rows.map((r) => r.cantidad));
}

/** Inv. Om Ins = CALCULATE(AVERAGE('Inventarios Unitarios GS omuh'[Cantidad])) */
export function invOmIns(inventariosRows, insumo, weekYearStr) {
  const rows = inventariosRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return average(rows.map((r) => r.cantidad));
}

/** Compras Om Ins = CALCULATE(SUM('Compras Insumos omuH'[Porciones])) -- agrupado por Fecha1
 *  (única relación activa a Calendar, mismo patrón que 'Compras Insumos' de An. Insumos). */
export function comprasOmIns(comprasRows, insumo, weekYearStr) {
  const rows = comprasRows.filter((r) => r.insumo === insumo && r.fecha1 && weekYear(r.fecha1) === weekYearStr);
  return sum(rows.map((r) => r.porciones));
}

/** Salidas Om Ins = SUM('Salidas y Mermas omuH'[Porciones]) */
export function salidasOmIns(salidasRows, insumo, weekYearStr) {
  const rows = salidasRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.porciones));
}

/** Cortesias Om Ins = CALCULATE(SUM('Mov Inv omuh (5)'[cantidad]), tipoMovimiento="interna")
 *  Función COMPARTIDA con Cierre Om Beb (ver nota de cabecera) -- sólo suma, el caller filtra las
 *  filas por insumo o por producto según el módulo. */
export function cortesiasOmuh(movRows) {
  return sum(movRows.filter((r) => r.tipoMovimiento === "interna").map((r) => r.cantidad));
}

export function cortesiasOmIns(movRows, insumo, weekYearStr) {
  const rows = movRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return cortesiasOmuh(rows);
}

/** SWITCH de factores de 'Vtas Izi Om Ins' (Om. Insumos): idéntico a Om. Bebidas salvo que NO
 *  incluye "OMU00071" (ese código sólo tiene factor especial en la versión de Om. Bebidas). */
function factorVtasIziOmIns(row) {
  if (row.producto === "Chop Cerveza") return row.cantidad * 0.75;
  if (row.producto === "Chop Cerveza 2X1") return row.cantidad * 1.5;
  if (["OMU00052", "OMU00053", "OMU00086"].includes(row.codigoInventario)) return row.cantidad * 0.5;
  if (row.codigoInventario === "OMU00068") return 0;
  return row.cantidad;
}

/** Vtas Izi Om Ins = SUMX(fac_ventas_omuH_iZi, SWITCH(...)) */
export function vtasIziOmIns(ventasIziRows, insumo, weekYearStr) {
  const rows = ventasIziRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map(factorVtasIziOmIns));
}

/** SWITCH de factores de 'Vtas PY Om Ins': Super Smash Burger / Carne Extra Super Smash Burger a mitad. */
function factorVtasPyOmIns(row) {
  if (row.producto === "Super Smash Burger") return row.cantidad * 0.5;
  if (row.producto === "Carne Extra Super Smash Burger") return row.cantidad * 0.5;
  return row.cantidad;
}

/** Vtas PY Om Ins = CALCULATE(SUMX(fac_ventas_omuH_PedidosYa, SWITCH(...)), USERELATIONSHIP(...)) */
export function vtasPyOmIns(ventasPyRows, insumo, weekYearStr) {
  const rows = ventasPyRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map(factorVtasPyOmIns));
}

/** Vtas Ext Om Ins = CALCULATE(SUM('Extras - iZi omuH'[Cantidad]), Cantidad>0) */
export function vtasExtOmIns(extrasRows, insumo, weekYearStr) {
  const rows = extrasRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr && r.cantidad > 0);
  return sum(rows.map((r) => r.cantidad));
}

/** Vtas Vegg Om Ins = CALCULATE(SUM('Extras - iZi omuH'[Cantidad]), Cantidad<0) */
export function vtasVeggOmIns(extrasRows, insumo, weekYearStr) {
  const rows = extrasRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr && r.cantidad < 0);
  return sum(rows.map((r) => r.cantidad));
}

/** SWITCH de factores de 'Vtas Anc Izi Om Ins' / término reusado en 'Ventas Tot Om Beb'. Función
 *  COMPARTIDA entre ambos módulos (ver nota de cabecera): usa fac_ventas_Ancestral_iZi[Cantidad2]
 *  (= Cantidad * Merma%, RELATED('Pesos platos'[Cantidad]) por codigoInventario -- ver
 *  computeCantidad2 en omuh-pipeline.mjs), NO 'Cantidad' cruda ni 'Cantidad Chuleton'. */
function factorVtasAncIzi(row) {
  if (["OMU00052", "OMU00053", "OMU00086"].includes(row.codigoInventario)) return row.cantidad2 * 0.5;
  return row.cantidad2;
}

export function vtasAncIziOmuh(rows) {
  return sum(rows.map(factorVtasAncIzi));
}

export function vtasAncIziOmIns(ventasAncRows, insumo, weekYearStr) {
  const rows = ventasAncRows.filter((r) => r.insumo === insumo && weekYear(r.fecha) === weekYearStr);
  return vtasAncIziOmuh(rows);
}

/** Vtas Om Ins = VtasIzi+VtasPY+Cortesias+Salidas+VtasAncIzi+VtasExt+VtasVegg */
export function vtasOmIns(vtasIzi, vtasPY, cortesias, salidas, vtasAncIzi, vtasExt, vtasVegg) {
  return vtasIzi + vtasPY + cortesias + salidas + vtasAncIzi + vtasExt + vtasVegg;
}

/** Cierre Om Ins = MAX(0, Inv.-7 + Compras - Vtas) */
export function cierreOmIns(invMenos7, compras, vtas) {
  return Math.max(0, (invMenos7 ?? 0) + compras - vtas);
}

/** Dif Om Ins = IF(Inv=BLANK(),BLANK(), Inv-Cierre). Réplica de la coerción BLANK()=0 de DAX
 *  (documentada y confirmada para la medida gemela Dif Om Beb -- ver difOmBeb más abajo; se aplica
 *  aquí también por ser exactamente el mismo patrón DAX `[Inv]=BLANK()`, aunque no se observó un
 *  caso con Inv=0 real en la muestra validada porque Inv. Om Ins es AVERAGE, que rara vez cae
 *  exactamente en 0). */
export function difOmIns(inv, cierre) {
  if (inv === null || inv === undefined || inv === 0) return null;
  return inv - cierre;
}

// ===============================================================================================
// Omuh Beb (15 medidas, agrupadas por Dim_Producto_iZi[Producto])
// ===============================================================================================

/** Inv. Om Beb = SUM('Inventarios OMUH'[Cantidad]) -- SIN "+0": BLANK() real sobre conjunto vacío
 *  (igual que Inv. Anc Beb; se compara contra BLANK() en Dif Om Beb). */
export function invOmBeb(inventariosRows, producto, weekYearStr) {
  const rows = inventariosRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sumOrNull(rows.map((r) => r.cantidad));
}

/** Inv. -7 Om Beb = CALCULATE(AVERAGE('Inventarios OMUH'[Cantidad]), REMOVEFILTERS(...), USERELATIONSHIP(Fecha-7,Date)) */
export function invMenos7OmBeb(inventariosRows, producto, weekYearStr, anchorDate) {
  const range = weekYearToRange(weekYearStr, anchorDate);
  if (!range) return null;
  const prevStart = addDays(range.start, -7);
  const prevEnd = addDays(range.end, -7);
  const rows = inventariosRows.filter(
    (r) => r.producto === producto && r.fecha.getTime() >= prevStart.getTime() && r.fecha.getTime() <= prevEnd.getTime()
  );
  return average(rows.map((r) => r.cantidad));
}

/** Compras Om Beb = CALCULATE(SUM('Compras Insumos omuH'[Cantidad]), USERELATIONSHIP(Dim_Producto_iZi[Cod. Producto], 'Compras Insumos omuH'[Cod Producto]))
 *  A diferencia de Compras Om Ins (que agrupa por 'Producto 2'->Insumo), aquí se agrupa por el
 *  código de producto CRUDO ('Cod Producto', sin pasar por 'Producto 2'), vía relación activada
 *  con el código del propio producto (bebida). También agrupado por Fecha1 (única relación activa
 *  a Calendar). */
export function comprasOmBeb(comprasRows, codProducto, weekYearStr) {
  const rows = comprasRows.filter(
    (r) => r.codProducto === codProducto && r.fecha1 && weekYear(r.fecha1) === weekYearStr
  );
  return sum(rows.map((r) => r.cantidad));
}

/** Vtas Ext Om Beb = CALCULATE(SUM('Extras - iZi omuH'[Cantidad]), USERELATIONSHIP(Dim_Producto_iZi[Producto], 'Extras - iZi omuH'[Value]))
 *  A diferencia de Vtas Ext/Vegg Om Ins (que filtran por signo y usan la Categoria3 propia de
 *  Extras), aquí se toma el Value CRUDO (case-insensitive) comparado directo contra el nombre del
 *  producto, SIN filtro de signo (suma cortesías/ajustes vegetarianos y extras reales juntos).
 */
export function vtasExtOmBeb(extrasRows, producto, weekYearStr) {
  const rows = extrasRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.cantidad));
}

/** Vtas PY Om Beb = CALCULATE(SUM(fac_ventas_omuH_PedidosYa[Cantidad]), USERELATIONSHIP(Dim_Producto_iZi[Cod. Producto], fac_ventas_omuH_PedidosYa[Cod. Producto]))
 *  Suma directa, SIN el SWITCH de factores que sí tiene Vtas PY Om Ins (ese factor es específico
 *  del agrupamiento por insumo cárnico). */
export function vtasPyOmBeb(ventasPyRows, producto, weekYearStr) {
  const rows = ventasPyRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.cantidad));
}

/** SWITCH de factores de 'Vtas Izi Om Beb': igual que Om Ins pero con "OMU00071" agregado a la
 *  lista de factor 0.5 (verificado carácter por carácter contra el DAX real). */
function factorVtasIziOmBeb(row) {
  if (row.producto === "Chop Cerveza") return row.cantidad * 0.75;
  if (row.producto === "Chop Cerveza 2X1") return row.cantidad * 1.5;
  if (["OMU00052", "OMU00053", "OMU00071", "OMU00086"].includes(row.codigoInventario)) return row.cantidad * 0.5;
  if (row.codigoInventario === "OMU00068") return 0;
  return row.cantidad;
}

export function vtasIziOmBeb(ventasIziRows, producto, weekYearStr) {
  const rows = ventasIziRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map(factorVtasIziOmBeb));
}

/** Ventas Tot Om Beb = VtasIzi+VtasPY+VtasExt+[Vtas Anc Izi Om Ins]+Salidas
 *  El tercer término reutiliza LITERALMENTE la medida de "Omuh Insumos" (ver vtasAncIziOmuh
 *  arriba), evaluada en contexto de Producto en vez de Insumo. */
export function ventasTotOmBeb(vtasIzi, vtasPY, vtasExt, vtasAncIzi, salidas) {
  return vtasIzi + vtasPY + vtasExt + vtasAncIzi + salidas;
}

/** Salidas Om Beb = CALCULATE(SUM('Salidas y Mermas omuH'[Porciones]), USERELATIONSHIP(Dim_Producto_iZi[Producto], 'Salidas y Mermas omuH'[Categoria 3])) */
export function salidasOmBeb(salidasRows, producto, weekYearStr) {
  const rows = salidasRows.filter((r) => r.producto === producto && weekYear(r.fecha) === weekYearStr);
  return sum(rows.map((r) => r.porciones));
}

/** Cierre Om Beb = MAX(0, Inv.-7 + Compras - VentasTot - [Cortesias Om Ins])
 *  El último término reutiliza LITERALMENTE cortesiasOmuh() (ver arriba), evaluado en contexto de
 *  Producto (el caller filtra las filas de Mov Inv omuh (5) por producto en vez de por insumo). */
export function cierreOmBeb(invMenos7, compras, ventasTot, cortesias) {
  return Math.max(0, (invMenos7 ?? 0) + compras - ventasTot - cortesias);
}

/** Dif Om Beb = IF(Inv=BLANK(),BLANK(), Inv-Cierre)
 *  Misma coerción BLANK()=0 de DAX ya documentada y CONFIRMADA en vivo para esta medida
 *  (dax_query_operations, semana 202637: "Fanta Guarana" Inv=0 real, Cierre=0, Dif=BLANK -- no 0;
 *  en cambio "Chop Cerveza" Inv=35, Cierre=35, Dif=0 real porque Inv<>0). */
export function difOmBeb(inv, cierre) {
  if (inv === null || inv === undefined || inv === 0) return null;
  return inv - cierre;
}

export { norm };
