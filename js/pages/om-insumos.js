// js/pages/om-insumos.js
// Renderer de la página real "Om. Insumos" del PBIX (sección 4.4 de ANALISIS_PBIX.md), con datos
// reales generados por pipeline/build-om-insumos.mjs (data/om-insumos.json). Mismo patrón que
// js/pages/an-insumos.js (slicers, tabla resumen, gráfico, tabla detalle, cross-filtering, botón
// refresh + auto-refresh), con dos diferencias reales del PBIX original:
//   1. Se agrupa por Tabla[Insumo], que en el modelo real tiene SOLO 3 valores posibles
//      ("Carne Molida 130g", "Pechuga de Pollo", "Pesca Amazonica" -- confirmado en vivo con
//      dax_query_operations, ver pipeline/lib/measures-omuh.mjs) en vez de la lista larga de
//      insumos de "An. Insumos".
//   2. NO tiene slicer "Filtro Dif" (confirmado en ANALISIS_PBIX.md sección 5: no existe una
//      medida "Most Om Ins" en el modelo, y la página no tiene ese slicer).
//
// Simplificación deliberada de frontend (documentada, no oculta -- ver README.md): el PBIX
// original tiene 3 pivotTables en esta página (resumen semanal, un drill jerárquico
// Insumo→Producto→Fecha, y una matriz cruzada semana×insumo). Acá se implementa el mismo patrón
// de 1 tabla resumen + 1 gráfico + 1 tabla detalle ya usado en "An. Insumos"/"An. Bebidas", no los
// 3 pivots literales -- la prioridad es que los NÚMEROS sean correctos (validados número por
// número contra el modelo real), no la réplica visual exacta de cada pivotTable.

