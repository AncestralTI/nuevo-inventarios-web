#!/usr/bin/env node
// pipeline/build-om-bebidas.mjs
// Wrapper delgado para la página real "Om. Bebidas" del PBIX (sección 4.5 de ANALISIS_PBIX.md).
// Toda la lógica de descarga + medidas vive en pipeline/lib/omuh-pipeline.mjs, COMPARTIDA con
// "Om. Insumos" (build-om-insumos.mjs) -- ver la nota de arquitectura al inicio de
// pipeline/lib/measures-omuh.mjs y pipeline/lib/omuh-pipeline.mjs.
//
// Uso:
//   IZI_EMAIL=... IZI_PASSWORD=... node pipeline/build-om-bebidas.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOmBebidasData } from "./lib/omuh-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const output = await buildOmBebidasData({});

  const outDir = path.join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "om-bebidas.json");
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
  console.error("build-om-bebidas: ERROR FATAL", err);
  process.exit(1);
});
