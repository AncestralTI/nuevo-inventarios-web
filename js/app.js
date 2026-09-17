// Estructura de marcas/páginas confirmada directamente en Report/definition/pages/*/page.json
// del archivo Nuevo Inventarios.pbix. Los filtros de página mostrados aquí son los reales
// (extraídos del filterConfig de cada página). Las medidas/tablas/gráficos de cada panel
// se completarán en cuanto termine la extracción del modelo TMDL (ANALISIS_PBIX.md).

const DASHBOARD = {
  ancestral: {
    label: "Ancestral",
    pages: [
      {
        id: "an-bebidas",
        title: "An. Bebidas",
        filters: ["Categoría IN: 5. Bebidas alcohólicas, GASEOSA, CERVEZA"],
        panels: ["Tabla / gráfico de inventario de bebidas (pendiente de mapear medidas)"]
      },
      {
        id: "an-vinos",
        title: "An. Vinos",
        filters: ["Categoría IN: CERVEZA, VINOS, VINOS IMPORTADOS"],
        panels: ["Tabla / gráfico de inventario de vinos (pendiente de mapear medidas)"]
      },
      {
        id: "an-insumos",
        title: "An. Insumos",
        filters: ["Insumo NOT IN: Entraña, HUARI, (en blanco)"],
        panels: ["Tabla / gráfico de inventario de insumos (pendiente de mapear medidas)"]
      }
    ]
  },
  omuh: {
    label: "omuH",
    pages: [
      {
        id: "om-insumos",
        title: "Om. Insumos",
        filters: ["Categoría (selección invertida)", "Insumo (selección invertida)"],
        panels: ["Tabla / gráfico de inventario de insumos (pendiente de mapear medidas)"]
      },
      {
        id: "om-bebidas",
        title: "Om. Bebidas",
        filters: ["Categoría IN: 5. Bebidas alcohólicas, CERVEZA, GASEOSA, 4. Bebidas no alcohólicas"],
        panels: ["Tabla / gráfico de inventario de bebidas (pendiente de mapear medidas)"]
      }
    ]
  }
};

let activeBrand = "ancestral";
// "An. Insumos" es la página activa por defecto en el PBIX original (sección 4.3 de
// ANALISIS_PBIX.md) y además el único módulo con datos/medidas reales por ahora.
let activePageId = (DASHBOARD[activeBrand].pages.find(p => p.id === "an-insumos") || DASHBOARD[activeBrand].pages[0]).id;

function renderBrandNav() {
  document.querySelectorAll(".brandnav__btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.brand === activeBrand);
  });
}

function renderPageNav() {
  const nav = document.getElementById("pagenav");
  nav.innerHTML = "";
  DASHBOARD[activeBrand].pages.forEach(page => {
    const btn = document.createElement("button");
    btn.className = "pagenav__btn" + (page.id === activePageId ? " is-active" : "");
    btn.textContent = page.title;
    btn.addEventListener("click", () => {
      activePageId = page.id;
      renderPageNav();
      renderContent();
    });
    nav.appendChild(btn);
  });
}

function renderContent() {
  const page = DASHBOARD[activeBrand].pages.find(p => p.id === activePageId);

  const chips = document.getElementById("filterChips");
  const kpiRow = document.getElementById("kpiRow");
  const grid = document.getElementById("panelGrid");

  // "An. Insumos" es el módulo piloto con datos y medidas reales: delega el render
  // completo (chips/KPI/paneles) a js/pages/an-insumos.js en vez del placeholder genérico.
  if (page.id === "an-insumos" && window.AnInsumosPage) {
    window.AnInsumosPage.render(kpiRow, grid, chips);
    return;
  }

  // "An. Vinos" es el segundo módulo con datos y medidas reales (misma arquitectura que
  // An. Insumos, agrupado por Dim_Producto_iZi[Producto] -- ver pipeline/lib/anc-beb-vin-pipeline.mjs).
  // "An. Bebidas" comparte el mismo pipeline/medidas pero todavía NO se activa aquí a propósito.
  if (page.id === "an-vinos" && window.AnVinosPage) {
    window.AnVinosPage.render(kpiRow, grid, chips);
    return;
  }

  chips.innerHTML = "";
  page.filters.forEach(f => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = f;
    chips.appendChild(chip);
  });

  kpiRow.innerHTML = "";
  ["Medida 1", "Medida 2", "Medida 3", "Medida 4"].forEach(label => {
    const card = document.createElement("div");
    card.className = "kpi-card";
    card.innerHTML = `
      <div class="kpi-card__label">${label}</div>
      <div class="kpi-card__value is-placeholder">pendiente</div>
    `;
    kpiRow.appendChild(card);
  });

  grid.innerHTML = "";
  page.panels.forEach(panelText => {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <h3 class="panel__title">${page.title}</h3>
      <div class="panel__placeholder">${panelText}</div>
    `;
    grid.appendChild(panel);
  });
}

document.querySelectorAll(".brandnav__btn").forEach(btn => {
  btn.addEventListener("click", () => {
    activeBrand = btn.dataset.brand;
    activePageId = DASHBOARD[activeBrand].pages[0].id;
    renderBrandNav();
    renderPageNav();
    renderContent();
  });
});

renderBrandNav();
renderPageNav();
renderContent();
