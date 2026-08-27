# Web data schema

## `site/map3d/data/manifest.json`

The manifest records dataset status, class definitions, global statistics and one entry per city. Schema version 3 includes the lower, median and upper predictive quantiles together with the normalized pointwise predictive-interval width for every cell.

Important fields:

- `datasetMode`: `demo` or `model-output`.
- `gridSizeM`: nominal side length of each rendered cell.
- `dataYear`: year represented by the published data.
- `modelConfiguration`: TabPFN feature configuration used for inference (`60`).
- `referenceParcelAreaM2`: reference parcel area used for inference (`450`).
- `classes`: ordered class definitions. The array position is the class index used by each cell.
- `cities[].file`: path to the compact city JSON.

## City files

Each city file contains metadata, statistics and a `cells` array. Each cell is a positional tuple:

```text
index  meaning
0      longitude, EPSG:4326
1      latitude, EPSG:4326
2      predicted median unit land value, R$/m²
3      urban land-cover class index
4      DINOv2–LoRA classification confidence, 0–1
5      nearest-neighbour association distance, metres
6      normalized pointwise predictive-interval width, w_i* = w_i / R
7      predicted 10th quantile of unit land value, R$/m²
8      predicted 90th quantile of unit land value, R$/m²
```

The browser appends a transient tenth element containing the city index. It is not stored in the source JSON.

## Transportation-network data

`site/map3d/data/transport/manifest.json` records the five displayed
OpenStreetMap `highway` classes, styling, source, ODbL licence, snapshot date,
city file index and segment counts. Transportation schema version 1 is
independent of the analytical-cell schema.

Each file under `site/map3d/data/transport/cities/` contains a compact `roads`
array. Every road is represented as:

```text
index  meaning
0      transport-class index from the transport manifest
1      LineString path as [[longitude, latitude], ...], EPSG:4326
```

The preprocessing script removes duplicate directed OSM graph geometries within
each municipality, treating a path and the same path in reverse order as one
rendered segment.
