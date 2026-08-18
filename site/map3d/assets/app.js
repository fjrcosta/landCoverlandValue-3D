const CLASS_COLORS = {
  bare: '#bf8040',
  bush: '#009900',
  crop: '#ffdf99',
  grass: '#33ff33',
  hduf: '#69000d',
  industrial: '#e93529',
  lduf: '#c7171c',
  mduf: '#a10e15',
  tree: '#003300',
  water: '#0b9fd5'
};

const CLASS_SHORT_LABELS = {
  bare: 'Bare soil',
  bush: 'Shrubs',
  crop: 'Row crops',
  grass: 'Grass / pasture',
  hduf: 'High-density urban',
  industrial: 'Industrial',
  lduf: 'Low-density urban',
  mduf: 'Medium-density urban',
  tree: 'Trees',
  water: 'Water'
};

const VALUE_STOPS = [
  '#000080', '#0000cc', '#0040ff', '#0080ff', '#00bfff', '#00ffff',
  '#00ffbf', '#00ff80', '#00ff40', '#00ff00', '#40ff00', '#80ff00',
  '#bfff00', '#ffff00', '#ffbf00', '#ff8000', '#ff4000', '#ff0000'
];

const REGION_BOUNDS = [[-52.04, -23.69], [-50.94, -23.18]];
const INITIAL_VIEW = { center: [-51.50, -23.42], zoom: 9.25, pitch: 52, bearing: -17 };

const state = {
  manifest: null,
  cityCache: new Map(),
  currentCells: [],
  selectedCity: 'all',
  mode: 'integrated',
  heightScale: 1,
  colorBlend: 0.22,
  selectedClasses: new Set(),
  showLabels: true,
  showBuildings: true,
  tourTimer: null,
  tourIndex: 0,
  overlay: null,
  map: null,
  buildingLayerId: null,
  hoverObject: null
};

const dom = {};

function bindDom() {
  const ids = [
    'datasetBadge', 'tourButton', 'resetButton', 'cellCount', 'citySelect',
    'heightScale', 'heightScaleOutput', 'colorBlend', 'colorBlendOutput',
    'classFilters', 'toggleClasses', 'buildingsToggle', 'labelsToggle',
    'downloadButton', 'aboutButton', 'insightPanel', 'selectionTitle', 'selectionModel',
    'p10Metric', 'medianMetric', 'p90Metric', 'classMetric', 'confidenceMetric',
    'distributionTotal', 'distributionBar', 'classBreakdown', 'extentMetric', 'legendMin',
    'legendMedian', 'legendMax', 'hoverCard', 'loadingOverlay', 'errorBanner',
    'aboutDialog', 'dataWarning', 'blendSection', 'heightSection'
  ];
  ids.forEach(id => { dom[id] = document.getElementById(id); });
  dom.modeButtons = [...document.querySelectorAll('[data-mode]')];
}

function hexToRgb(hex, alpha = 255) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha
  ];
}

function mixColor(a, b, ratio, alpha = 230) {
  const t = Math.max(0, Math.min(1, ratio));
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
    alpha
  ];
}

function interpolateValueColor(t, alpha = 235) {
  const x = Math.max(0, Math.min(1, t));
  const scaled = x * (VALUE_STOPS.length - 1);
  const i = Math.min(VALUE_STOPS.length - 2, Math.floor(scaled));
  const local = scaled - i;
  return mixColor(hexToRgb(VALUE_STOPS[i]), hexToRgb(VALUE_STOPS[i + 1]), local, alpha);
}

function formatCurrency(value, compact = false) {
  if (!Number.isFinite(value)) return '—';
  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact && value >= 10000 ? 'compact' : 'standard'
  });
  return `${formatter.format(value)}/m²`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatArea(cellCount) {
  const gridSize = state.manifest?.gridSizeM || 109.45;
  const areaM2 = Math.max(0, cellCount || 0) * gridSize * gridSize;
  const areaHa = areaM2 / 10000;
  const areaKm2 = areaM2 / 1_000_000;
  const km2 = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: areaKm2 < 10 ? 2 : 1,
    maximumFractionDigits: areaKm2 < 10 ? 2 : 1
  }).format(areaKm2);
  const ha = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: areaHa < 100 ? 1 : 0
  }).format(areaHa);
  return `${km2} km² · ${ha} ha`;
}

