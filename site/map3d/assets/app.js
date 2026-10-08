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

const ECONOMICS_CONFIG = {
  lud: { field: 'lud_2023_2024', label: 'LUD (2023/2024)', unit: 'US$ million/km²', decimals: 3 },
  lvy: { field: 'lvy_2023_2024', label: 'LVY (2023/2024)', unit: 'year⁻¹', decimals: 4 }
};
const ECONOMICS_COLORS = ['#253494', '#2c7fb8', '#41b6c4', '#7fcdbb', '#fbbf24', '#f97316'];

const REGION_BOUNDS = [[-52.04, -23.69], [-50.94, -23.18]];
const INITIAL_VIEW = { center: [-51.50, -23.42], zoom: 9.25, pitch: 52, bearing: -17 };
const SATELLITE_SOURCE_ID = 'esri-world-imagery';
const SATELLITE_LAYER_ID = 'esri-world-imagery-layer';
const ECONOMICS_SOURCE_ID = 'municipal-economics';
const ECONOMICS_FILL_LAYER_ID = 'municipal-economics-fill';
const ECONOMICS_LINE_LAYER_ID = 'municipal-economics-line';

const state = {
  manifest: null,
  transportManifest: null,
  economicsData: null,
  cityCache: new Map(),
  transportCache: new Map(),
  currentCells: [],
  regionalCells: [],
  currentRoads: [],
  selectedCity: 'all',
  activeDimensions: new Set(['cover', 'value', 'transport']),
  economicsMetric: null,
  heightScale: 1,
  valueTint: 0.22,
  coverTint: 0.78,
  transportTint: 0.96,
  economicsTint: 0.94,
  selectedClasses: new Set(),
  selectedRoadClasses: new Set(),
  showBuildings: true,
  showUrbanPerimeters: false,
  panelsVisible: true,
  compactLegendSignature: '',
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
    'datasetBadge', 'basemapSelect', 'tourButton', 'panelsToggle', 'resetButton', 'citySelect',
    'coverDimension', 'valueDimension', 'transportDimension', 'ludDimension', 'lvyDimension',
    'heightScale', 'heightScaleOutput', 'valueTint', 'valueTintOutput',
    'coverTint', 'coverTintOutput', 'transportTint', 'transportTintOutput',
    'economicsTint', 'economicsTintOutput',
    'classFilters', 'toggleClasses', 'roadFilters', 'toggleRoadClasses',
    'controlPanel', 'compactLegend', 'compactLegendContent',
    'landCoverFilterSection', 'transportFilterSection', 'buildingsToggle', 'perimeterToggle',
    'downloadButton', 'aboutButton', 'insightPanel', 'selectionTitle', 'selectionModel',
    'generalInsightContent', 'economicsInsightContent', 'economicsSelectionTitle',
    'economicsMetricLabel', 'economicsMetricValue', 'economicsMetricUnit', 'economicsDetails', 'economicsRanking',
    'classStatisticsBody', 'classStatisticsTotal', 'legendMin', 'legendMedian', 'legendMax',
    'valueLegendSection', 'economicsLegendSection', 'economicsLegendTitle', 'economicsLegendMin', 'economicsLegendMax',
    'hoverCard', 'loadingOverlay', 'errorBanner',
    'aboutDialog', 'dataWarning', 'tintSection', 'heightSection'
  ];
  ids.forEach(id => { dom[id] = document.getElementById(id); });
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

function formatLandValue(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
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
  return state.manifest.cities[cell[10]]?.name || 'Unknown municipality';
}

function roadClassMeta(road) {
  return state.transportManifest.classes[road[0]];
}

function cityNameFromRoad(road) {
  return state.manifest.cities[road[2]]?.name || 'Unknown municipality';
}

function normalizePrice(price) {
  const stats = state.manifest.globalStats;
  const min = Math.log1p(Math.max(1, stats.min));
  const max = Math.log1p(Math.max(stats.max, stats.min + 1));
  return Math.max(0, Math.min(1, (Math.log1p(price) - min) / (max - min || 1)));
}

function elevationForCell(cell) {
  if (!state.activeDimensions.has('value') || state.heightScale === 0) return 2;
  const n = normalizePrice(cell[2]);
  return (8 + 540 * Math.pow(n, 1.15)) * state.heightScale;
}

function colorForCell(cell) {
  const key = classKey(cell);
  const classRgb = hexToRgb(CLASS_COLORS[key] || '#808080');
  const valueRgb = interpolateValueColor(normalizePrice(cell[2]));
  const coverWeight = state.activeDimensions.has('cover') ? state.coverTint : 0;
  const valueWeight = state.activeDimensions.has('value') ? state.valueTint : 0;
  const totalWeight = coverWeight + valueWeight;
  if (totalWeight === 0) return [0, 0, 0, 0];
  const alpha = Math.round(232 * Math.min(1, totalWeight));
  if (coverWeight === 0) return [...valueRgb.slice(0, 3), alpha];
  if (valueWeight === 0) return [...classRgb.slice(0, 3), alpha];
  return mixColor(classRgb, valueRgb, valueWeight / totalWeight, alpha);
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
  const [manifest, transportManifest, economicsData] = await Promise.all([
    fetchJson('./data/manifest.json'),
    fetchJson('./data/transport/manifest.json'),
    fetchJson('./data/economics/municipalities.geojson')
  ]);
  state.manifest = manifest;
  state.transportManifest = transportManifest;
  state.economicsData = economicsData;
  manifest.classes.forEach(c => state.selectedClasses.add(c.key));
  transportManifest.classes.forEach(c => state.selectedRoadClasses.add(c.key));
  return manifest;
}

