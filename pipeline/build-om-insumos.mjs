#!/usr/bin/env node
// pipeline/build-om-insumos.mjs
// Wrapper delgado para la página real "Om. Insumos" del PBIX (sección 4.4 de ANALISIS_PBIX.md).
// Toda la lógica de descarga + medidas vive en pipeline/lib/omuh-pipeline.mjs, COMPARTIDA con
// "Om. Bebidas" (build-om-bebidas.mjs) porque las medidas de "Omuh Beb" reutilizan literalmente
// medidas de "Omuh Insumos" ([Vtas Anc Izi Om Ins], [Cortesias Om Ins]) -- ver la nota de
// arquitectura al inicio de pipeline/lib/measures-omuh.mjs y pipeline/lib/omuh-pipeline.mjs.
//
// Uso:
//   IZI_EMAIL=... IZI_PASSWORD=... node pipeline/build-om-insumos.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOmInsumosData } from "./lib/omuh-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const output = await buildOmInsumosData({});

  const outDir = path.join(ROOT, "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "om-insumos.json");
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  log(
    `Escrito ${outPath} (${output.insumos.length} insumos, ${output.resumenSemanal.length} filas resumen, ` +
      `${output.detalleDiario.length} filas detalle)`
  );
  if (output.meta?.warnings?.length) {
    for (const w of output.meta.warnings) log("  ADVERTENCIA:", w);
  }
}

main().catch((err) => {
  console.error("build-om-insumos: ERROR FATAL", err);
  process.exit(1);
});
