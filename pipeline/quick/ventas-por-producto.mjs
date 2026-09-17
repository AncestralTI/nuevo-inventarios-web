// Script independiente (no forma parte del pipeline del piloto "An. Insumos").
// Genera data/ventas-por-producto.json: ventas reales (Ancestral, sucursal 79344)
// por producto, con su categoría, usando la API de iZi Soluciones — mismas
// fuentes que 'Dim_Producto_iZi' y 'fac_ventas_Ancestral_iZi' del PBIX.
//
// Uso: IZI_EMAIL=... IZI_PASSWORD=... node pipeline/quick/ventas-por-producto.mjs [dias]

import { writeFile } from "node:fs/promises";

const BASE_URL = "https://api.beta.izisoluciones.com";
const CONTRIBUYENTE = "79818";
const SUCURSAL_ANCESTRAL = "79344";
const DIAS = Number(process.argv[2] || 30);

async function login() {
  const email = process.env.IZI_EMAIL;
  const password = process.env.IZI_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan variables de entorno IZI_EMAIL / IZI_PASSWORD");
  }
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ correoElectronico: email, contrasena: password, cadena: "" })
  });
  const json = await res.json();
  if (!json.token) throw new Error("No se pudo obtener token de iZi: " + JSON.stringify(json));
  return json.token;
}

// Réplica de Dim_Producto_iZi: catálogo con Categoria, Cod. Producto, Producto
async function fetchCatalogo(token) {
  const res = await fetch(`${BASE_URL}/items-inventarios`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "izi-contribuyente": CONTRIBUYENTE
    }
  });
  const items = await res.json();
  const porCodigo = new Map();
  for (const it of items) {
    const codigo = String(it.codigo ?? "").trim();
    if (!codigo) continue;
    if (codigo.startsWith("i") || codigo.startsWith("I")) continue;
    if (["0003698", "002628", "15185151", "6666"].includes(codigo)) continue;
    if (porCodigo.has(codigo)) continue; // Table.Distinct por codigo
    porCodigo.set(codigo, {
      codProducto: codigo,
      producto: it.nombre,
      categoria: it.categoria?.nombre ?? "(Sin categoría)"
    });
  }
  return porCodigo;
}

// Réplica de fac_ventas_Ancestral_iZi: factura → listaItems expandido
async function fetchFacturas(token, desde, hasta) {
  const endpoint =
    `facturas?desde=${desde}&contribuyente=${CONTRIBUYENTE}&hasta=${hasta}` +
    `&isPruebas=false&offset=0&prefactura=false&sucursal=${SUCURSAL_ANCESTRAL}`;
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "izi-contribuyente": CONTRIBUYENTE,
      "izi-sucursal": SUCURSAL_ANCESTRAL
    }
  });
  const json = await res.json();
  return json.facturas ?? [];
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - DIAS * 24 * 60 * 60 * 1000);

  console.log(`Login iZi...`);
  const token = await login();

  console.log(`Descargando catálogo (items-inventarios)...`);
  const catalogo = await fetchCatalogo(token);

  console.log(`Descargando facturas (${fmtDate(desde)} a ${fmtDate(hasta)})...`);
  const facturas = await fetchFacturas(token, fmtDate(desde), fmtDate(hasta));
  console.log(`Facturas recibidas: ${facturas.length}`);

  // Agrega Cantidad vendida por codigoInventario, igual que hace el PBIX al
  // expandir listaItems y descartar el código de prueba AN000046.
  const ventasPorCodigo = new Map();
  for (const factura of facturas) {
    for (const item of factura.listaItems ?? []) {
      const codigo = item.codigoInventario;
      if (!codigo || codigo === "AN000046") continue;
      const cantidad = Number(item.cantidad) || 0;
      const monto = Number(item.precioTotal) || 0;
      const prev = ventasPorCodigo.get(codigo) || { cantidad: 0, monto: 0, nombreFactura: item.articulo };
      prev.cantidad += cantidad;
      prev.monto += monto;
      ventasPorCodigo.set(codigo, prev);
    }
  }

  const productos = [];
  for (const [codigo, venta] of ventasPorCodigo) {
    const cat = catalogo.get(codigo);
    productos.push({
      codProducto: codigo,
      producto: cat?.producto ?? venta.nombreFactura ?? codigo,
      categoria: cat?.categoria ?? "(Sin categoría / código de prueba)",
      cantidad: Math.round(venta.cantidad * 100) / 100,
      monto: Math.round(venta.monto * 100) / 100
    });
  }
  productos.sort((a, b) => b.cantidad - a.cantidad);

  const categorias = [...new Set(productos.map(p => p.categoria))].sort();

  const out = {
    generatedAt: new Date().toISOString(),
    fuente: "API iZi Soluciones (facturas + items-inventarios), sucursal Ancestral (79344)",
    rango: { desde: fmtDate(desde), hasta: fmtDate(hasta) },
    categorias,
    productos
  };

  await writeFile(
    new URL("../../data/ventas-por-producto.json", import.meta.url),
    JSON.stringify(out, null, 2)
  );
  console.log(`Listo: ${productos.length} productos, ${categorias.length} categorías -> data/ventas-por-producto.json`);
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