async function loadCity(cityMeta, cityIndex) {
  if (!state.cityCache.has(cityMeta.slug)) {
    const promise = fetchJson(`./${cityMeta.file}`).then(city => {
      city.cells.forEach(cell => {
        // Append city index once so compact source files remain reusable.
        if (cell.length < 11) cell.push(cityIndex);
      });
      return city;
    });
    state.cityCache.set(cityMeta.slug, promise);
  }
  return state.cityCache.get(cityMeta.slug);
}

async function loadTransportCity(cityMeta, cityIndex) {
  if (!state.transportCache.has(cityMeta.slug)) {
    const promise = fetchJson(`./${cityMeta.file}`).then(city => {
      city.roads.forEach(road => {
        // Append city index once so compact source files remain reusable.
        if (road.length < 3) road.push(cityIndex);
      });
      return city;
    });
    state.transportCache.set(cityMeta.slug, promise);
  }
  return state.transportCache.get(cityMeta.slug);
}

async function loadSelection() {
  const token = Symbol('load');
  state.loadToken = token;
  hideError();

  const metas = state.selectedCity === 'all'
    ? state.manifest.cities
    : state.manifest.cities.filter(city => city.slug === state.selectedCity);

  try {
    const cityPromise = Promise.all(metas.map(meta => {
      const idx = state.manifest.cities.findIndex(c => c.slug === meta.slug);
      return loadCity(meta, idx);
    }));
    const transportMetas = state.selectedCity === 'all'
      ? state.transportManifest.cities
      : state.transportManifest.cities.filter(city => city.slug === state.selectedCity);
    const transportPromise = Promise.all(transportMetas.map(meta => {
      const idx = state.manifest.cities.findIndex(c => c.slug === meta.slug);
      return loadTransportCity(meta, idx);
    }));
    const [cities, transportCities] = await Promise.all([cityPromise, transportPromise]);
    if (state.loadToken !== token) return;
    state.currentCells = cities.flatMap(city => city.cells);
    if (state.selectedCity === 'all') state.regionalCells = state.currentCells;
    state.currentRoads = transportCities.flatMap(city => city.roads);
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
  if (!state.activeDimensions.has('cover')) return state.currentCells;
  return state.currentCells.filter(cell => state.selectedClasses.has(classKey(cell)));
}

function filteredRoads() {
  return state.currentRoads.filter(road => state.selectedRoadClasses.has(roadClassMeta(road).key));
}

function economicsExtent() {
  const config = ECONOMICS_CONFIG[state.economicsMetric];
  const values = state.economicsData.features.map(feature => feature.properties[config.field]);
  return [Math.min(...values), Math.max(...values)];
}

function economicsColor(value, alpha = 205) {
  const [min, max] = economicsExtent();
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const scaled = t * (ECONOMICS_COLORS.length - 1);
  const index = Math.min(ECONOMICS_COLORS.length - 2, Math.floor(scaled));
  return mixColor(hexToRgb(ECONOMICS_COLORS[index]), hexToRgb(ECONOMICS_COLORS[index + 1]), scaled - index, alpha);
}

function formatEconomics(value, decimals) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function addMunicipalEconomicsMapLayer() {
  if (state.map.getSource(ECONOMICS_SOURCE_ID)) return;
  state.map.addSource(ECONOMICS_SOURCE_ID, { type: 'geojson', data: state.economicsData });
  const firstSymbol = state.map.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
  state.map.addLayer({
    id: ECONOMICS_FILL_LAYER_ID,
    type: 'fill',
    source: ECONOMICS_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#2c7fb8', 'fill-opacity': 0.94 }
  }, firstSymbol);
  state.map.addLayer({
    id: ECONOMICS_LINE_LAYER_ID,
    type: 'line',
    source: ECONOMICS_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#f8fafc', 'line-width': 1.4, 'line-opacity': 0.95 }
  }, firstSymbol);

  state.map.on('mousemove', ECONOMICS_FILL_LAYER_ID, event => {
    if (!state.economicsMetric || !event.features?.length) return;
    state.map.getCanvas().style.cursor = 'pointer';
    renderEconomicsHoverCard({ object: event.features[0], x: event.point.x, y: event.point.y });
  });
  state.map.on('mouseleave', ECONOMICS_FILL_LAYER_ID, () => {
    state.map.getCanvas().style.cursor = '';
    dom.hoverCard.hidden = true;
  });
  state.map.on('click', ECONOMICS_FILL_LAYER_ID, event => {
    if (!state.economicsMetric || !event.features?.length) return;
    const feature = event.features[0];
    state.selectedCity = feature.properties.slug;
    dom.citySelect.value = state.selectedCity;
    loadSelection();
    updateEconomicsPanel();
    updateScene();
    flyToCity(state.selectedCity);
    renderEconomicsHoverCard({ object: feature, x: event.point.x, y: event.point.y }, true);
  });
}

function updateMunicipalEconomicsMapLayer() {
  if (!state.map?.getLayer(ECONOMICS_FILL_LAYER_ID)) return;
  const economicsVisibility = state.economicsMetric ? 'visible' : 'none';
  const outlineVisibility = state.economicsMetric || state.showUrbanPerimeters ? 'visible' : 'none';
  state.map.setLayoutProperty(ECONOMICS_FILL_LAYER_ID, 'visibility', economicsVisibility);
  state.map.setLayoutProperty(ECONOMICS_LINE_LAYER_ID, 'visibility', outlineVisibility);
  if (!state.economicsMetric) {
    state.map.setPaintProperty(ECONOMICS_LINE_LAYER_ID, 'line-color', '#5eead4');
    state.map.setPaintProperty(ECONOMICS_LINE_LAYER_ID, 'line-width', 1.7);
    state.map.setPaintProperty(ECONOMICS_LINE_LAYER_ID, 'line-opacity', 0.9);
    return;
  }
  state.map.setPaintProperty(ECONOMICS_FILL_LAYER_ID, 'fill-opacity', state.economicsTint);
  const config = ECONOMICS_CONFIG[state.economicsMetric];
  const [min, max] = economicsExtent();
  state.map.setPaintProperty(ECONOMICS_FILL_LAYER_ID, 'fill-color', [
    'interpolate', ['linear'], ['get', config.field],
    min, ECONOMICS_COLORS[0],
    min + (max - min) * 0.2, ECONOMICS_COLORS[1],
    min + (max - min) * 0.4, ECONOMICS_COLORS[2],
    min + (max - min) * 0.6, ECONOMICS_COLORS[3],
    min + (max - min) * 0.8, ECONOMICS_COLORS[4],
    max, ECONOMICS_COLORS[5]
  ]);
  state.map.setPaintProperty(ECONOMICS_LINE_LAYER_ID, 'line-color', [
    'case', ['==', ['get', 'slug'], state.selectedCity], '#5eead4', '#f8fafc'
  ]);
  state.map.setPaintProperty(ECONOMICS_LINE_LAYER_ID, 'line-width', [
    'case', ['==', ['get', 'slug'], state.selectedCity], 4, 1.4
  ]);
}

function updateScene() {
  updateCompactLegend();
  if (!state.overlay || !state.manifest) return;
  updateMunicipalEconomicsMapLayer();
  const data = filteredCells();
  const roadData = filteredRoads();
  const showGrid = (
    state.activeDimensions.has('cover') && state.coverTint > 0
  ) || (
    state.activeDimensions.has('value') && state.valueTint > 0
  );
  const showRoads = state.activeDimensions.has('transport') && state.transportTint > 0;
  const showEconomics = Boolean(state.economicsMetric);
  const dimensionsKey = [...state.activeDimensions].sort().join('-') || 'none';
  const roadElevation = showGrid && state.activeDimensions.has('value') && state.heightScale > 0
    ? (8 + 540) * state.heightScale + 18
    : 5;

  const ambientLight = new deck.AmbientLight({ color: [255, 255, 255], intensity: 1.5 });
  const directionalLight = new deck.DirectionalLight({
    color: [255, 244, 220],
    intensity: 2.1,
    direction: [-3, -8, -6]
  });
  const lightingEffect = new deck.LightingEffect({ ambientLight, directionalLight });

  const gridLayer = showGrid ? new deck.SolidPolygonLayer({
    id: `urban-patches-${dimensionsKey}-${state.heightScale}-${state.valueTint}-${state.coverTint}-${state.selectedClasses.size}`,
    data,
    pickable: true,
    extruded: true,
    wireframe: false,
    opacity: 1,
    getPolygon: d => d[9],
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
      getElevation: [state.activeDimensions.has('value'), state.heightScale, state.manifest.globalStats.min, state.manifest.globalStats.max],
      getFillColor: [state.activeDimensions.has('cover'), state.activeDimensions.has('value'), state.coverTint, state.valueTint, ...state.selectedClasses]
    },
    onHover: handleHover,
    onClick: info => {
      if (info.object) pinHoverCard(info);
    }
  }) : null;

  const roadLayer = showRoads ? new deck.PathLayer({
    id: `transport-network-${dimensionsKey}-${state.transportTint}-${roadElevation}-${state.selectedRoadClasses.size}`,
    data: roadData,
    pickable: true,
    getPath: road => road[1].map(point => [point[0], point[1], roadElevation]),
    getColor: road => hexToRgb(roadClassMeta(road).color, 242),
    getWidth: road => roadClassMeta(road).width,
    widthUnits: 'pixels',
    widthMinPixels: 0.65,
    widthMaxPixels: 5,
    jointRounded: true,
    capRounded: true,
    opacity: state.transportTint,
    parameters: { depthTest: false },
    updateTriggers: {
      getPath: [roadElevation],
      getColor: [state.transportTint, ...state.selectedRoadClasses],
      getWidth: [...state.selectedRoadClasses]
    },
    onHover: handleRoadHover,
    onClick: info => {
      if (info.object) renderRoadHoverCard(info, true);
    }
  }) : null;

  const cityData = !showEconomics ? state.manifest.cities : [];
  const centerLayer = !showEconomics ? new deck.ScatterplotLayer({
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
  }) : null;

  state.overlay.setProps({
    layers: [gridLayer, roadLayer, centerLayer].filter(Boolean),
    effects: [lightingEffect],
    parameters: { depthTest: true }
  });
}

