// js/pages/an-vinos.js
// Renderer de la página real "An. Vinos" del PBIX (sección 4.2 de ANALISIS_PBIX.md), con datos
// reales generados por pipeline/build-an-vinos.mjs (data/an-vinos.json). Replica los slicers, la
// tabla "Resumen Inventario" (agrupada por Producto, no por Insumo como "An. Insumos"), el
// gráfico de barras por semana y la tabla "DETALLE DE MOVIMIENTOS POR PRODUCTO".
//
// "An. Vinos" y "An. Bebidas" comparten EXACTAMENTE el mismo layout/medidas en el PBIX original
// (solo cambia el filtro de categoría) -- por eso este renderer solo conoce `DATA_URL` y un par de
// textos de cabecera; cuando se active "An. Bebidas" más adelante, este mismo archivo se puede
// copiar cambiando esas dos constantes (o extraerlo a una función parametrizada, como ya se hizo
// en pipeline/lib/anc-beb-vin-pipeline.mjs para el pipeline).
//
// Expone window.AnVinosPage.render(el) para que js/app.js delegue el render de panelGrid/kpiRow
// cuando la página activa es "an-vinos".

(function () {
  const DATA_URL = "data/an-vinos.json";
  const TITULO_MODULO = "An. Vinos";
  const FILTRO_PAGINA_TEXTO = "Categoría IN: CERVEZA, VINOS, VINOS IMPORTADOS";

  // Parámetro An. Beb (sección 5 de ANALISIS_PBIX.md) -- compartido literalmente por An. Vinos y
  // An. Bebidas en el PBIX original (misma field parameter "Parámetro An. Beb").
  const PARAMETRO_OPCIONES = [
    { label: "Vtas", key: "vtas" },
    { label: "Vtas Ext", key: "vtasExt" },
    { label: "Cortesias", key: "cortesias" },
    { label: "Vtas Tot", key: "vtasTot" },
    { label: "Salidas", key: "salidas" },
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
    parametro: "vtas",
  };

  // Las medidas de "Anc. Beb y Vin" usan formatString "0" (o "#,0", mismos 0 decimales) en el
  // modelo original: sin decimales, redondeado al entero más cercano.
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

  /**
   * Si hay un Producto elegido en el slicer, TODO (KPIs, tabla resumen, detalle, gráfico) debe
   * quedar acotado a ese producto — igual que el cross-filtering nativo de un slicer en Power BI.
   */
  function resumenSemanaActual(data) {
    return data.resumenSemanal.filter(
      (r) => r.weekYear === state.weekYear && (state.producto === "__todos__" || r.producto === state.producto)
    );
  }

  /**
   * Aplica el criterio de "Filtro Dif" (Todos / Dif=0 / Dif<>0).
   *
   * OJO (comportamiento real del DAX original, verificado con dax_query_operations): en DAX,
   * comparar un número con BLANK() usando "=" trata BLANK() como equivalente a 0. Por eso
   * `Dif Anc Beb` sale en BLANK tanto cuando no hay inventario contado (sin filas) como cuando
   * `Inv. Anc Beb` es exactamente 0 (ver measures-anc-beb.mjs::difAncBeb) -- y la medida
   * `Most Anc Beb` (que impulsa este mismo filtro en el PBIX) hace `IF([Dif Anc Beb]=0,1,0)`, que
   * por la misma coerción también da TRUE cuando Dif es blank. Es decir: en el PBIX real, un
   * producto con Dif en blanco SÍ cuenta como "Dif = 0" y NO como "Dif <> 0". Replicamos eso tal
   * cual (a diferencia de "An. Insumos", que trata blank como "no cumple Dif=0" -- convención
   * distinta, documentada aquí porque en Beb/Vin SÍ se confirmó el comportamiento contra el modelo
   * real).
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

  function renderSlicers(panel, data, onChange, onRefresh) {
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

  function renderResumenSemanal(panel, data) {
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
    table.className = "data-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Producto</th>
          <th>Inv.-7</th>
          <th>Comp.</th>
          <th>Vtas</th>
          <th>Vtas Ext</th>
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
      tr.innerHTML = `
        <td>${r.producto}</td>
        <td class="num">${fmtNum(r.invMenos7)}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.vtas)}</td>
        <td class="num">${fmtNum(r.vtasExt)}</td>
        <td class="num">${fmtNum(r.cortesias)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.vtasTot)}</td>
        <td class="num">${fmtNum(r.inv)}</td>
        <td class="num">${fmtNum(r.cierre)}</td>
        <td class="num dif-cell ${difClass(r.dif)}">${fmtNum(r.dif)}</td>
      `;
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

  function renderChart(panel, data) {
    panel.innerHTML = `<h3 class="panel__title">${PARAMETRO_OPCIONES.find((o) => o.key === state.parametro).label} por semana (últimas 6 semanas)</h3>`;
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "260px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    panel.appendChild(canvasWrap);

    const last6 = data.semanas.slice(0, 6).slice().reverse();

    // Réplica aproximada de "Most Anc Beb=1": solo sumamos productos que pasan el Filtro Dif ESA
    // semana (ver nota equivalente en pipeline An. Insumos).
    const valores = last6.map((wy) => {
      const rowsSemana = data.resumenSemanal.filter((r) => r.weekYear === wy);
      const filtradas = state.filtroDif === 1
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
            backgroundColor: primary,
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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

  function renderDetalle(panel, data) {
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
    table.className = "data-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Producto</th>
          <th>Fecha</th>
          <th>Día</th>
          <th>Comp.</th>
          <th>Cort.</th>
          <th>Vtas</th>
          <th>Vtas Ext</th>
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
      tr.innerHTML = `
        <td>${r.producto}</td>
        <td>${fmtFechaCorta(r.fecha)}</td>
        <td>${r.dia}</td>
        <td class="num">${fmtNum(r.compras)}</td>
        <td class="num">${fmtNum(r.cortesias)}</td>
        <td class="num">${fmtNum(r.vtas)}</td>
        <td class="num">${fmtNum(r.vtasExt)}</td>
        <td class="num">${fmtNum(r.salidas)}</td>
        <td class="num">${fmtNum(r.invEsperado)}</td>
        <td class="num">${r.invIniFin !== null ? fmtNum(r.invIniFin) : "—"}</td>
        <td class="num dif-cell ${r.dif !== null ? difClass(r.dif) : ""}">${r.dif !== null ? fmtNum(r.dif) : "—"}</td>
      `;
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const note = document.createElement("p");
    note.className = "panel__note";
    note.textContent =
      "Se muestra la semana actual y la anterior. \"Inv. (Ini/Fin)\" solo tiene valor lunes " +
      "(apertura = Inv.-7) y domingo (cierre = Inv.) -- el conteo físico de bebidas/vinos es " +
      "semanal, no diario (réplica de la medida DAX Inv. Vis. Beb). \"Inv. Día Esp.\" replica " +
      "Inv. Esp. Beb (acumulado de compras/salidas día a día sobre el promedio de la semana " +
      "anterior).";
    panel.appendChild(note);
  }

  async function render(kpiRowEl, panelGridEl, filterChipsEl) {
    try {
      const data = await loadData();
      renderFilterChips(filterChipsEl);
      renderKpiRow(kpiRowEl, data);

      panelGridEl.innerHTML = "";

      const slicerPanel = document.createElement("div");
      slicerPanel.className = "panel panel--full";
      panelGridEl.appendChild(slicerPanel);

      const resumenPanel = document.createElement("div");
      resumenPanel.className = "panel panel--full";
      panelGridEl.appendChild(resumenPanel);

      const chartPanel = document.createElement("div");
      chartPanel.className = "panel";
      panelGridEl.appendChild(chartPanel);

      const detallePanel = document.createElement("div");
      detallePanel.className = "panel panel--full";
      panelGridEl.appendChild(detallePanel);

      let currentData = data;
      const rerenderAll = () => {
        renderKpiRow(kpiRowEl, currentData);
        renderResumenSemanal(resumenPanel, currentData);
        renderChart(chartPanel, currentData);
        renderDetalle(detallePanel, currentData);
      };

      const doRefresh = async (btn) => {
        if (btn) { btn.disabled = true; btn.textContent = "↻ Actualizando…"; }
        try {
          currentData = await loadData(true);
          renderSlicers(slicerPanel, currentData, rerenderAll, doRefresh);
          rerenderAll();
        } catch (err) {
          console.error("an-vinos: error al actualizar", err);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "↻ Actualizar"; }
        }
      };

      renderSlicers(slicerPanel, currentData, rerenderAll, doRefresh);
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
      console.error("an-vinos:", err);
    }
  }

  window.AnVinosPage = { render };
})();