function formatAreaCompact(cellCount) {
  const gridSize = state.manifest?.gridSizeM || 109.45;
  const areaKm2 = Math.max(0, cellCount || 0) * gridSize * gridSize / 1_000_000;
  const decimals = areaKm2 < 1 ? 3 : areaKm2 < 10 ? 2 : 1;
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(areaKm2)} km²`;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function classKey(cell) {
  return state.manifest.classes[cell[3]]?.key || 'bare';
}

function classLabel(cellOrKey) {
  const key = Array.isArray(cellOrKey) ? classKey(cellOrKey) : cellOrKey;
  return CLASS_SHORT_LABELS[key] || key;
}

function cityNameFromCell(cell) {
  return state.manifest.cities[cell[9]]?.name || 'Unknown city';
}

function normalizePrice(price) {
  const stats = state.manifest.globalStats;
  const min = Math.log1p(Math.max(1, stats.min));
  const max = Math.log1p(Math.max(stats.max, stats.min + 1));
  return Math.max(0, Math.min(1, (Math.log1p(price) - min) / (max - min || 1)));
}

function elevationForCell(cell) {
  if (state.mode === 'cover' || state.heightScale === 0) return 2;
  const n = normalizePrice(cell[2]);
  return (8 + 540 * Math.pow(n, 1.15)) * state.heightScale;
}

function colorForCell(cell) {
  const key = classKey(cell);
  const classRgb = hexToRgb(CLASS_COLORS[key] || '#808080');
  const valueRgb = interpolateValueColor(normalizePrice(cell[2]));
  if (state.mode === 'value') return valueRgb;
  if (state.mode === 'cover') return [...classRgb.slice(0, 3), 218];
  return mixColor(classRgb, valueRgb, state.colorBlend, 232);
}

function showError(message) {
  dom.errorBanner.hidden = false;
  dom.errorBanner.textContent = message;
  dom.loadingOverlay.classList.add('done');
}

function hideError() {
  dom.errorBanner.hidden = true;
  dom.errorBanner.textContent = '';
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}

async function loadManifest() {
  const manifest = await fetchJson('./data/manifest.json');
  state.manifest = manifest;
  manifest.classes.forEach(c => state.selectedClasses.add(c.key));
  return manifest;
}

async function loadCity(cityMeta, cityIndex) {
  if (!state.cityCache.has(cityMeta.slug)) {
    const promise = fetchJson(`./${cityMeta.file}`).then(city => {
      city.cells.forEach(cell => {
        // Append city index once so compact source files remain reusable.
        if (cell.length < 10) cell.push(cityIndex);
      });
      return city;
    });
    state.cityCache.set(cityMeta.slug, promise);
  }
  return state.cityCache.get(cityMeta.slug);
}

async function loadSelection() {
  const token = Symbol('load');
  state.loadToken = token;
  hideError();
  dom.cellCount.textContent = 'loading…';

  const metas = state.selectedCity === 'all'
    ? state.manifest.cities
    : state.manifest.cities.filter(city => city.slug === state.selectedCity);

  try {
    const cities = await Promise.all(metas.map(meta => {
      const idx = state.manifest.cities.findIndex(c => c.slug === meta.slug);
      return loadCity(meta, idx);
    }));
    if (state.loadToken !== token) return;
    state.currentCells = cities.flatMap(city => city.cells);
    updateScene();
    updateStatistics();
    updateSelectionTitle();
    dom.loadingOverlay.classList.add('done');
  } catch (error) {
    console.error(error);
    showError('The dataset could not be loaded. Run the site through a local HTTP server rather than opening index.html directly, and verify the data/manifest.json paths.');
  }
}

function filteredCells() {
  return state.currentCells.filter(cell => state.selectedClasses.has(classKey(cell)));
}

function updateScene() {
  if (!state.overlay || !state.manifest) return;
  const data = filteredCells();
  const gridSize = state.manifest.gridSizeM || 109.45;

  const ambientLight = new deck.AmbientLight({ color: [255, 255, 255], intensity: 1.5 });
  const directionalLight = new deck.DirectionalLight({
    color: [255, 244, 220],
    intensity: 2.1,
    direction: [-3, -8, -6]
  });
  const lightingEffect = new deck.LightingEffect({ ambientLight, directionalLight });

  const gridLayer = new deck.GridCellLayer({
    id: `urban-grid-${state.mode}-${state.heightScale}-${state.colorBlend}-${state.selectedClasses.size}`,
    data,
    pickable: true,
    extruded: true,
    wireframe: false,
    cellSize: gridSize * 0.94,
    coverage: 0.96,
    opacity: 1,
    getPosition: d => [d[0], d[1]],
    getElevation: elevationForCell,
    getFillColor: colorForCell,
    material: {
      ambient: 0.34,
      diffuse: 0.64,
      shininess: 42,
      specularColor: [72, 82, 94]
    },
    transitions: {
      getElevation: { duration: 420 },
      getFillColor: { duration: 320 }
    },
    updateTriggers: {
      getElevation: [state.mode, state.heightScale, state.manifest.globalStats.min, state.manifest.globalStats.max],
      getFillColor: [state.mode, state.colorBlend, ...state.selectedClasses]
    },
    onHover: handleHover,
    onClick: info => {
      if (info.object) pinHoverCard(info);
    }
  });

  const cityData = state.showLabels ? state.manifest.cities : [];
  const centerLayer = new deck.ScatterplotLayer({
    id: 'city-centers',
    data: cityData,
    getPosition: d => d.center,
    getRadius: 260,
    radiusMinPixels: 3,
    radiusMaxPixels: 8,
    getFillColor: [94, 234, 212, 220],
    getLineColor: [5, 12, 22, 230],
    lineWidthMinPixels: 1,
    stroked: true,
    pickable: true,
    onClick: info => {
      if (!info.object) return;
      dom.citySelect.value = info.object.slug;
      state.selectedCity = info.object.slug;
      stopTour();
      loadSelection();
      flyToCity(info.object.slug);
    }
  });

  const textLayer = new deck.TextLayer({
    id: 'city-labels',
    data: cityData,
    getPosition: d => d.center,
    getText: d => String(d.name || '').normalize('NFC'),
    characterSet: 'auto',
    getSize: 13,
    sizeUnits: 'pixels',
    getColor: [242, 247, 252, 235],
    getBackgroundColor: [5, 12, 22, 178],
    background: true,
    backgroundPadding: [6, 3],
    getPixelOffset: [0, -14],
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 650,
    billboard: true
  });

  state.overlay.setProps({
    layers: [gridLayer, centerLayer, textLayer],
    effects: [lightingEffect],
    parameters: { depthTest: true }
  });
  dom.cellCount.textContent = `${formatNumber(data.length)} cells`;
}

function handleHover(info) {
  state.hoverObject = info.object || null;
  if (!info.object) {
    dom.hoverCard.hidden = true;
    return;
  }
  renderHoverCard(info);
}

function pinHoverCard(info) {
  renderHoverCard(info, true);
}

function renderHoverCard(info, pinned = false) {
  const cell = info.object;
  const key = classKey(cell);
  const confidence = cell[4];
  const pointwiseWidth = cell[6];
  const q10 = cell[7];
  const q90 = cell[8];
  dom.hoverCard.innerHTML = `
    <h3>${cityNameFromCell(cell)}</h3>
    <div class="hover-row"><span>Land-cover class</span><strong class="hover-class"><i style="background:${CLASS_COLORS[key]}"></i>${classLabel(key)}</strong></div>
    <div class="hover-row"><span>Classification confidence</span><strong>${(confidence * 100).toFixed(1)}%</strong></div>
    <div class="hover-row"><span>10th predictive quantile (Q₀.₁₀)</span><strong>${formatCurrency(q10)}</strong></div>
    <div class="hover-row"><span>Median unit land value (Q₀.₅₀)</span><strong>${formatCurrency(cell[2])}</strong></div>
    <div class="hover-row"><span>90th predictive quantile (Q₀.₉₀)</span><strong>${formatCurrency(q90)}</strong></div>
    <div class="hover-row"><span>Normalised interval width (wᵢ*)</span><strong>${pointwiseWidth.toFixed(4)}</strong></div>
    ${pinned ? '<div class="hover-row"><span>Selection</span><strong>pinned</strong></div>' : ''}
  `;
  dom.hoverCard.hidden = false;
  const pad = 14;
  const width = 230;
  const height = 225;
  const x = Math.min(window.innerWidth - width - pad, Math.max(pad, info.x + 18));
  const y = Math.min(window.innerHeight - height - pad, Math.max(pad, info.y + 18));
  dom.hoverCard.style.left = `${x}px`;
  dom.hoverCard.style.top = `${y}px`;
}

function updateStatistics() {
  const data = filteredCells();
  const prices = data.map(d => d[2]).sort((a, b) => a - b);
  const confidences = data.map(d => d[4]);
  const counts = Object.fromEntries(state.manifest.classes.map(c => [c.key, 0]));
  data.forEach(cell => { counts[classKey(cell)] += 1; });

  const dominantEntry = data.length
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    : null;
  const dominant = dominantEntry && dominantEntry[1] > 0 ? dominantEntry[0] : null;
  const meanConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : NaN;

  dom.p10Metric.textContent = formatCurrency(quantile(prices, 0.1), true);
  dom.medianMetric.textContent = formatCurrency(quantile(prices, 0.5), true);
  dom.p90Metric.textContent = formatCurrency(quantile(prices, 0.9), true);
  dom.classMetric.textContent = dominant ? classLabel(dominant) : '—';
  dom.confidenceMetric.textContent = Number.isFinite(meanConfidence) ? `${(meanConfidence * 100).toFixed(1)}%` : '—';
  dom.distributionTotal.textContent = `${formatNumber(data.length)} cells`;
  dom.extentMetric.textContent = formatArea(data.length);

  dom.distributionBar.innerHTML = '';
  const total = Math.max(1, data.length);
  state.manifest.classes
    .filter(item => state.selectedClasses.has(item.key) && counts[item.key] > 0)
    .forEach(item => {
      const value = counts[item.key];
      const segment = document.createElement('span');
      segment.className = 'distribution-segment';
      segment.style.width = `${(value / total) * 100}%`;
      segment.style.background = CLASS_COLORS[item.key];
      segment.title = `${classLabel(item.key)}: ${formatNumber(value)} cells (${((value / total) * 100).toFixed(1)}%) · ${formatArea(value)}`;
      dom.distributionBar.appendChild(segment);
    });

  dom.classBreakdown.innerHTML = '';
  const selectedItems = state.manifest.classes.filter(item => state.selectedClasses.has(item.key));
  if (!selectedItems.length) {
    const empty = document.createElement('div');
    empty.className = 'class-breakdown-empty';
    empty.textContent = 'No land-cover class selected';
    dom.classBreakdown.appendChild(empty);
    return;
  }

  selectedItems.forEach(item => {
    const count = counts[item.key] || 0;
    const row = document.createElement('div');
    row.className = 'class-breakdown-row';
    row.title = `${formatNumber(count)} cells · ${formatArea(count)}`;
    row.innerHTML = `
      <span class="class-breakdown-label">
        <i style="background:${CLASS_COLORS[item.key]}"></i>
        <span>${classLabel(item.key)}</span>
      </span>
      <strong>${formatAreaCompact(count)}</strong>
    `;
    dom.classBreakdown.appendChild(row);
  });
}

function updateSelectionTitle() {
  const city = state.manifest.cities.find(c => c.slug === state.selectedCity);
  dom.selectionTitle.textContent = city ? city.name : 'All 12 cities';
}

function populateControls() {
  state.manifest.cities.forEach(city => {
    const option = document.createElement('option');
    option.value = city.slug;
    option.textContent = city.name;
    dom.citySelect.appendChild(option);
  });

  state.manifest.classes.forEach(item => {
    const row = document.createElement('label');
    row.className = 'class-filter';
    row.innerHTML = `
      <input type="checkbox" value="${item.key}" checked>
      <span class="class-swatch" style="background:${CLASS_COLORS[item.key]}"></span>
      <span>${CLASS_SHORT_LABELS[item.key] || item.label}</span>
    `;
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) state.selectedClasses.add(item.key);
      else state.selectedClasses.delete(item.key);
      updateScene();
      updateStatistics();
      updateToggleClassesLabel();
    });
    dom.classFilters.appendChild(row);

  });

  dom.legendMin.textContent = formatCurrency(state.manifest.globalStats.min, true).replace('/m²', '');
  dom.legendMedian.textContent = formatCurrency(state.manifest.globalStats.median, true).replace('/m²', '');
  dom.legendMax.textContent = formatCurrency(state.manifest.globalStats.max, true).replace('/m²', '');

  const isDemo = state.manifest.datasetMode === 'demo';
  dom.datasetBadge.textContent = isDemo ? 'Demo data' : 'Model output';
  dom.datasetBadge.className = `badge ${isDemo ? 'badge-warning' : 'badge-live'}`;
  dom.selectionModel.classList.toggle('live', !isDemo);
  dom.dataWarning.textContent = state.manifest.warning || 'This deployment uses model-output data.';
}

function updateToggleClassesLabel() {
  const allSelected = state.selectedClasses.size === state.manifest.classes.length;
  dom.toggleClasses.textContent = allSelected ? 'Clear' : 'Select all';
}

function wireEvents() {
  dom.citySelect.addEventListener('change', () => {
    state.selectedCity = dom.citySelect.value;
    stopTour();
    loadSelection();
    if (state.selectedCity === 'all') resetRegionalView();
    else flyToCity(state.selectedCity);
  });

  dom.modeButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      dom.modeButtons.forEach(b => b.classList.toggle('active', b === button));
      dom.blendSection.style.display = state.mode === 'integrated' ? '' : 'none';
      dom.heightSection.style.opacity = state.mode === 'cover' ? '.55' : '1';
      updateScene();
    });
  });

  dom.heightScale.addEventListener('input', () => {
    state.heightScale = Number(dom.heightScale.value);
    dom.heightScaleOutput.value = `${state.heightScale.toFixed(2)}×`;
    updateScene();
  });

  dom.colorBlend.addEventListener('input', () => {
    state.colorBlend = Number(dom.colorBlend.value);
    dom.colorBlendOutput.value = `${Math.round(state.colorBlend * 100)}%`;
    updateScene();
  });

  dom.toggleClasses.addEventListener('click', () => {
    const selectAll = state.selectedClasses.size !== state.manifest.classes.length;
    state.selectedClasses.clear();
    if (selectAll) state.manifest.classes.forEach(c => state.selectedClasses.add(c.key));
    dom.classFilters.querySelectorAll('input').forEach(input => { input.checked = selectAll; });
    updateScene();
    updateStatistics();
    updateToggleClassesLabel();
  });

  dom.buildingsToggle.addEventListener('change', () => {
    state.showBuildings = dom.buildingsToggle.checked;
    setBuildingsVisibility();
  });

  dom.labelsToggle.addEventListener('change', () => {
    state.showLabels = dom.labelsToggle.checked;
    updateScene();
  });

  dom.resetButton.addEventListener('click', () => {
    stopTour();
    dom.citySelect.value = 'all';
    state.selectedCity = 'all';
    loadSelection();
    resetRegionalView();
  });

  dom.tourButton.addEventListener('click', () => {
    if (state.tourTimer) stopTour();
    else startTour();
  });

  dom.downloadButton.addEventListener('click', exportVisibleData);
  dom.aboutButton.addEventListener('click', () => dom.aboutDialog.showModal());
  dom.aboutDialog.addEventListener('click', event => {
    if (event.target === dom.aboutDialog) dom.aboutDialog.close();
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      dom.hoverCard.hidden = true;
      stopTour();
    }
    if (event.key.toLowerCase() === 'r') resetRegionalView();
  });
}

function exportVisibleData() {
  const data = filteredCells();
  const rows = ['city,longitude,latitude,predicted_value_q50_brl_m2,land_cover_class,classification_confidence,match_distance_m,normalized_pointwise_interval_width,predicted_value_q10_brl_m2,predicted_value_q90_brl_m2'];
  data.forEach(cell => {
    rows.push([
      JSON.stringify(cityNameFromCell(cell)), cell[0], cell[1], cell[2], classKey(cell), cell[4], cell[5], cell[6], cell[7], cell[8]
    ].join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `urban-twin-${state.selectedCity}-${state.mode}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function cameraPadding() {
  if (window.innerWidth < 720) {
    return { top: 85, bottom: Math.round(window.innerHeight * 0.42), left: 24, right: 24 };
  }
  const panelVisible = dom.insightPanel && window.getComputedStyle(dom.insightPanel).display !== 'none';
  const rightPanelWidth = panelVisible ? dom.insightPanel.offsetWidth + 32 : 42;
  return { top: 105, bottom: 55, left: 335, right: rightPanelWidth };
}