function handleEconomicsHover(info) {
  state.hoverObject = info.object || null;
  if (!info.object) {
    dom.hoverCard.hidden = true;
    return;
  }
  renderEconomicsHoverCard(info);
}

function renderEconomicsHoverCard(info, pinned = false) {
  const properties = info.object.properties;
  const config = ECONOMICS_CONFIG[state.economicsMetric];
  dom.hoverCard.classList.remove('hover-card--analytical');
  dom.hoverCard.innerHTML = `
    <h3>${properties.name}</h3>
    <div class="hover-divider"></div>
    <div class="hover-section-title">Municipal Land Economics</div>
    <div class="hover-row"><span>${config.label}:</span><strong>${formatEconomics(properties[config.field], config.decimals)} ${config.unit}</strong></div>
    <div class="hover-row"><span>Developed extent (2024):</span><strong>${formatEconomics(properties.developed_extent_km2_2024, 2)} km²</strong></div>
    <div class="hover-row"><span>GVA:CS+I (2023):</span><strong>US$ ${formatEconomics(properties.gva_csi_usd_million_2023, 3)} million</strong></div>
    <div class="hover-row"><span>Developed land value (2024):</span><strong>US$ ${formatEconomics(properties.developed_land_value_usd_million_2024, 2)} million</strong></div>
    ${pinned ? '<div class="hover-row"><span>Selection</span><strong>pinned</strong></div>' : ''}
  `;
  dom.hoverCard.hidden = false;
  const width = 300;
  const pad = 14;
  dom.hoverCard.style.left = `${Math.min(window.innerWidth - width - pad, Math.max(pad, info.x + 18))}px`;
  dom.hoverCard.style.top = `${Math.min(window.innerHeight - 230, Math.max(pad, info.y + 18))}px`;
}

