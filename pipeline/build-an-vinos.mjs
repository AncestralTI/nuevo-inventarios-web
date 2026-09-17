#!/usr/bin/env node
// pipeline/build-an-vinos.mjs
// Wrapper delgado para la página real "An. Vinos" del PBIX (sección 4.2 de ANALISIS_PBIX.md).
// Toda la lógica de descarga + medidas vive en pipeline/lib/anc-beb-vin-pipeline.mjs, compartida
// con la futura "An. Bebidas" (misma estructura, mismas 15 medidas de "Anc. Beb y Vin" -- solo
// cambia la lista de categorías del filtro de página). Ver esa nota en el propio archivo lib.
//
// Uso:
//   IZI_EMAIL=... IZI_PASSWORD=... node pipeline/build-an-vinos.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAncBebVinData } from "./lib/anc-beb-vin-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Filtro de página real de "An. Vinos" (sección 4.2 de ANALISIS_PBIX.md):
// Dim_Producto_iZi[Categoria] IN {"CERVEZA", "VINOS", "VINOS IMPORTADOS"}.
const CATEGORIAS_VINOS = ["CERVEZA", "VINOS", "VINOS IMPORTADOS"];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const output = await buildAncBebVinData({ categorias: CATEGORIAS_VINOS });

  const outDir = path.join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "an-vinos.json");
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
  console.error("build-an-vinos: ERROR FATAL", err);
  process.exit(1);
});
