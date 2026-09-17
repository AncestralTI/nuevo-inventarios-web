// Vista independiente: ventas por producto, filtrable por categoría.
// Lee data/ventas-por-producto.json (generado por pipeline/quick/ventas-por-producto.mjs
// a partir de datos reales de la API iZi — facturas + catálogo de productos).

const state = { data: null, categoria: "__all__", top: 15, chart: null };

const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#2f5d50";
const primaryLight = getComputedStyle(document.documentElement).getPropertyValue("--primary-light").trim() || "#e8f0ee";
const textMuted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#6b7280";
const border = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#e2e4e9";

function fmtNum(n) {
  return new Intl.NumberFormat("es-BO").format(n);
}

function filteredProductos() {
  const { data, categoria, top } = state;
  let rows = data.productos;
  if (categoria !== "__all__") {
    rows = rows.filter(p => p.categoria === categoria);
  }
  if (top > 0) rows = rows.slice(0, top);
  return rows;
}

function render() {
  const rows = filteredProductos();

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
    wrap.innerHTML = `<div class="vp-empty">Sin ventas en esta categoría en el rango consultado.</div>`;
    return;
  }
  const body = rows.map(r => `
    <tr>
      <td>${r.producto}</td>
      <td>${r.categoria}</td>
      <td class="num">${fmtNum(r.cantidad)}</td>
      <td class="num">Bs ${fmtNum(r.monto)}</td>
    </tr>
  `).join("");
  wrap.innerHTML = `
    <table class="vp-table">
      <thead><tr><th>Producto</th><th>Categoría</th><th class="num">Cantidad</th><th class="num">Monto</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
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

  document.getElementById("metaInfo").textContent =
    `${state.data.rango.desde} a ${state.data.rango.hasta} · ${state.data.productos.length} productos · fuente: ${state.data.fuente}`;
}

fetch("data/ventas-por-producto.json")
  .then(r => r.json())
  .then(data => {
    state.data = data;
    populateControls();
    render();
  })
  .catch(err => {
    document.getElementById("tableWrap").innerHTML =
      `<div class="vp-empty">No se pudo cargar data/ventas-por-producto.json (${err.message})</div>`;
  });