function resetRegionalView() {
  state.map.fitBounds(REGION_BOUNDS, { padding: cameraPadding(), duration: 1500, pitch: INITIAL_VIEW.pitch, bearing: INITIAL_VIEW.bearing });
}

function flyToCity(slug) {
  const city = state.manifest.cities.find(c => c.slug === slug);
  if (!city) return;
  state.map.fitBounds(city.bounds, {
    padding: cameraPadding(),
    duration: 1800,
    pitch: 60,
    bearing: -22,
    maxZoom: 13.8
  });
}

function startTour() {
  state.tourIndex = 0;
  dom.tourButton.textContent = '■ Stop tour';
  const step = () => {
    const city = state.manifest.cities[state.tourIndex % state.manifest.cities.length];
    state.selectedCity = city.slug;
    dom.citySelect.value = city.slug;
    loadSelection();
    flyToCity(city.slug);
    state.tourIndex += 1;
  };
  step();
  state.tourTimer = window.setInterval(step, 5200);
}

function stopTour() {
  if (state.tourTimer) window.clearInterval(state.tourTimer);
  state.tourTimer = null;
  dom.tourButton.textContent = '▶ City tour';
}

function add3DBuildings() {
  const style = state.map.getStyle();
  const layers = style?.layers || [];
  const candidate = layers.find(layer => layer['source-layer'] === 'building');
  if (!candidate) {
    dom.buildingsToggle.disabled = true;
    dom.buildingsToggle.checked = false;
    state.showBuildings = false;
    return;
  }

  const labelLayer = layers.find(layer => layer.type === 'symbol' && layer.layout && layer.layout['text-field']);
  state.buildingLayerId = 'urban-twin-3d-buildings';
  if (state.map.getLayer(state.buildingLayerId)) return;

  try {
    state.map.addLayer({
      id: state.buildingLayerId,
      source: candidate.source,
      'source-layer': candidate['source-layer'],
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['zoom'],
          14, '#526477',
          16, '#8aa0b5'
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          14, 0,
          14.35, ['coalesce', ['get', 'render_height'], ['get', 'height'], 5]
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.42,
        'fill-extrusion-vertical-gradient': true
      }
    }, labelLayer?.id);
    setBuildingsVisibility();
  } catch (error) {
    console.warn('3D building layer could not be initialized:', error);
    state.buildingLayerId = null;
    dom.buildingsToggle.disabled = true;
    dom.buildingsToggle.checked = false;
  }
}