(function () {
  if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
  }

  const DATA_URL = "data/om-insumos.json";
  const TITULO_MODULO = "Om. Insumos";
  const FILTRO_PAGINA_TEXTO = "Insumo (Tabla[Insumo], selección invertida) — Categoría/Producto";

  // Parámetro Om. Ins (sección 5 de ANALISIS_PBIX.md).
  const PARAMETRO_OPCIONES = [
    { label: "Vtas", key: "vtasIzi" },
    { label: "Vtas Anc", key: "vtasAnc" },
    { label: "Vtas PY", key: "vtasPY" },
    { label: "Vtas Ext.", key: "vtasExt" },
    { label: "Cortesias", key: "cortesias" },
    { label: "Salidas", key: "salidas" },
    { label: "Vtas Tot.", key: "vtasTot" },
    { label: "Compras", key: "compras" },
  ];

  let cache = null;
  let chartInstance = null;
  let refreshTimer = null;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const state = {
    weekYear: null,
    insumo: "__todos__",
    parametro: "vtasIzi",
  };

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    return Math.round(n).toLocaleString("es-BO", { maximumFractionDigits: 0 });
  }

  function fmtFechaCorta(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y.slice(2)}`;
  }

  async function loadData(force) {
    if (cache && !force) return cache;
    const url = force ? `${DATA_URL}?t=${Date.now()}` : DATA_URL;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo cargar ${DATA_URL}: HTTP ${res.status}`);
    cache = await res.json();
    if (!state.weekYear && cache.semanas && cache.semanas.length) {
      state.weekYear = cache.semanas[0];
    }
    return cache;
  }

  function weekLabel(data, weekYear) {
    const info = (data.semanasInfo || []).find((w) => w.weekYear === weekYear);
    if (!info) return weekYear;
    return `${weekYear} (${fmtFechaCorta(info.desde)} – ${fmtFechaCorta(info.hasta)})`;
  }

  function resumenSemanaActual(data) {
    return data.resumenSemanal.filter(
      (r) => r.weekYear === state.weekYear && (state.insumo === "__todos__" || r.insumo === state.insumo)
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function renderFilterChips(container) {
    container.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = FILTRO_PAGINA_TEXTO;
    container.appendChild(chip);
    const chip2 = document.createElement("span");
    chip2.className = "chip";
    chip2.textContent = "Sin slicer Filtro Dif (no existe medida \"Most Om Ins\" en el modelo original)";
    container.appendChild(chip2);
  }

  function renderKpiRow(container, data) {
    container.innerHTML = "";
    const card = document.createElement("div");
    card.className = "kpi-card";
    const rangoTexto = `${fmtFechaCorta(data.rangoFechas.desde)} – ${fmtFechaCorta(data.rangoFechas.hasta)}`;
    card.innerHTML = `
      <div class="kpi-card__label">Rango de fechas</div>
      <div class="kpi-card__value" style="font-size:18px;">${rangoTexto}</div>
    `;
    container.appendChild(card);

    const semanaCard = document.createElement("div");
    semanaCard.className = "kpi-card";
    const info = (data.semanasInfo || []).find((w) => w.weekYear === state.weekYear);
    const semanaTexto = info ? `${fmtFechaCorta(info.desde)} – ${fmtFechaCorta(info.hasta)}` : "—";
    semanaCard.innerHTML = `
      <div class="kpi-card__label">Semana seleccionada</div>
      <div class="kpi-card__value" style="font-size:18px;">${semanaTexto}</div>
    `;
    container.appendChild(semanaCard);

    const rows = resumenSemanaActual(data);
    const totalDif = rows.reduce((acc, r) => acc + (r.dif || 0), 0);
    const conDiferencia = rows.filter((r) => r.dif !== null && Math.abs(r.dif) >= 0.005).length;

    const difCard = document.createElement("div");
    difCard.className = "kpi-card";
    difCard.innerHTML = `
      <div class="kpi-card__label">Insumos con diferencia</div>
      <div class="kpi-card__value">${conDiferencia} / ${rows.length}</div>
    `;
    container.appendChild(difCard);

    const sumCard = document.createElement("div");
    sumCard.className = "kpi-card";
    sumCard.innerHTML = `
      <div class="kpi-card__label">Suma de diferencias (semana)</div>
      <div class="kpi-card__value">${fmtNum(totalDif)}</div>
    `;
    container.appendChild(sumCard);
  }

  function difClass(dif) {
    if (dif === null || dif === undefined) return "";
    if (dif < -0.005) return "dif-neg";
    if (dif > 0.005) return "dif-pos";
    return "dif-zero";
  }

  function fmtHora(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
  }

  function renderSlicers(panel, data, onChange, onRefresh, slicerRefs) {
    panel.innerHTML = "";
    const head = document.createElement("div");
    head.className = "panel__head";
    head.innerHTML = `<h3 class="panel__title">Filtros — ${TITULO_MODULO}</h3>`;
    const refreshWrap = document.createElement("div");
    refreshWrap.className = "refresh-wrap";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "refresh-btn";
    refreshBtn.textContent = "↻ Actualizar";
    refreshBtn.addEventListener("click", () => onRefresh(refreshBtn));
    const refreshLabel = document.createElement("span");
    refreshLabel.className = "refresh-label";
    refreshLabel.textContent = `Datos al ${fmtHora(data.generatedAt)}`;
    refreshWrap.appendChild(refreshBtn);
    refreshWrap.appendChild(refreshLabel);
    head.appendChild(refreshWrap);
    panel.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "slicer-grid";
    panel.appendChild(grid);

    // Semana Año
    const wSemana = document.createElement("div");
    wSemana.className = "slicer";
    wSemana.innerHTML = `<label class="slicer__label">Semana Año</label>`;
    const selSemana = document.createElement("select");
    selSemana.className = "slicer__select";
    data.semanas.forEach((wy) => {
      const opt = document.createElement("option");
      opt.value = wy;
      opt.textContent = weekLabel(data, wy);
      if (wy === state.weekYear) opt.selected = true;
      selSemana.appendChild(opt);
    });
    selSemana.addEventListener("change", () => {
      state.weekYear = selSemana.value;
      onChange();
    });
    wSemana.appendChild(selSemana);
    grid.appendChild(wSemana);
    slicerRefs.selSemana = selSemana;

    // Insumo
    const wInsumo = document.createElement("div");
    wInsumo.className = "slicer";
    wInsumo.innerHTML = `<label class="slicer__label">Insumo</label>`;
    const selInsumo = document.createElement("select");
    selInsumo.className = "slicer__select";
    const optTodos = document.createElement("option");
    optTodos.value = "__todos__";
    optTodos.textContent = "Todos";
    if (state.insumo === "__todos__") optTodos.selected = true;
    selInsumo.appendChild(optTodos);
    data.insumos.forEach((i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      if (i === state.insumo) opt.selected = true;
      selInsumo.appendChild(opt);
    });
    selInsumo.addEventListener("change", () => {
      state.insumo = selInsumo.value;
      onChange();
    });
    wInsumo.appendChild(selInsumo);
    grid.appendChild(wInsumo);
    slicerRefs.selInsumo = selInsumo;

    // Parámetro (controla el gráfico) -- sin Filtro Dif, ver nota de cabecera.
    const wParam = document.createElement("div");
    wParam.className = "slicer";
    wParam.innerHTML = `<label class="slicer__label">Parámetro (gráfico)</label>`;
    const selParam = document.createElement("select");
    selParam.className = "slicer__select";
    PARAMETRO_OPCIONES.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.key;
      opt.textContent = o.label;
      if (o.key === state.parametro) opt.selected = true;
      selParam.appendChild(opt);
    });
    selParam.addEventListener("change", () => {
      state.parametro = selParam.value;
      onChange();
    });
    wParam.appendChild(selParam);
    grid.appendChild(wParam);
  }

  function renderResumenSemanal(panel, data, onSelect) {
    panel.innerHTML = `<h3 class="panel__title">Resumen semanal por insumo — ${weekLabel(data, state.weekYear)}</h3>`;
    const rows = resumenSemanaActual(data).sort((a, b) => a.insumo.localeCompare(b.insumo, "es"));

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel__placeholder";
      empty.textContent = "Sin insumos para esta semana.";
      panel.appendChild(empty);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "data-table data-table--clickable";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Insumo</th>
          <th>Inv.-7</th>
          <th>Comp.</th>
          <th>Vtas</th>
          <th>Vtas Anc</th>
          <th>Vtas PY</th>
          <th>Vtas Ext.</th>
          <th>Vtas Veg.</th>
          <th>Cort.</th>
          <th>Sal.</th>
          <th>Vtas Tot.</th>
          <th>Inv.</th>
          <th>Cie.</th>
          <th>Dif.</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.insumo === state.insumo) tr.classList.add("is-selected");
      tr.innerHTML = `
        <td>${r.insumo}</td>
        <td class="num">${fmtNum(r.invMenos7)}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.vtasIzi)}</td>
        <td class="num">${fmtNum(r.vtasAnc)}</td>
        <td class="num">${fmtNum(r.vtasPY)}</td>
        <td class="num">${fmtNum(r.vtasExt)}</td>
        <td class="num">${fmtNum(r.vtasVegg)}</td>
        <td class="num">${fmtNum(r.cortesias)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.vtasTot)}</td>
        <td class="num">${fmtNum(r.inv)}</td>
        <td class="num">${fmtNum(r.cierre)}</td>
        <td class="num dif-cell ${difClass(r.dif)}">${fmtNum(r.dif)}</td>
      `;
      tr.addEventListener("click", () => {
        state.insumo = state.insumo === r.insumo ? "__todos__" : r.insumo;
        onSelect();
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const legend = document.createElement("div");
    legend.className = "dif-legend";
    legend.innerHTML = `
      <span class="dif-legend__item"><span class="dif-swatch dif-neg"></span> Faltante (Dif &lt; 0)</span>
      <span class="dif-legend__item"><span class="dif-swatch dif-pos"></span> Sobrante (Dif &gt; 0)</span>
    `;
    panel.appendChild(legend);
  }

  function renderChart(panel, data, onSelect) {
    panel.innerHTML = `<h3 class="panel__title">${PARAMETRO_OPCIONES.find((o) => o.key === state.parametro).label} por semana (últimas 6 semanas)</h3>`;
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "chart-canvas-wrap";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    panel.appendChild(canvasWrap);

    const last6 = data.semanas.slice(0, 6).slice().reverse();

    const valores = last6.map((wy) => {
      const rowsSemana = data.resumenSemanal.filter((r) => r.weekYear === wy);
      const scoped = state.insumo === "__todos__" ? rowsSemana : rowsSemana.filter((r) => r.insumo === state.insumo);
      return scoped.reduce((acc, r) => acc + (r[state.parametro] || 0), 0);
    });

    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue("--primary").trim() || "#2f5d50";
    const accent = styles.getPropertyValue("--accent").trim() || "#c9a24b";
    const colors = last6.map((wy) => (wy === state.weekYear ? accent : primary));

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    if (typeof Chart === "undefined") {
      const warn = document.createElement("div");
      warn.className = "panel__placeholder";
      warn.textContent = "Chart.js no cargó (revisa la conexión a la CDN).";
      panel.appendChild(warn);
      return;
    }
    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: last6,
        datasets: [
          {
            label: PARAMETRO_OPCIONES.find((o) => o.key === state.parametro).label,
            data: valores,
            backgroundColor: colors,
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const wy = last6[elements[0].index];
          state.weekYear = state.weekYear === wy ? data.semanas[0] : wy;
          onSelect();
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
            },
          },
          datalabels: {
            anchor: "end",
            align: "top",
            color: getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#1f2430",
            font: { weight: "700", size: 11 },
            formatter: (value) => fmtNum(value),
          },
        },
        scales: {
          y: { beginAtZero: true, grid: { color: "rgba(128,128,128,0.15)" } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function renderDetalle(panel, data, onSelect) {
    panel.innerHTML = `<h3 class="panel__title">Detalle de movimientos por insumo</h3>`;
    let rows = data.detalleDiario.slice();
    if (state.insumo !== "__todos__") {
      rows = rows.filter((r) => r.insumo === state.insumo);
    }
    rows = rows.slice().sort((a, b) => a.insumo.localeCompare(b.insumo, "es") || a.fecha.localeCompare(b.fecha));

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel__placeholder";
      empty.textContent = "Sin movimientos recientes para mostrar (semana actual/anterior).";
      panel.appendChild(empty);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "data-table data-table--clickable";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Insumo</th>
          <th>Fecha</th>
          <th>Día</th>
          <th>Comp.</th>
          <th>Vtas</th>
          <th>Sal.</th>
          <th>Inv. Día Esp.</th>
          <th>Inv. (Fin)</th>
          <th>Dif.</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.insumo === state.insumo) tr.classList.add("is-selected");
      tr.innerHTML = `
        <td>${r.insumo}</td>
        <td>${fmtFechaCorta(r.fecha)}</td>
        <td>${r.dia}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.vtas)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.invEsperado)}</td>
        <td class="num">${r.invFin !== null ? fmtNum(r.invFin) : "—"}</td>
        <td class="num dif-cell ${r.dif !== null ? difClass(r.dif) : ""}">${r.dif !== null ? fmtNum(r.dif) : "—"}</td>
      `;
      tr.addEventListener("click", () => {
        state.insumo = state.insumo === r.insumo ? "__todos__" : r.insumo;
        onSelect();
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const note = document.createElement("p");
    note.className = "panel__note";
    note.textContent =
      "Se muestra la semana actual y la anterior. \"Vtas\" en esta tabla de detalle diario es la suma " +
      "de Vtas Izi + Cortesías + Salidas del día (no incluye Vtas PY/Ext./Vegg/Anc, que se muestran " +
      "sólo en el resumen semanal). \"Om. Insumos\" agrupa sólo 3 insumos reales (Carne Molida 130g, " +
      "Pechuga de Pollo, Pesca Amazonica) -- confirmado contra el modelo Power BI real, no es una " +
      "limitación de esta réplica.";
    panel.appendChild(note);
  }

  async function render(kpiRowEl, panelGridEl, filterChipsEl) {
    try {
      const data = await loadData();
      renderFilterChips(filterChipsEl);
      renderKpiRow(kpiRowEl, data);

      panelGridEl.innerHTML = "";
      panelGridEl.classList.add("panel-grid--dashboard");

      const slicerPanel = document.createElement("div");
      slicerPanel.className = "panel panel--slicers";
      panelGridEl.appendChild(slicerPanel);

      const resumenPanel = document.createElement("div");
      resumenPanel.className = "panel panel--resumen";
      panelGridEl.appendChild(resumenPanel);

      const chartPanel = document.createElement("div");
      chartPanel.className = "panel panel--chart";
      panelGridEl.appendChild(chartPanel);

      const detallePanel = document.createElement("div");
      detallePanel.className = "panel panel--detalle";
      panelGridEl.appendChild(detallePanel);

      const slicerRefs = {};
      let currentData = data;

      const rerenderAll = () => {
        renderKpiRow(kpiRowEl, currentData);
        renderResumenSemanal(resumenPanel, currentData, applyFilters);
        renderChart(chartPanel, currentData, applyFilters);
        renderDetalle(detallePanel, currentData, applyFilters);
      };

      function applyFilters() {
        if (slicerRefs.selSemana) slicerRefs.selSemana.value = state.weekYear;
        if (slicerRefs.selInsumo) slicerRefs.selInsumo.value = state.insumo;
        rerenderAll();
      }

      const doRefresh = async (btn) => {
        if (btn) { btn.disabled = true; btn.textContent = "↻ Actualizando…"; }
        try {
          currentData = await loadData(true);
          renderSlicers(slicerPanel, currentData, applyFilters, doRefresh, slicerRefs);
          rerenderAll();
        } catch (err) {
          console.error("om-insumos: error al actualizar", err);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "↻ Actualizar"; }
        }
      };

      renderSlicers(slicerPanel, currentData, applyFilters, doRefresh, slicerRefs);
      rerenderAll();

      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        if (!document.body.contains(slicerPanel)) {
          clearInterval(refreshTimer);
          refreshTimer = null;
          return;
        }
        doRefresh(null);
      }, AUTO_REFRESH_MS);
    } catch (err) {
      panelGridEl.innerHTML = "";
      const errPanel = document.createElement("div");
      errPanel.className = "panel panel--full";
      errPanel.innerHTML = `<h3 class="panel__title">Error cargando datos</h3><div class="panel__placeholder">${err.message}</div>`;
      panelGridEl.appendChild(errPanel);
      console.error("om-insumos:", err);
    }
  }

  window.OmInsumosPage = { render };
})();
