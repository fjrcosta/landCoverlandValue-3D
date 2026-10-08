#!/usr/bin/env python3
"""Build the static municipal-economics GeoJSON used by the web map."""

import json
import shutil
import subprocess
from pathlib import Path


SOURCE_ROOT = Path("/Volumes/ssd_externo/UEL DOUTORADO 2022/Artigo GEO/json dados/shapeFiles")
OUTPUT = Path(__file__).resolve().parents[1] / "site/map3d/data/economics/municipalities.geojson"

ROWS = [
    ("ibipora", "Ibiporã", "shpIbipora/perimetro.geojson", 14.60, 485.805, 33.274, 1326.21, 0.3663),
    ("marialva", "Marialva", "shpMarialva/perimetro.geojson", 9.84, 366.556, 37.252, 1030.58, 0.3557),
    ("mandaguari", "Mandaguari", "shpMandaguari/perimetro.geojson", 9.83, 339.370, 34.524, 989.03, 0.3431),
    ("rolandia", "Rolândia", "shpRolandia/perimetro.geojson", 19.20, 577.607, 30.084, 1863.82, 0.3099),
    ("cambe", "Cambé", "shpCambe/perimetro.geojson", 26.33, 811.391, 30.816, 3084.83, 0.2630),
    ("apucarana", "Apucarana", "shpApucarana/perimetro.geojson", 34.16, 555.156, 16.252, 2866.91, 0.1936),
    ("maringa", "Maringá", "shpMaringa/perimetro.geojson", 91.67, 3623.476, 39.527, 18859.39, 0.1921),
    ("londrina", "Londrina", "shpLondrina/perimetro.geojson", 106.95, 3530.053, 33.007, 18423.49, 0.1916),
    ("cambira", "Cambira", "shpCambira/perimetro.geojson", 2.09, 28.420, 13.598, 159.25, 0.1785),
    ("jandaia", "Jandaia do Sul", "shpjSul/perimetro.geojson", 6.93, 108.470, 15.652, 609.39, 0.1780),
    ("arapongas", "Arapongas", "shpArapongas/perimetro.geojson", 33.91, 678.706, 20.015, 3992.39, 0.1700),
    ("sarandi", "Sarandi", "shpSarandi/perimetro.geojson", 19.00, 251.817, 13.254, 2228.63, 0.1130),
]


def main():
    features = []
    for slug, name, relative, extent, gva, lud, land_value, lvy in ROWS:
        source_path = SOURCE_ROOT / relative
        source = json.loads(source_path.read_text(encoding="utf-8"))
        crs_name = source.get("crs", {}).get("properties", {}).get("name", "")
        if "31982" in crs_name:
            ogr2ogr = shutil.which("ogr2ogr")
            if not ogr2ogr:
                raise RuntimeError("ogr2ogr is required to transform EPSG:31982 urban perimeters")
            converted = subprocess.run(
                [ogr2ogr, "-f", "GeoJSON", "/vsistdout/", str(source_path), "-t_srs", "EPSG:4326"],
                check=True, capture_output=True, text=True
            )
            source = json.loads(converted.stdout)
        geometries = [feature["geometry"] for feature in source["features"]]
        geometry = geometries[0] if len(geometries) == 1 else {
            "type": "GeometryCollection", "geometries": geometries
        }
        features.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "slug": slug,
                "name": name,
                "developed_extent_km2_2024": extent,
                "gva_csi_usd_million_2023": gva,
                "lud_2023_2024": lud,
                "developed_land_value_usd_million_2024": land_value,
                "lvy_2023_2024": lvy,
            },
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} municipal geometries to {OUTPUT}")


if __name__ == "__main__":
    main()