function handleRoadHover(info) {
  state.hoverObject = info.object || null;
  if (!info.object) {
    dom.hoverCard.hidden = true;
    return;
  }
  renderRoadHoverCard(info);
}

function renderRoadHoverCard(info, pinned = false) {
  const road = info.object;
  const meta = roadClassMeta(road);
  dom.hoverCard.classList.remove('hover-card--analytical');
  dom.hoverCard.innerHTML = `
    <h3>${cityNameFromRoad(road)}</h3>
    <div class="hover-row"><span>Transport class</span><strong class="hover-class"><i style="background:${meta.color}"></i>${meta.label}</strong></div>
    <div class="hover-row"><span>Source</span><strong>OpenStreetMap</strong></div>
    ${pinned ? '<div class="hover-row"><span>Selection</span><strong>pinned</strong></div>' : ''}
  `;
  dom.hoverCard.hidden = false;
  const pad = 14;
  const width = 230;
  const height = 130;
  const x = Math.min(window.innerWidth - width - pad, Math.max(pad, info.x + 18));
  const y = Math.min(window.innerHeight - height - pad, Math.max(pad, info.y + 18));
  dom.hoverCard.style.left = `${x}px`;
  dom.hoverCard.style.top = `${y}px`;
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
  dom.hoverCard.classList.add('hover-card--analytical');
  dom.hoverCard.innerHTML = `
    <h3>${cityNameFromCell(cell)}</h3>
    <div class="hover-divider"></div>
    <div class="hover-section-title">Urban Land Cover</div>
    <div class="hover-row"><span>Land cover category:</span><strong class="hover-class"><i style="background:${CLASS_COLORS[key]}"></i>${classLabel(key)}</strong></div>
    <div class="hover-row"><span>Land cover category classification confidence:</span><strong>${(confidence * 100).toFixed(1)}%</strong></div>
    <div class="hover-divider"></div>
    <div class="hover-section-title">Urban Land Value</div>
    <div class="hover-row"><span>10th percentile:</span><strong>${formatCurrency(q10)}</strong></div>
    <div class="hover-row"><span>50th percentile:</span><strong>${formatCurrency(cell[2])}</strong></div>
    <div class="hover-row"><span>90th percentile:</span><strong>${formatCurrency(q90)}</strong></div>
    <div class="hover-row"><span>Land value prediction normalised interval:</span><strong>${pointwiseWidth.toFixed(4)}</strong></div>
    ${pinned ? '<div class="hover-row"><span>Selection</span><strong>pinned</strong></div>' : ''}
  `;
  dom.hoverCard.hidden = false;
  const pad = 14;
  const width = Math.min(320, window.innerWidth - pad * 2);
  const height = 300;
  const x = Math.min(window.innerWidth - width - pad, Math.max(pad, info.x + 18));
  const y = Math.min(window.innerHeight - height - pad, Math.max(pad, info.y + 18));
  dom.hoverCard.style.left = `${x}px`;
  dom.hoverCard.style.top = `${y}px`;
}

