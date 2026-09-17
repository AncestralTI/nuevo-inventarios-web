// Vista independiente: ventas por producto, filtrable por categoría y por rango de fecha.
// Lee data/ventas-por-producto.json (generado por pipeline/quick/ventas-por-producto.mjs
// a partir de datos reales de la API iZi — facturas + catálogo de productos), con detalle
// diario por producto, y agrega en el navegador según los filtros elegidos.

const state = { data: null, categoria: "__all__", top: 15, desde: null, hasta: null, chart: null };

const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#2f5d50";
const textMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#6b7280";
const border = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#e2e4e9";

function fmtNum(n) {
  return new Intl.NumberFormat("es-BO").format(n);
}

// Agrega ventasDiarias -> por producto, respetando categoría y rango de fecha elegidos.
function productosAgregados() {
  const { data, categoria, desde, hasta } = state;
  const porProducto = new Map();
  for (const fila of data.ventasDiarias) {
    if (fila.fecha < desde || fila.fecha > hasta) continue;
    if (categoria !== "__all__" && fila.categoria !== categoria) continue;
    const prev = porProducto.get(fila.codProducto) || {
      codProducto: fila.codProducto,
      producto: fila.producto,
      categoria: fila.categoria,
      cantidad: 0,
      monto: 0
    };
    prev.cantidad += fila.cantidad;
    prev.monto += fila.monto;
    porProducto.set(fila.codProducto, prev);
  }
  const rows = [...porProducto.values()].sort((a, b) => b.cantidad - a.cantidad);
  return state.top > 0 ? rows.slice(0, state.top) : rows;
}

function render() {
  const rows = productosAgregados();

  // Gráfico
  const ctx = document.getElementById("ventasChart").getContext("2d");
  const chartData = {
    labels: rows.map(r => r.producto),
    datasets: [{
      label: "Cantidad vendida",
      data: rows.map(r => r.cantidad),
      backgroundColor: primary,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 28
    }]
  };
  if (state.chart) {
    state.chart.data = chartData;
    state.chart.update();
  } else {
    state.chart = new Chart(ctx, {
      type: "bar",
      data: chartData,
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => `Cantidad vendida: ${fmtNum(item.parsed.x)}`
            }
          }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: border }, ticks: { color: textMuted } },
          y: { grid: { display: false }, ticks: { color: textMuted, autoSkip: false } }
        }
      }
    });
  }

  // Tabla
  const wrap = document.getElementById("tableWrap");
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="vp-empty">Sin ventas en este rango/categoría.</div>`;
  } else {
    const body = rows.map(r => `
      <tr>
        <td>${r.producto}</td>
        <td>${r.categoria}</td>
        <td class="num">${fmtNum(r.cantidad)}</td>
        <td class="num">Bs ${fmtNum(r.monto)}</td>
      </tr>
    `).join("");
    wrap.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Producto</th><th>Categoría</th><th class="num">Cantidad</th><th class="num">Monto</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  const actualizado = new Date(state.data.generatedAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
  document.getElementById("metaInfo").textContent =
    `${state.desde} a ${state.hasta} · ${rows.length} productos · datos al ${actualizado}`;
}

function populateControls() {
  const catSelect = document.getElementById("categoriaSelect");
  state.data.categorias.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catSelect.appendChild(opt);
  });
  catSelect.addEventListener("change", () => {
    state.categoria = catSelect.value;
    render();
  });

  document.getElementById("topSelect").addEventListener("change", (e) => {
    state.top = Number(e.target.value);
    render();
  });

  const desdeInput = document.getElementById("desdeInput");
  const hastaInput = document.getElementById("hastaInput");
  desdeInput.min = state.data.rango.desde;
  desdeInput.max = state.data.rango.hasta;
  hastaInput.min = state.data.rango.desde;
  hastaInput.max = state.data.rango.hasta;
  desdeInput.value = state.desde;
  hastaInput.value = state.hasta;

  desdeInput.addEventListener("change", () => {
    if (desdeInput.value > hastaInput.value) hastaInput.value = desdeInput.value;
    state.desde = desdeInput.value;
    state.hasta = hastaInput.value;
    render();
  });
  hastaInput.addEventListener("change", () => {
    if (hastaInput.value < desdeInput.value) desdeInput.value = hastaInput.value;
    state.desde = desdeInput.value;
    state.hasta = hastaInput.value;
    render();
  });
}

const AUTO_REFRESH_MS = 5 * 60 * 1000; // el pipeline en GitHub Actions corre cada 30 min; revisamos cada 5

async function loadData() {
  const res = await fetch(`data/ventas-por-producto.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refresh(isManual) {
  const btn = document.getElementById("refreshBtn");
  if (isManual && btn) { btn.disabled = true; btn.textContent = "↻ Actualizando…"; }
  try {
    const data = await loadData();
    const first = !state.data;
    state.data = data;
    if (first) {
      state.desde = data.rango.desde;
      state.hasta = data.rango.hasta;
    }
    const desdeInput = document.getElementById("desdeInput");
    const hastaInput = document.getElementById("hastaInput");
    desdeInput.min = data.rango.desde;
    desdeInput.max = data.rango.hasta;
    hastaInput.min = data.rango.desde;
    hastaInput.max = data.rango.hasta;
    if (first) {
      populateControls();
    }
    render();
  } catch (err) {
    document.getElementById("tableWrap").innerHTML =
      `<div class="vp-empty">No se pudo cargar data/ventas-por-producto.json (${err.message})</div>`;
  } finally {
    if (isManual && btn) { btn.disabled = false; btn.textContent = "↻ Actualizar"; }
  }
}

document.getElementById("refreshBtn").addEventListener("click", () => refresh(true));

refresh(false);
setInterval(() => refresh(false), AUTO_REFRESH_MS);