function setBuildingsVisibility() {
  if (!state.buildingLayerId || !state.map.getLayer(state.buildingLayerId)) return;
  state.map.setLayoutProperty(state.buildingLayerId, 'visibility', state.showBuildings ? 'visible' : 'none');
}

function initMap() {
  if (!window.maplibregl) throw new Error('MapLibre GL JS did not load.');
  if (!window.deck) throw new Error('deck.gl did not load.');

  return new Promise((resolve, reject) => {
    state.map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      antialias: true,
      maxPitch: 80,
      hash: true,
      attributionControl: false
    });

    state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');
    state.map.addControl(new maplibregl.FullscreenControl(), 'bottom-left');
    state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 130, unit: 'metric' }), 'bottom-left');
    state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    state.map.once('load', () => {
      state.overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
      state.map.addControl(state.overlay);
      add3DBuildings();
      resetRegionalView();
      resolve();
    });

    state.map.on('error', event => {
      if (event?.error?.message) console.warn('Map error:', event.error.message);
      if (!state.map.loaded() && event?.error) reject(event.error);
    });
  });
}

async function main() {
  bindDom();
  try {
    await loadManifest();
    populateControls();
    wireEvents();
    await initMap();
    await loadSelection();
  } catch (error) {
    console.error(error);
    showError(error.message || 'The application could not be initialized.');
  }
}

main();