function updateStatistics() {
  if (state.economicsMetric) {
    dom.insightPanel.style.display = '';
    dom.generalInsightContent.hidden = true;
    dom.economicsInsightContent.hidden = false;
    updateEconomicsPanel();
    return;
  }
  dom.generalInsightContent.hidden = false;
  dom.economicsInsightContent.hidden = true;
  const showCellStatistics = state.activeDimensions.has('cover') || state.activeDimensions.has('value');
  dom.insightPanel.style.display = showCellStatistics ? '' : 'none';
  if (!showCellStatistics) return;
  const selectedItems = state.manifest.classes.filter(item => state.selectedClasses.has(item.key));
  const municipalityTotal = state.currentCells.length;
  dom.classStatisticsBody.innerHTML = '';
  dom.classStatisticsTotal.innerHTML = '';

  if (!selectedItems.length) {
    const empty = document.createElement('tr');
    empty.className = 'class-statistics-empty';
    empty.innerHTML = '<td colspan="7">No land-cover category selected</td>';
    dom.classStatisticsBody.appendChild(empty);
    return;
  }

  const selectedCells = [];
  selectedItems.forEach(item => {
    const classCells = state.currentCells.filter(cell => classKey(cell) === item.key);
    const prices = classCells.map(cell => cell[2]).sort((a, b) => a - b);
    const count = classCells.length;
    const share = municipalityTotal ? count / municipalityTotal * 100 : 0;
    const regionalCount = state.regionalCells.filter(cell => classKey(cell) === item.key).length;
    const regionalShare = regionalCount ? count / regionalCount * 100 : 0;
    selectedCells.push(...classCells);
    const row = document.createElement('tr');
    row.title = `${formatNumber(count)} cells · ${formatArea(count)}`;
    row.innerHTML = `
      <td><span class="class-statistics-label"><i style="background:${CLASS_COLORS[item.key]}"></i><span>${classLabel(item.key)}</span></span></td>
      <td class="secondary">${formatAreaCompact(count)}</td>
      <td class="secondary">${share.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
      <td class="secondary">${regionalShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
      <td>${formatLandValue(quantile(prices, 0.1))}</td>
      <td>${formatLandValue(quantile(prices, 0.5))}</td>
      <td>${formatLandValue(quantile(prices, 0.9))}</td>
    `;
    dom.classStatisticsBody.appendChild(row);
  });

  const totalPrices = selectedCells.map(cell => cell[2]).sort((a, b) => a - b);
  const totalShare = municipalityTotal ? selectedCells.length / municipalityTotal * 100 : 0;
  const regionalSelectedCells = state.regionalCells.filter(cell => state.selectedClasses.has(classKey(cell)));
  const regionalPrices = regionalSelectedCells.map(cell => cell[2]).sort((a, b) => a - b);
  const regionalCategoryShare = regionalSelectedCells.length ? selectedCells.length / regionalSelectedCells.length * 100 : 0;
  const totalRow = document.createElement('tr');
  totalRow.innerHTML = `
    <td>${state.selectedCity === 'all' ? 'Visible<br>total' : 'Selected<br>municipality'}</td>
    <td>${formatAreaCompact(selectedCells.length)}</td>
    <td>${totalShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
    <td>${regionalCategoryShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
    <td>${formatLandValue(quantile(totalPrices, 0.1))}</td>
    <td>${formatLandValue(quantile(totalPrices, 0.5))}</td>
    <td>${formatLandValue(quantile(totalPrices, 0.9))}</td>
  `;
  if (state.selectedCity !== 'all') dom.classStatisticsTotal.appendChild(totalRow);
  const regionalRow = document.createElement('tr');
  regionalRow.className = 'regional-total-row';
  regionalRow.innerHTML = `
    <td>All<br>municipalities</td>
    <td>${formatAreaCompact(regionalSelectedCells.length)}</td>
    <td>${(regionalSelectedCells.length / Math.max(1, state.regionalCells.length) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
    <td>100,0%</td>
    <td>${formatLandValue(quantile(regionalPrices, 0.1))}</td>
    <td>${formatLandValue(quantile(regionalPrices, 0.5))}</td>
    <td>${formatLandValue(quantile(regionalPrices, 0.9))}</td>
  `;
  dom.classStatisticsTotal.appendChild(regionalRow);
}

