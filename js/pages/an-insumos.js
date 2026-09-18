// js/pages/an-insumos.js
// Renderer del módulo piloto "An. Insumos", con datos reales generados por
// pipeline/build-an-insumos.mjs (data/an-insumos.json). Replica los slicers, la
// tabla "RESUMEN SEMANAL POR PRODUCTO", el gráfico de barras por semana y la tabla
// "DETALLE DE MOVIMIENTOS POR PRODUCTO" de la página "An. Insumos" del PBIX original.
//
// Expone window.AnInsumosPage.render(el) para que js/app.js delegue el render de
// panelGrid/kpiRow cuando la página activa es "an-insumos".

(function () {
  const DATA_URL = "data/an-insumos.json";

  // Insumos excluidos por el filtro de página real del PBIX (sección 4.3 de ANALISIS_PBIX.md).
  const INSUMOS_EXCLUIDOS = new Set(["Entraña", "HUARI"]);

  const PARAMETRO_OPCIONES = [
    { label: "Vtas", key: "vtas" },
    { label: "Salidas", key: "salidas" },
    { label: "Vtas Tot", key: "vtasTot" },
    { label: "Compras (Un)", key: "compras" },
  ];

  const FILTRO_DIF_OPCIONES = [
    { id: 1, label: "Todos" },
    { id: 2, label: "Dif = 0" },
    { id: 3, label: "Dif ≠ 0" },
  ];

  const DIA_ORDEN = { lun: 1, mar: 2, mié: 3, jue: 4, vie: 5, sáb: 6, dom: 7 };

  let cache = null; // JSON descargado, cacheado entre renders mientras dure la sesión
  let chartInstance = null;
  let refreshTimer = null;
  const AUTO_REFRESH_MS = 5 * 60 * 1000; // el pipeline en GitHub Actions corre cada 30 min; revisamos cada 5

  const state = {
    weekYear: null, // se fija a la semana más reciente al cargar
    insumo: "__todos__",
    filtroDif: 1,
    parametro: "vtas", // key de PARAMETRO_OPCIONES, default "Vtas" como en el PBIX
  };

  // Las 13 medidas de "Anc. Insumos" usan formatString "0" en el modelo original
  // (ver ANALISIS_PBIX.md sección 3.1): sin decimales, redondeado al entero más cercano.
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
      state.weekYear = cache.semanas[0]; // semana más reciente por defecto
    }
    return cache;
  }

  function insumosVisibles(data) {
    return data.insumos.filter((i) => !INSUMOS_EXCLUIDOS.has(i));
  }

  function weekLabel(data, weekYear) {
    const info = (data.semanasInfo || []).find((w) => w.weekYear === weekYear);
    if (!info) return weekYear;
    return `${weekYear} (${fmtFechaCorta(info.desde)} – ${fmtFechaCorta(info.hasta)})`;
  }

  /**
   * Filtra resumenSemanal a la semana seleccionada + insumos visibles del filtro de página.
   * Si hay un Insumo elegido en el slicer, TODO (KPIs, tabla resumen, detalle, gráfico) debe
   * quedar acotado a ese insumo — igual que el cross-filtering nativo de un slicer en Power BI.
   */
  function resumenSemanaActual(data) {
    const visibles = new Set(insumosVisibles(data));
    return data.resumenSemanal.filter(
      (r) =>
        r.weekYear === state.weekYear &&
        visibles.has(r.insumo) &&
        (state.insumo === "__todos__" || r.insumo === state.insumo)
    );
  }

  /** Aplica el criterio de "Filtro Dif" (Todos / Dif=0 / Dif<>0) sobre las filas del resumen. */
  function aplicarFiltroDif(rows) {
    if (state.filtroDif === 1) return rows;
    return rows.filter((r) => {
      if (r.dif === null || r.dif === undefined) return state.filtroDif === 3; // blank cuenta como "no cumple 0 exacto"
      if (state.filtroDif === 2) return Math.abs(r.dif) < 0.005; // Dif = 0 (con tolerancia por redondeo)
      return Math.abs(r.dif) >= 0.005; // Dif <> 0
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function renderFilterChips(container) {
    container.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "Insumo NOT IN: Entraña, HUARI, (en blanco)";
    container.appendChild(chip);
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

    const rows = aplicarFiltroDif(resumenSemanaActual(data));
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
    if (dif < -0.005) return "dif-neg"; // faltante -> naranja
    if (dif > 0.005) return "dif-pos"; // sobrante -> morado
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
    head.innerHTML = `<h3 class="panel__title">Filtros — An. Insumos</h3>`;
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
    insumosVisibles(data)
      .slice()
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((i) => {
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

    // Filtro Dif
    const wFiltro = document.createElement("div");
    wFiltro.className = "slicer";
    wFiltro.innerHTML = `<label class="slicer__label">Filtro Dif</label>`;
    const selFiltro = document.createElement("select");
    selFiltro.className = "slicer__select";
    FILTRO_DIF_OPCIONES.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = String(o.id);
      opt.textContent = o.label;
      if (o.id === state.filtroDif) opt.selected = true;
      selFiltro.appendChild(opt);
    });
    selFiltro.addEventListener("change", () => {
      state.filtroDif = Number(selFiltro.value);
      onChange();
    });
    wFiltro.appendChild(selFiltro);
    grid.appendChild(wFiltro);

    // Parámetro An. Ins (controla el gráfico)
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
    panel.innerHTML = `<h3 class="panel__title">Resumen semanal por producto — ${weekLabel(data, state.weekYear)}</h3>`;
    const rows = aplicarFiltroDif(resumenSemanaActual(data)).sort((a, b) =>
      a.insumo.localeCompare(b.insumo, "es")
    );

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel__placeholder";
      empty.textContent = "Sin insumos que cumplan el Filtro Dif seleccionado para esta semana.";
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
        <td class="num">${fmtNum(r.vtas)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.vtasTot)}</td>
        <td class="num">${fmtNum(r.inv)}</td>
        <td class="num">${fmtNum(r.cierre)}</td>
        <td class="num dif-cell ${difClass(r.dif)}">${fmtNum(r.dif)}</td>
      `;
      // Cross-filter: clic en una fila = elegirla en el slicer Insumo (clic de nuevo = quitar filtro).
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

    const visibles = new Set(insumosVisibles(data));
    const last6 = data.semanas.slice(0, 6).slice().reverse(); // cronológico ascendente

    // Para cada semana: solo sumamos insumos que pasan el Filtro Dif ESA semana (réplica
    // aproximada de "Most Anc Ins=1" del PBIX -- ver nota en pipeline/build-an-insumos.mjs).
    const valores = last6.map((wy) => {
      const rowsSemana = data.resumenSemanal.filter((r) => r.weekYear === wy && visibles.has(r.insumo));
      const filtradas = state.filtroDif === 1
        ? rowsSemana
        : rowsSemana.filter((r) => {
            if (r.dif === null || r.dif === undefined) return state.filtroDif === 3;
            return state.filtroDif === 2 ? Math.abs(r.dif) < 0.005 : Math.abs(r.dif) >= 0.005;
          });
      const scoped = state.insumo === "__todos__" ? filtradas : filtradas.filter((r) => r.insumo === state.insumo);
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
          // Cross-filter: clic en una barra = elegir esa semana (clic de nuevo = volver a la última).
          state.weekYear = state.weekYear === wy ? data.semanas[0] : wy;
          onSelect();
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
            },
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
    panel.innerHTML = `<h3 class="panel__title">Detalle de movimientos por producto</h3>`;
    const visibles = new Set(insumosVisibles(data));
    let rows = data.detalleDiario.filter((r) => visibles.has(r.insumo));
    if (state.insumo !== "__todos__") {
      rows = rows.filter((r) => r.insumo === state.insumo);
    }
    rows = rows
      .slice()
      .sort((a, b) => a.insumo.localeCompare(b.insumo, "es") || a.fecha.localeCompare(b.fecha));

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
          <th>Inv. (Ini/Fin)</th>
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
        <td class="num dif-cell ${difClass(r.dif)}">${r.dif !== null ? fmtNum(r.dif) : "—"}</td>
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
      "Se muestra la semana actual y la anterior. \"Inv. Día Esp.\" replica la medida DAX Inv. Esp. Anc Ins " +
      "(ver nota de discrepancia conocida del modelo original en pipeline/lib/measures-an-insumos.mjs).";
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

      // Cross-filtering: un clic en una fila de tabla o una barra del gráfico cambia el
      // state igual que tocar un slicer. Sincronizamos los <select> existentes en vez de
      // reconstruir todo el panel de slicers (así no se pierde el foco al usarlos a mano).
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
          console.error("an-insumos: error al actualizar", err);
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
      console.error("an-insumos:", err);
    }
  }

  window.AnInsumosPage = { render };
})();
