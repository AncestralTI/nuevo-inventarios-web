// js/pages/om-bebidas.js
// Renderer de la página real "Om. Bebidas" del PBIX (sección 4.5 de ANALISIS_PBIX.md), con datos
// reales generados por pipeline/build-om-bebidas.mjs (data/om-bebidas.json). Mismo patrón que
// js/pages/an-bebidas.js (slicers, tabla resumen, gráfico, tabla detalle, cross-filtering, botón
// refresh + auto-refresh), agrupado por Dim_Producto_iZi[Producto] filtrado a categorías de
// bebidas de omuH. A diferencia de "Om. Insumos", SÍ tiene slicer "Filtro Dif" (confirmado en
// ANALISIS_PBIX.md sección 4.5/5: existe 'Most Om Beb' en el modelo).
//
// Nota de datos (documentada, no oculta -- ver README.md "Validación de Om. Bebidas"): el catálogo
// vivo de Dim_Producto_iZi tiene, para varios productos (p.ej. "Coca Cola"/"COCA COLA",
// "Sprite"/"SPRITE", "Fanta"/"FANTA"), DOS códigos históricos con distinta capitalización (uno de
// Ancestral, uno de omuH) que el modelo Power BI actualmente abierto todavía consolida bajo un solo
// nombre en algunas medidas -- el catálogo en vivo ya los separó. La suma de ambas variantes
// coincide exactamente con el valor validado contra DAX; se muestran ambas filas por fidelidad a
// los datos en vivo en vez de ocultar la distinción.