function updateEconomicsPanel() {
  if (!state.economicsMetric) return;
  const config = ECONOMICS_CONFIG[state.economicsMetric];
  const features = state.economicsData.features;
  const selected = features.find(feature => feature.properties.slug === state.selectedCity);
  const rows = features.map(feature => feature.properties);
  const totals = rows.reduce((acc, item) => ({
    extent: acc.extent + item.developed_extent_km2_2024,
    gva: acc.gva + item.gva_csi_usd_million_2023,
    land: acc.land + item.developed_land_value_usd_million_2024
  }), { extent: 0, gva: 0, land: 0 });
  const aggregate = state.economicsMetric === 'lud' ? totals.gva / totals.extent : totals.gva / totals.land;
  const item = selected?.properties;
  const value = item ? item[config.field] : aggregate;
  dom.economicsSelectionTitle.textContent = item ? item.name : 'All 12 municipalities';
  dom.economicsMetricLabel.textContent = config.label;
  dom.economicsMetricValue.textContent = formatEconomics(value, config.decimals);
  dom.economicsMetricUnit.textContent = config.unit;
  dom.economicsDetails.innerHTML = `
    <div><dt>Developed extent · 2024</dt><dd>${formatEconomics(item ? item.developed_extent_km2_2024 : totals.extent, 2)} km²</dd></div>
    <div><dt>GVA:CS+I · 2023</dt><dd>US$ ${formatEconomics(item ? item.gva_csi_usd_million_2023 : totals.gva, 3)} million</dd></div>
    <div><dt>Developed land value · 2024</dt><dd>US$ ${formatEconomics(item ? item.developed_land_value_usd_million_2024 : totals.land, 2)} million</dd></div>
  `;
  const ordered = [...rows].sort((a, b) => b[config.field] - a[config.field]);
  const max = ordered[0][config.field];
  dom.economicsRanking.innerHTML = ordered.map(row => `
    <li class="${row.slug === state.selectedCity ? 'is-selected' : ''}">
      <span>${row.name}</span><strong>${formatEconomics(row[config.field], config.decimals)}</strong>
      <i style="--bar-width:${row[config.field] / max * 100}%"></i>
    </li>`).join('');
}

function updateSelectionTitle() {
  const city = state.manifest.cities.find(c => c.slug === state.selectedCity);
  dom.selectionTitle.textContent = city ? city.name : 'All';
  updateEconomicsPanel();
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

  state.transportManifest.classes.forEach(item => {
    const row = document.createElement('label');
    row.className = 'class-filter';
    row.innerHTML = `
      <input type="checkbox" value="${item.key}" checked>
      <span class="class-swatch road-swatch" style="background:${item.color}; height:${Math.max(3, item.width)}px"></span>
      <span>${item.label}</span>
    `;
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) state.selectedRoadClasses.add(item.key);
      else state.selectedRoadClasses.delete(item.key);
      updateScene();
      updateToggleRoadClassesLabel();
    });
    dom.roadFilters.appendChild(row);
  });

  dom.legendMin.textContent = formatCurrency(state.manifest.globalStats.min, true);
  dom.legendMedian.textContent = formatCurrency(state.manifest.globalStats.median, true);
  dom.legendMax.textContent = formatCurrency(state.manifest.globalStats.max, true);

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

function updateToggleRoadClassesLabel() {
  const allSelected = state.selectedRoadClasses.size === state.transportManifest.classes.length;
  dom.toggleRoadClasses.textContent = allSelected ? 'Clear' : 'Select all';
}

function updateDimensionControls() {
  const economicsVisible = Boolean(state.economicsMetric);
  const coverVisible = state.activeDimensions.has('cover');
  const valueVisible = state.activeDimensions.has('value');
  const roadsVisible = state.activeDimensions.has('transport');
  const cellsVisible = coverVisible || valueVisible;
  dom.heightSection.classList.toggle('is-inactive', !valueVisible);
  dom.heightScale.disabled = !valueVisible;
  dom.valueTint.disabled = !valueVisible;
  dom.coverTint.disabled = !coverVisible;
  dom.transportTint.disabled = !roadsVisible;
  dom.economicsTint.disabled = !economicsVisible;
  dom.landCoverFilterSection.classList.toggle('is-inactive', !coverVisible);
  dom.transportFilterSection.classList.toggle('is-inactive', !roadsVisible);
  dom.valueLegendSection.classList.toggle('is-inactive', !valueVisible);
  dom.economicsLegendSection.hidden = !economicsVisible;
  if (economicsVisible) {
    const config = ECONOMICS_CONFIG[state.economicsMetric];
    const [min, max] = economicsExtent();
    dom.economicsLegendTitle.textContent = `${config.label} · ${config.unit}`;
    dom.economicsLegendMin.textContent = formatEconomics(min, config.decimals);
    dom.economicsLegendMax.textContent = formatEconomics(max, config.decimals);
  }
  dom.downloadButton.disabled = economicsVisible ? false : !cellsVisible && !roadsVisible;
  if (economicsVisible) {
    dom.downloadButton.textContent = '↓ Export municipal economics';
    return;
  }
  dom.downloadButton.textContent = cellsVisible
    ? '↓ Export visible cells'
    : roadsVisible
      ? '↓ Export visible roads'
      : 'No analytical data visible';
}

