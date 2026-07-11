# Web data schema

## `site/map3d/data/manifest.json`

The manifest records dataset status, class definitions, global statistics and one entry per city.

Important fields:

- `datasetMode`: `demo` or `model-output`.
- `gridSizeM`: nominal side length of each rendered cell.
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
```

The browser appends a transient seventh element containing the city index. It is not stored in the source JSON.
