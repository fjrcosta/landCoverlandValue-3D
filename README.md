# Northern Paraná Urban Twin

A GitHub Pages–ready 3D web application that combines the two outputs used in `LandValue_TabPFN_LandCover_DinoLoRA.ipynb`:

- **Urban land-cover classification:** DINOv2 ViT-L/14 + LoRA, ten mutually exclusive classes and classification confidence.
- **Median unit urban land value:** TabPFN v2 configuration-60 predictions for a 450 m² reference parcel on a 109.45 m grid, displayed in R$/m².

The default **Integrated 3D** view encodes both variables in the same object:

- prism **height** = predicted median unit land value;
- prism **categorical color** = urban land-cover class;
- optional continuous **value tint** = the notebook’s blue-to-red `tim.colors()`-like palette;
- tooltip = city, class, confidence, predictive quantiles and normalized pointwise interval width.

The repository contains a deterministic synthetic demonstration dataset so the interface works immediately. It is clearly labelled **Demo data** in the application. Replace it with the model CSV outputs before scientific interpretation.

## Capabilities

- GPU-accelerated rendering of the twelve-city grid with deck.gl.
- MapLibre geographic camera with pitch, rotation, zoom and optional OpenStreetMap-derived 3D buildings.
- Regional view and individual city views for Londrina, Cambé, Ibiporã, Rolândia, Arapongas, Apucarana, Cambira, Jandaia do Sul, Mandaguari, Marialva, Sarandi and Maringá.
- Integrated, land-cover-only and land-value-only analytical modes.
- Class filtering, vertical-exaggeration control and continuous/categorical color blending.
- Dynamic statistics and land-cover composition for the visible selection.
- Hover inspection, automatic twelve-city tour and CSV export of the filtered records.
- Static hosting with no backend, database or API key.
- Automated GitHub Pages deployment through GitHub Actions.

## Architecture

```text
DINOv2–LoRA CSVs ──┐
                    ├─ scripts/build_data.py ── nearest spatial association ── compact city JSON
TabPFN CSVs ────────┘

compact city JSON ── browser fetch ── deck.gl GridCellLayer ── MapLibre 3D scene
```

The preprocessing step performs the computationally expensive spatial association once. The browser receives compact records of the form:

```text
[longitude, latitude, value_q50_R$/m², class_index, confidence, match_distance_m, normalized_pointwise_interval_width, value_q10_R$/m², value_q90_R$/m²]
```

This avoids sending two full polygon collections and avoids performing approximately 73,000 × 73,000 spatial comparisons in the browser.

## Local preview

No JavaScript build step is required.

```bash
cd landCoverlandValue-3D
python -m http.server 8000 --directory site
```

Open `http://localhost:8000`.

Do not open `site/index.html` directly with a `file://` URL; browsers block the JSON fetches in that mode.

## Replace the demonstration data with the actual model outputs

### 1. Arrange the files

Copy one urban-land-cover CSV and one urban-land-value CSV per city into these directories:

```text
raw/
├── land_cover/
│   ├── inference_results_londrina.csv
│   ├── inference_results_cambe.csv
│   └── ...
└── land_value/
    ├── inferencia_Londrina_cfg60_450m2.csv
    ├── inferencia_Cambe_cfg60_450m2.csv
    └── ...
```

The filenames may retain the longer timestamped names from the notebook. The script identifies the city from the path or filename.

Land-cover files must contain:

```text
predicted_class
prediction_confidence
center
```

where `center` is formatted as `latitude,longitude`. Instead of `center`, the four fields `top_left`, `top_right`, `bottom_left` and `bottom_right` may be supplied.

Land-value files must contain:

```text
utm_x
utm_y
unit_q10
unit_q50
unit_q90
pinaw_pontual
configuracao
area_m2
```

### 2. Install the Python dependencies

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
```

### 3. Build the website data

```bash
python scripts/build_data.py \
  --land-cover-dir raw/land_cover \
  --land-value-dir raw/land_value \
  --land-value-pattern 'inferencia_*_cfg60_450m2.csv' \
  --output-dir site/map3d/data \
  --utm-crs EPSG:29192 \
  --grid-size-m 109.45
```

This overwrites `site/map3d/data/manifest.json` and the files under `site/map3d/data/cities/`. The application badge changes automatically from **Demo data** to **Model output**.

The converter validates that every land-value record uses configuration 60 and
the 450 m² reference parcel. The `unit_q50` column is already expressed in
R$/m² and is therefore used directly, without exponentiation.

### Spatial association

The land-cover patch centres are transformed from EPSG:4326 to a metric CRS. The TabPFN UTM points are transformed from EPSG:29192 to EPSG:4326 and then into the same metric CRS. A `scipy.spatial.cKDTree` nearest-neighbour query assigns one land-cover class to each land-value cell.

The match distance is retained as an exported alignment diagnostic. The manifest also stores its median, 95th percentile and number of associations beyond the diagnostic threshold. Change the threshold with:

```bash
--max-match-distance 250
```

The threshold is diagnostic: records are retained rather than silently discarded.

## Publish with GitHub Pages

1. Create an empty GitHub repository.
2. From this project directory, run:

```bash
git init
git add .
git commit -m "Initial 3D urban twin"
git branch -M main
git remote add origin https://github.com/fjrcosta/landCoverlandValue-3D.git
git push -u origin main
```

3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, select **GitHub Actions**.
5. The included `.github/workflows/deploy-pages.yml` publishes the `site/` directory after every push to `main`.

The public address will be:

```text
https://fjrcosta.github.io/landCoverlandValue-3D/
```

## Scientific interpretation

This viewer is an analytical 3D representation, not a photogrammetric reconstruction or cadastral building model. The extrusion heights are deliberately exaggerated and represent the relative intensity of predicted land value, not physical elevation.

The preprocessing pipeline uses the model-60 `unit_q50` estimates directly in R$/m². These estimates correspond to the 450 m² reference parcel used during inference.

The nearest-centre association is appropriate when both products represent approximately commensurate regular patches. Before publication, inspect the recorded match-distance distribution and verify grid alignment, edge behaviour and CRS assumptions.

## Main files

```text
site/index.html                 Application shell
site/map3d/assets/app.js              Map, GPU layers, interaction and statistics
site/map3d/assets/styles.css          Responsive visual design
site/map3d/data/manifest.json         Dataset metadata and city index
site/map3d/data/cities/*.json         Compact per-city records
scripts/build_data.py           Actual CSV-to-web conversion
scripts/generate_demo_data.py   Deterministic demonstration dataset
.github/workflows/              GitHub Pages deployment
```

## License

Application code: MIT License. Model outputs, imagery and research data retain their original licences and should be documented separately before public release.