function updateCompactLegend() {
  if (!state.manifest || !state.transportManifest) return;

  const signature = JSON.stringify({
    dimensions: [...state.activeDimensions].sort(),
    classes: [...state.selectedClasses].sort(),
    roads: [...state.selectedRoadClasses].sort(),
    economics: state.economicsMetric,
    valueHeight: state.heightScale > 0
  });

  if (signature !== state.compactLegendSignature) {
    const sections = [];

    if (state.activeDimensions.has('cover')) {
      const classes = state.manifest.classes.filter(item => state.selectedClasses.has(item.key));
      const items = classes.length
        ? classes.map(item => `
            <div class="compact-legend-item">
              <i class="compact-swatch" style="background:${CLASS_COLORS[item.key]}"></i>
              <span>${CLASS_SHORT_LABELS[item.key] || item.label}</span>
            </div>`).join('')
        : '<div class="compact-value-note">No land-cover categories selected.</div>';
      sections.push(`
        <section class="compact-legend-section">
          <h3 class="compact-legend-heading">Urban land cover</h3>
          <div class="compact-cover-items">${items}</div>
        </section>`);
    }

    if (state.activeDimensions.has('value')) {
      const stats = state.manifest.globalStats;
      const heightNote = state.heightScale > 0
        ? '<p class="compact-value-note">Colour and prism height represent predicted median unit land value.</p>'
        : '<p class="compact-value-note">Colour represents predicted median unit land value.</p>';
      sections.push(`
        <section class="compact-legend-section">
          <h3 class="compact-legend-heading">Median unit land value (R$/m²)</h3>
          <div class="compact-value-gradient"></div>
          <div class="compact-value-labels">
            <span>${formatCurrency(stats.min, true).replace('/m²', '')}</span>
            <span>${formatCurrency(stats.median, true).replace('/m²', '')}</span>
            <span>${formatCurrency(stats.max, true).replace('/m²', '')}</span>
          </div>
          ${heightNote}
        </section>`);
    }

    if (state.activeDimensions.has('transport')) {
      const roads = state.transportManifest.classes.filter(item => state.selectedRoadClasses.has(item.key));
      const items = roads.length
        ? roads.map(item => `
            <div class="compact-legend-item">
              <i class="compact-road-line" style="background:${item.color};height:${Math.max(3, item.width)}px"></i>
              <span>${item.label}</span>
            </div>`).join('')
        : '<div class="compact-value-note">No road classes selected.</div>';
      sections.push(`
        <section class="compact-legend-section">
          <h3 class="compact-legend-heading">Transport network</h3>
          <div class="compact-road-items">${items}</div>
        </section>`);
    }

    if (state.economicsMetric) {
      const config = ECONOMICS_CONFIG[state.economicsMetric];
      const [min, max] = economicsExtent();
      sections.push(`
        <section class="compact-legend-section">
          <h3 class="compact-legend-heading">${config.label} · ${config.unit}</h3>
          <div class="compact-value-gradient"></div>
          <div class="compact-value-labels"><span>${formatEconomics(min, config.decimals)}</span><span>${formatEconomics(max, config.decimals)}</span></div>
        </section>`);
    }

    dom.compactLegendContent.innerHTML = sections.length
      ? `<h2 class="compact-legend-title">Visible map legend</h2>${sections.join('')}`
      : '';
    dom.compactLegend.classList.toggle('has-content', sections.length > 0);
    state.compactLegendSignature = signature;
  }

  const legendVisible = !state.panelsVisible && dom.compactLegend.classList.contains('has-content');
  dom.compactLegend.setAttribute('aria-hidden', String(!legendVisible));
}

function updatePanelsVisibility() {
  document.getElementById('app').classList.toggle('panels-hidden', !state.panelsVisible);
  dom.panelsToggle.textContent = state.panelsVisible ? 'Hide panels' : 'Show panels';
  dom.panelsToggle.title = state.panelsVisible ? 'Hide side panels' : 'Show side panels';
  dom.panelsToggle.setAttribute('aria-expanded', String(state.panelsVisible));
  updateCompactLegend();
}

