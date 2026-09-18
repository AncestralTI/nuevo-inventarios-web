#!/usr/bin/env node
// pipeline/build-an-bebidas.mjs
// Wrapper delgado para la página real "An. Bebidas" del PBIX (sección 4.1 de ANALISIS_PBIX.md).
// Toda la lógica de descarga + medidas vive en pipeline/lib/anc-beb-vin-pipeline.mjs, COMPARTIDA
// con "An. Vinos" (build-an-vinos.mjs) -- misma estructura, mismas 15 medidas de "Anc. Beb y Vin",
// solo cambia la lista de categorías del filtro de página. Ver esa nota en el propio archivo lib.
//
// Uso:
//   IZI_EMAIL=... IZI_PASSWORD=... node pipeline/build-an-bebidas.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAncBebVinData } from "./lib/anc-beb-vin-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Filtro de página real de "An. Bebidas" (sección 4.1 de ANALISIS_PBIX.md):
// Dim_Producto_iZi[Categoria] IN {"5. Bebidas alcohólicas", "GASEOSA", "CERVEZA"}.
const CATEGORIAS_BEBIDAS = ["5. Bebidas alcohólicas", "GASEOSA", "CERVEZA"];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const output = await buildAncBebVinData({ categorias: CATEGORIAS_BEBIDAS });

  const outDir = path.join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "an-bebidas.json");
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  log(
    `Escrito ${outPath} (${output.productos.length} productos, ${output.resumenSemanal.length} filas resumen, ` +
      `${output.detalleDiario.length} filas detalle)`
  );
  if (output.meta?.warnings?.length) {
    for (const w of output.meta.warnings) log("  ADVERTENCIA:", w);
  }
}

main().catch((err) => {
  console.error("build-an-bebidas: ERROR FATAL", err);
  process.exit(1);
});