(function () {
  if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
  }

  const DATA_URL = "data/om-bebidas.json";
  const TITULO_MODULO = "Om. Bebidas";
  const FILTRO_PAGINA_TEXTO =
    "Categoría IN: 5. Bebidas alcohólicas, CERVEZA, GASEOSA, 4. Bebidas no alcohólicas";

  // Parámetro Om. Beb (sección 5 de ANALISIS_PBIX.md).
  const PARAMETRO_OPCIONES = [
    { label: "Vtas", key: "vtasIzi" },
    { label: "Vtas Ext.", key: "vtasExt" },
    { label: "Vtas PY", key: "vtasPY" },
    { label: "Vtas Tot.", key: "vtasTot" },
    { label: "Compras", key: "compras" },
  ];

  const FILTRO_DIF_OPCIONES = [
    { id: 1, label: "Todos" },
    { id: 2, label: "Dif = 0" },
    { id: 3, label: "Dif ≠ 0" },
  ];

  const DIA_ORDEN = { lun: 1, mar: 2, mié: 3, jue: 4, vie: 5, sáb: 6, dom: 7 };

  let cache = null;
  let chartInstance = null;
  let refreshTimer = null;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const state = {
    weekYear: null,
    producto: "__todos__",
    filtroDif: 1,
    parametro: "vtasTot",
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
      (r) => r.weekYear === state.weekYear && (state.producto === "__todos__" || r.producto === state.producto)
    );
  }

  /**
   * Aplica el criterio de "Filtro Dif" (Todos / Dif=0 / Dif<>0). Misma coerción BLANK()=0 de DAX
   * ya documentada y confirmada en vivo para 'Dif Om Beb' (ver measures-omuh.mjs::difOmBeb): un
   * producto con Dif en blanco cuenta como "Dif = 0", no como "Dif <> 0" -- mismo criterio que
   * an-bebidas.js.
   */
  function aplicarFiltroDif(rows) {
    if (state.filtroDif === 1) return rows;
    return rows.filter((r) => {
      const esCero = r.dif === null || r.dif === undefined || Math.abs(r.dif) < 0.005;
      return state.filtroDif === 2 ? esCero : !esCero;
    });
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
      <div class="kpi-card__label">Productos con diferencia</div>
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
    if (dif === null || dif === undefined) return "dif-zero";
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

    // Producto
    const wProducto = document.createElement("div");
    wProducto.className = "slicer";
    wProducto.innerHTML = `<label class="slicer__label">Producto</label>`;
    const selProducto = document.createElement("select");
    selProducto.className = "slicer__select";
    const optTodos = document.createElement("option");
    optTodos.value = "__todos__";
    optTodos.textContent = "Todos";
    if (state.producto === "__todos__") optTodos.selected = true;
    selProducto.appendChild(optTodos);
    data.productos
      .slice()
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        if (p === state.producto) opt.selected = true;
        selProducto.appendChild(opt);
      });
    selProducto.addEventListener("change", () => {
      state.producto = selProducto.value;
      onChange();
    });
    wProducto.appendChild(selProducto);
    grid.appendChild(wProducto);
    slicerRefs.selProducto = selProducto;

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

    // Parámetro (controla el gráfico)
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
    panel.innerHTML = `<h3 class="panel__title">Resumen inventario — ${weekLabel(data, state.weekYear)}</h3>`;
    let rows = aplicarFiltroDif(resumenSemanaActual(data));
    if (state.producto !== "__todos__") {
      rows = rows.filter((r) => r.producto === state.producto);
    }
    rows = rows.sort((a, b) => a.producto.localeCompare(b.producto, "es"));

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel__placeholder";
      empty.textContent = "Sin productos que cumplan el Filtro Dif seleccionado para esta semana.";
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
          <th>Producto</th>
          <th>Inv.-7</th>
          <th>Comp.</th>
          <th>Vtas</th>
          <th>Vtas Ext.</th>
          <th>Vtas PY</th>
          <th>Vtas Anc</th>
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
      if (r.producto === state.producto) tr.classList.add("is-selected");
      tr.innerHTML = `
        <td>${r.producto}</td>
        <td class="num">${fmtNum(r.invMenos7)}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.vtasIzi)}</td>
        <td class="num">${fmtNum(r.vtasExt)}</td>
        <td class="num">${fmtNum(r.vtasPY)}</td>
        <td class="num">${fmtNum(r.vtasAnc)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.vtasTot)}</td>
        <td class="num">${fmtNum(r.inv)}</td>
        <td class="num">${fmtNum(r.cierre)}</td>
        <td class="num dif-cell ${difClass(r.dif)}">${fmtNum(r.dif)}</td>
      `;
      tr.addEventListener("click", () => {
        state.producto = state.producto === r.producto ? "__todos__" : r.producto;
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
      const filtradas =
        state.filtroDif === 1
          ? rowsSemana
          : rowsSemana.filter((r) => {
              const esCero = r.dif === null || r.dif === undefined || Math.abs(r.dif) < 0.005;
              return state.filtroDif === 2 ? esCero : !esCero;
            });
      const scoped = state.producto === "__todos__" ? filtradas : filtradas.filter((r) => r.producto === state.producto);
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
    panel.innerHTML = `<h3 class="panel__title">Detalle de movimientos por producto</h3>`;
    let rows = data.detalleDiario.slice();
    if (state.producto !== "__todos__") {
      rows = rows.filter((r) => r.producto === state.producto);
    }
    rows = rows
      .slice()
      .sort(
        (a, b) =>
          a.producto.localeCompare(b.producto, "es") ||
          a.fecha.localeCompare(b.fecha) ||
          (DIA_ORDEN[a.dia] || 0) - (DIA_ORDEN[b.dia] || 0)
      );

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
          <th>Producto</th>
          <th>Fecha</th>
          <th>Día</th>
          <th>Comp.</th>
          <th>Vtas</th>
          <th>Vtas Ext.</th>
          <th>Vtas PY</th>
          <th>Vtas Anc</th>
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
      if (r.producto === state.producto) tr.classList.add("is-selected");
      tr.innerHTML = `
        <td>${r.producto}</td>
        <td>${fmtFechaCorta(r.fecha)}</td>
        <td>${r.dia}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.vtas)}</td>
        <td class="num">${fmtNum(r.vtasExt)}</td>
        <td class="num">${fmtNum(r.vtasPY)}</td>
        <td class="num">${fmtNum(r.vtasAnc)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.invEsperado)}</td>
        <td class="num">${r.invIniFin !== null ? fmtNum(r.invIniFin) : "—"}</td>
        <td class="num dif-cell ${r.dif !== null ? difClass(r.dif) : ""}">${r.dif !== null ? fmtNum(r.dif) : "—"}</td>
      `;
      tr.addEventListener("click", () => {
        state.producto = state.producto === r.producto ? "__todos__" : r.producto;
        onSelect();
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const note = document.createElement("p");
    note.className = "panel__note";
    note.textContent =
      "Se muestra la semana actual y la anterior. \"Inv. (Ini/Fin)\" solo tiene valor lunes " +
      "(apertura = Inv.-7) y domingo (cierre = Inv.) -- el conteo físico de bebidas de omuH " +
      "(Inventarios OMUH) es semanal, no diario, igual que en An. Bebidas/An. Vinos.";
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
        if (slicerRefs.selProducto) slicerRefs.selProducto.value = state.producto;
        rerenderAll();
      }

      const doRefresh = async (btn) => {
        if (btn) { btn.disabled = true; btn.textContent = "↻ Actualizando…"; }
        try {
          currentData = await loadData(true);
          renderSlicers(slicerPanel, currentData, applyFilters, doRefresh, slicerRefs);
          rerenderAll();
        } catch (err) {
          console.error("om-bebidas: error al actualizar", err);
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
      console.error("om-bebidas:", err);
    }
  }

  window.OmBebidasPage = { render };
})();