function wireEvents() {
  dom.citySelect.addEventListener('change', () => {
    state.selectedCity = dom.citySelect.value;
    stopTour();
    loadSelection();
    if (state.selectedCity === 'all') resetRegionalView();
    else flyToCity(state.selectedCity);
  });

  [
    ['cover', dom.coverDimension],
    ['value', dom.valueDimension],
    ['transport', dom.transportDimension]
  ].forEach(([dimension, input]) => {
    input.addEventListener('change', () => {
      if (input.checked && state.economicsMetric) deactivateEconomics();
      if (input.checked) state.activeDimensions.add(dimension);
      else state.activeDimensions.delete(dimension);
      updateDimensionControls();
      updateScene();
      updateStatistics();
    });
  });

  [['lud', dom.ludDimension], ['lvy', dom.lvyDimension]].forEach(([metric, input]) => {
    input.addEventListener('change', () => {
      if (input.checked) activateEconomics(metric);
      else if (state.economicsMetric === metric) deactivateEconomics();
      updateDimensionControls();
      updateScene();
      updateStatistics();
    });
  });

  dom.heightScale.addEventListener('input', () => {
    state.heightScale = Number(dom.heightScale.value);
    dom.heightScaleOutput.value = `${state.heightScale.toFixed(2)}×`;
    updateScene();
  });

  [
    ['valueTint', 'valueTintOutput'],
    ['coverTint', 'coverTintOutput'],
    ['transportTint', 'transportTintOutput'],
    ['economicsTint', 'economicsTintOutput']
  ].forEach(([controlId, outputId]) => {
    dom[controlId].addEventListener('input', () => {
      state[controlId] = Number(dom[controlId].value);
      dom[outputId].value = `${Math.round(state[controlId] * 100)}%`;
      updateScene();
    });
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

  dom.toggleRoadClasses.addEventListener('click', () => {
    const selectAll = state.selectedRoadClasses.size !== state.transportManifest.classes.length;
    state.selectedRoadClasses.clear();
    if (selectAll) state.transportManifest.classes.forEach(c => state.selectedRoadClasses.add(c.key));
    dom.roadFilters.querySelectorAll('input').forEach(input => { input.checked = selectAll; });
    updateScene();
    updateToggleRoadClassesLabel();
  });

  dom.buildingsToggle.addEventListener('change', () => {
    state.showBuildings = dom.buildingsToggle.checked;
    setBuildingsVisibility();
  });

  dom.perimeterToggle.addEventListener('change', () => {
    state.showUrbanPerimeters = dom.perimeterToggle.checked;
    updateScene();
  });

  dom.panelsToggle.addEventListener('click', () => {
    state.panelsVisible = !state.panelsVisible;
    updatePanelsVisibility();
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

  dom.basemapSelect.addEventListener('change', () => {
    setBasemap(dom.basemapSelect.value);
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

function activateEconomics(metric) {
  state.economicsMetric = metric;
  state.activeDimensions.clear();
  dom.coverDimension.checked = false;
  dom.valueDimension.checked = false;
  dom.transportDimension.checked = false;
  dom.ludDimension.checked = metric === 'lud';
  dom.lvyDimension.checked = metric === 'lvy';
  dom.hoverCard.hidden = true;
}

function deactivateEconomics() {
  state.economicsMetric = null;
  dom.ludDimension.checked = false;
  dom.lvyDimension.checked = false;
  dom.hoverCard.hidden = true;
}

function exportVisibleData() {
  if (state.economicsMetric) {
    const config = ECONOMICS_CONFIG[state.economicsMetric];
    const rows = ['municipality,developed_extent_km2_2024,gva_csi_usd_million_2023,lud_2023_2024,developed_land_value_usd_million_2024,lvy_2023_2024'];
    state.economicsData.features.forEach(feature => {
      const p = feature.properties;
      rows.push([JSON.stringify(p.name), p.developed_extent_km2_2024, p.gva_csi_usd_million_2023, p.lud_2023_2024, p.developed_land_value_usd_million_2024, p.lvy_2023_2024].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `urban-twin-municipal-${config.label.slice(0, 3).toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  const cellsVisible = state.activeDimensions.has('cover') || state.activeDimensions.has('value');
  const roadsVisible = state.activeDimensions.has('transport');
  if (roadsVisible && !cellsVisible) {
    const features = filteredRoads().map(road => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: road[1] },
      properties: {
        city: cityNameFromRoad(road),
        highway: roadClassMeta(road).key,
        source: 'OpenStreetMap contributors'
      }
    }));
    const blob = new Blob([
      JSON.stringify({ type: 'FeatureCollection', features })
    ], { type: 'application/geo+json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `urban-twin-${state.selectedCity}-transport.geojson`;
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  if (!cellsVisible) return;
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
  const dimensions = [...state.activeDimensions].sort().join('-');
  link.download = `urban-twin-${state.selectedCity}-${dimensions}.csv`;
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
  dom.tourButton.textContent = '▶ Municipality tour';
}

function add3DBuildings() {
  const style = state.map.getStyle();
  const layers = style?.layers || [];
  const existingBuildingLayer = layers.find(layer =>
    layer.type === 'fill-extrusion' && layer['source-layer'] === 'building'
  );
  if (existingBuildingLayer) {
    state.buildingLayerId = existingBuildingLayer.id;
    setBuildingsVisibility();
    return;
  }

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
  const visibility = state.showBuildings ? 'visible' : 'none';
  const layers = state.map.getStyle()?.layers || [];
  layers.filter(layer => layer.type === 'fill-extrusion').forEach(layer => {
    state.map.setLayoutProperty(layer.id, 'visibility', visibility);
  });
}

function addSatelliteBasemap() {
  if (state.map.getSource(SATELLITE_SOURCE_ID)) return;
  state.map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });

  const firstLabel = state.map.getStyle().layers.find(layer => layer.type === 'symbol');
  state.map.addLayer({
    id: SATELLITE_LAYER_ID,
    type: 'raster',
    source: SATELLITE_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 }
  }, firstLabel?.id);
}

function setBasemap(value) {
  if (!state.map?.getLayer(SATELLITE_LAYER_ID)) return;
  state.map.setLayoutProperty(
    SATELLITE_LAYER_ID,
    'visibility',
    value === 'satellite' ? 'visible' : 'none'
  );
  setBuildingsVisibility();
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
      addSatelliteBasemap();
      addMunicipalEconomicsMapLayer();
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
    updateDimensionControls();
    updatePanelsVisibility();
    wireEvents();
    await initMap();
    await loadSelection();
  } catch (error) {
    console.error(error);
    showError(error.message || 'The application could not be initialized.');
  }
}

main();
