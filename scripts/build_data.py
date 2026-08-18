#!/usr/bin/env python3
"""Convert DINOv2–LoRA land-cover CSVs and TabPFN land-value CSVs for the web viewer.

Expected land-cover columns
---------------------------
predicted_class, prediction_confidence and either:
  * center formatted as "latitude,longitude", or
  * top_left, top_right, bottom_left, bottom_right in the same format.

Expected land-value columns
---------------------------
utm_x, utm_y, unit_q10, unit_q50, unit_q90, pinaw_pontual,
configuracao, area_m2

The model-60 unit_q50 estimate is already expressed in R$/m² and is used
directly, without exponentiation. The pinaw_pontual field is the normalized
pointwise predictive-interval width, w_i* = w_i / R, calculated on the log scale.
The script joins each land-value grid-cell centre to its nearest land-cover patch
centre in a metric projected CRS and writes compact per-city JSON files.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

CLASS_KEYS = ["bare", "bush", "crop", "grass", "hduf", "industrial", "lduf", "mduf", "tree", "water"]
CLASS_LABELS = {
    "bare": "Bare soil",
    "bush": "Shrubs / scrub",
    "crop": "Row crops",
    "grass": "Grass / pasture",
    "hduf": "Developed — high density",
    "industrial": "Industrial",
    "lduf": "Developed — low density",
    "mduf": "Developed — medium density",
    "tree": "Trees",
    "water": "Water",
}
CLASS_INDEX = {key: i for i, key in enumerate(CLASS_KEYS)}

VALUE_COLUMN = "unit_q50"
LOWER_VALUE_COLUMN = "unit_q10"
UPPER_VALUE_COLUMN = "unit_q90"
POINTWISE_WIDTH_COLUMN = "pinaw_pontual"
MODEL_CONFIGURATION = 60
REFERENCE_PARCEL_AREA_M2 = 450
DATA_YEAR = 2024

CITY_ORDER = [
    "londrina", "cambe", "ibipora", "rolandia", "arapongas", "apucarana",
    "cambira", "jandaia", "mandaguari", "marialva", "sarandi", "maringa"
]
CITY_NAMES = {
    "londrina": "Londrina",
    "cambe": "Cambé",
    "ibipora": "Ibiporã",
    "rolandia": "Rolândia",
    "arapongas": "Arapongas",
    "apucarana": "Apucarana",
    "cambira": "Cambira",
    "jandaia": "Jandaia do Sul",
    "mandaguari": "Mandaguari",
    "marialva": "Marialva",
    "sarandi": "Sarandi",
    "maringa": "Maringá",
}
ALIASES = {
    "londrina": ["londrina", "lda"],
    "cambe": ["cambe"],
    "ibipora": ["ibipora", "ibip"],
    "rolandia": ["rolandia", "rol"],
    "arapongas": ["arapongas", "arap"],
    "apucarana": ["apucarana", "apuc"],
    "cambira": ["cambira", "cambir"],
    "jandaia": ["jandaia", "jand"],
    "mandaguari": ["mandaguari", "mand"],
    "marialva": ["marialva", "mari"],
    "sarandi": ["sarandi", "sar"],
    "maringa": ["maringa", "maring"],
}


def normalize(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", ascii_text.lower()).strip("_")


def infer_city(path: Path) -> str | None:
    text = normalize(str(path))
    # Test longer aliases first to avoid Marialva/Maringá prefix ambiguity.
    candidates = sorted(
        ((slug, alias) for slug, aliases in ALIASES.items() for alias in aliases),
        key=lambda item: len(item[1]), reverse=True
    )
    for slug, alias in candidates:
        if re.search(rf"(^|_){re.escape(alias)}($|_)", text):
            return slug
    return None


def read_csv_auto(path: Path) -> pd.DataFrame:
    attempts = [
        {"sep": None, "engine": "python"},
        {"sep": ";"},
        {"sep": ","},
    ]
    last_error: Exception | None = None
    for kwargs in attempts:
        try:
            frame = pd.read_csv(path, **kwargs)
            if frame.shape[1] > 1:
                frame.columns = [normalize(str(c)) for c in frame.columns]
                return frame
        except Exception as exc:  # pragma: no cover - retains diagnostic context
            last_error = exc
    raise ValueError(f"Could not parse CSV {path}: {last_error}")


def parse_latlon(value: object) -> tuple[float, float]:
    if pd.isna(value):
        raise ValueError("Missing coordinate")
    parts = re.split(r"\s*,\s*", str(value).strip())
    if len(parts) != 2:
        raise ValueError(f"Expected 'latitude,longitude', got {value!r}")
    return float(parts[0]), float(parts[1])


def land_cover_centres(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    if "center" in frame.columns:
        parsed = frame["center"].map(parse_latlon)
        lat = np.asarray([p[0] for p in parsed], dtype=float)
        lon = np.asarray([p[1] for p in parsed], dtype=float)
        return lon, lat

    corners = ["top_left", "top_right", "bottom_left", "bottom_right"]
    missing = [col for col in corners if col not in frame.columns]
    if missing:
        raise ValueError(f"Land-cover CSV needs center or all four corners; missing {missing}")
    corner_arrays = []
    for col in corners:
        parsed = frame[col].map(parse_latlon)
        corner_arrays.append(np.asarray([[p[1], p[0]] for p in parsed], dtype=float))
    stacked = np.stack(corner_arrays, axis=0)
    mean_coords = stacked.mean(axis=0)
    return mean_coords[:, 0], mean_coords[:, 1]


def find_city_files(directory: Path, pattern: str = "*.csv") -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in sorted(directory.rglob(pattern)):
        if path.name.startswith("._"):
            continue
        if "consolidado" in normalize(path.stem):
            continue
        slug = infer_city(path)
        if not slug:
            print(f"WARNING: city could not be inferred from {path.name}; skipped")
            continue
        if slug in result:
            raise ValueError(f"More than one CSV inferred for {slug}: {result[slug]} and {path}")
        result[slug] = path
    return result


def percentile(values: Iterable[float], q: float) -> float:
    return float(np.percentile(np.asarray(list(values), dtype=float), q))


def city_stats(records: list[list]) -> dict:
    prices = np.asarray([r[2] for r in records], dtype=float)
    confidence = np.asarray([r[4] for r in records], dtype=float)
    distances = np.asarray([r[5] for r in records], dtype=float)
    counts = {key: 0 for key in CLASS_KEYS}
    for record in records:
        counts[CLASS_KEYS[record[3]]] += 1
    dominant = max(counts, key=counts.get)
    return {
        "cells": len(records),
        "min": round(float(prices.min()), 2),
        "p10": round(float(np.percentile(prices, 10)), 2),
        "median": round(float(np.percentile(prices, 50)), 2),
        "mean": round(float(prices.mean()), 2),
        "p90": round(float(np.percentile(prices, 90)), 2),
        "max": round(float(prices.max()), 2),
        "meanConfidence": round(float(confidence.mean()), 4),
        "medianMatchDistanceM": round(float(np.median(distances)), 2),
        "p95MatchDistanceM": round(float(np.percentile(distances, 95)), 2),
        "dominantClass": dominant,
        "classCounts": counts,
    }


def build_city(
    slug: str,
    cover_path: Path,
    value_path: Path,
    value_to_wgs: Transformer,
    wgs_to_metric: Transformer,
    max_match_distance: float,
    grid_size_m: float,
) -> dict:
    cover = read_csv_auto(cover_path)
    value = read_csv_auto(value_path)

    cover_required = {"predicted_class", "prediction_confidence"}
    value_required = {
        "utm_x", "utm_y", LOWER_VALUE_COLUMN, VALUE_COLUMN,
        UPPER_VALUE_COLUMN, POINTWISE_WIDTH_COLUMN,
        "configuracao", "area_m2"
    }
    if not cover_required.issubset(cover.columns):
        raise ValueError(f"{cover_path.name} missing {sorted(cover_required - set(cover.columns))}")
    if not value_required.issubset(value.columns):
        raise ValueError(f"{value_path.name} missing {sorted(value_required - set(value.columns))}")

    configuration = pd.to_numeric(value["configuracao"], errors="coerce")
    if not configuration.eq(MODEL_CONFIGURATION).all():
        raise ValueError(
            f"{value_path.name} does not exclusively contain model configuration "
            f"{MODEL_CONFIGURATION}"
        )
    reference_area = pd.to_numeric(value["area_m2"], errors="coerce")
    if not reference_area.eq(REFERENCE_PARCEL_AREA_M2).all():
        raise ValueError(
            f"{value_path.name} does not exclusively use the "
            f"{REFERENCE_PARCEL_AREA_M2} m² reference parcel"
        )

    cover = cover.dropna(subset=["predicted_class", "prediction_confidence"]).copy()
    cover["predicted_class"] = cover["predicted_class"].astype(str).map(normalize)
    unknown = sorted(set(cover["predicted_class"]) - set(CLASS_KEYS))
    if unknown:
        raise ValueError(f"Unknown land-cover classes in {cover_path.name}: {unknown}")

    cover_lon, cover_lat = land_cover_centres(cover)
    cover_x, cover_y = wgs_to_metric.transform(cover_lon, cover_lat)
    tree = cKDTree(np.column_stack([cover_x, cover_y]))

    utm_x = pd.to_numeric(value["utm_x"], errors="coerce").to_numpy(dtype=float)
    utm_y = pd.to_numeric(value["utm_y"], errors="coerce").to_numpy(dtype=float)
    prices = pd.to_numeric(value[VALUE_COLUMN], errors="coerce").to_numpy(dtype=float)
    lower_values = pd.to_numeric(
        value[LOWER_VALUE_COLUMN], errors="coerce"
    ).to_numpy(dtype=float)
    upper_values = pd.to_numeric(
        value[UPPER_VALUE_COLUMN], errors="coerce"
    ).to_numpy(dtype=float)
    pointwise_width = pd.to_numeric(
        value[POINTWISE_WIDTH_COLUMN], errors="coerce"
    ).to_numpy(dtype=float)
    valid = (
        np.isfinite(utm_x) & np.isfinite(utm_y) & np.isfinite(prices)
        & np.isfinite(lower_values) & np.isfinite(upper_values)
        & np.isfinite(pointwise_width) & (pointwise_width >= 0)
    )
    utm_x, utm_y, prices, lower_values, upper_values, pointwise_width = (
        utm_x[valid], utm_y[valid], prices[valid], lower_values[valid],
        upper_values[valid], pointwise_width[valid]
    )

    lon, lat = value_to_wgs.transform(utm_x, utm_y)
    metric_x, metric_y = wgs_to_metric.transform(lon, lat)
    distance, nearest = tree.query(np.column_stack([metric_x, metric_y]), k=1)

    classes = cover["predicted_class"].to_numpy()[nearest]
    confidence = pd.to_numeric(cover["prediction_confidence"], errors="coerce").fillna(0).to_numpy(dtype=float)[nearest]
    finite_price = np.isfinite(prices) & (prices > 0)
    lon, lat, prices = np.asarray(lon)[finite_price], np.asarray(lat)[finite_price], prices[finite_price]
    lower_values, upper_values = lower_values[finite_price], upper_values[finite_price]
    pointwise_width = pointwise_width[finite_price]
    classes, confidence, distance = classes[finite_price], confidence[finite_price], distance[finite_price]

    records = [
        [round(float(lo), 6), round(float(la), 6), round(float(pr), 2),
         CLASS_INDEX[cl], round(float(cf), 4), round(float(di), 2),
         round(float(pw), 6), round(float(q10), 2), round(float(q90), 2)]
        for lo, la, pr, cl, cf, di, pw, q10, q90 in zip(
            lon, lat, prices, classes, confidence, distance, pointwise_width,
            lower_values, upper_values
        )
    ]
    if not records:
        raise ValueError(f"No valid value records in {value_path.name}")

    stats = city_stats(records)
    stats["matchesOverThreshold"] = int(np.sum(distance > max_match_distance))
    stats["matchThresholdM"] = max_match_distance

    lons = [r[0] for r in records]
    lats = [r[1] for r in records]
    return {
        "schemaVersion": 3,
        "source": "model-output",
        "slug": slug,
        "name": CITY_NAMES[slug],
        "center": [round(float(np.mean(lons)), 6), round(float(np.mean(lats)), 6)],
        "bounds": [[min(lons), min(lats)], [max(lons), max(lats)]],
        "gridSizeM": grid_size_m,
        "stats": stats,
        "cells": records,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--land-cover-dir", type=Path, required=True, help="Directory containing one DINOv2–LoRA CSV per city")
    parser.add_argument("--land-value-dir", type=Path, required=True, help="Directory containing one TabPFN CSV per city")
    parser.add_argument(
        "--land-value-pattern",
        default="inferencia_*_cfg60_450m2.csv",
        help="Filename pattern used to select model-60 land-value CSVs",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("site/map3d/data"), help="Website data directory")
    parser.add_argument("--utm-crs", default="EPSG:29192", help="CRS of utm_x and utm_y; notebook default: EPSG:29192")
    parser.add_argument("--metric-crs", default="EPSG:31982", help="Metric CRS used for nearest-neighbour matching")
    parser.add_argument("--grid-size-m", type=float, default=109.45)
    parser.add_argument("--max-match-distance", type=float, default=250.0, help="Diagnostic threshold; matches are retained and counted")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cover_files = find_city_files(args.land_cover_dir)
    value_files = find_city_files(args.land_value_dir, args.land_value_pattern)
    common = [slug for slug in CITY_ORDER if slug in cover_files and slug in value_files]
    missing_cover = [slug for slug in CITY_ORDER if slug not in cover_files]
    missing_value = [slug for slug in CITY_ORDER if slug not in value_files]

    if not common:
        raise SystemExit("No city pairs were found. Ensure filenames contain recognizable city names.")
    if missing_cover:
        print("WARNING: missing land-cover CSVs:", ", ".join(missing_cover))
    if missing_value:
        print("WARNING: missing land-value CSVs:", ", ".join(missing_value))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    city_output = args.output_dir / "cities"
    city_output.mkdir(parents=True, exist_ok=True)

    value_to_wgs = Transformer.from_crs(args.utm_crs, "EPSG:4326", always_xy=True)
    wgs_to_metric = Transformer.from_crs("EPSG:4326", args.metric_crs, always_xy=True)

    city_manifest = []
    all_prices: list[float] = []
    total_counts = {key: 0 for key in CLASS_KEYS}

    for slug in common:
        print(f"Building {CITY_NAMES[slug]}…")
        city = build_city(
            slug, cover_files[slug], value_files[slug], value_to_wgs, wgs_to_metric,
            args.max_match_distance, args.grid_size_m
        )
        output_path = city_output / f"{slug}.json"
        output_path.write_text(json.dumps(city, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        city_manifest.append({
            "slug": slug,
            "name": city["name"],
            "center": city["center"],
            "bounds": city["bounds"],
            "stats": city["stats"],
            "file": f"data/cities/{slug}.json",
        })
        all_prices.extend(record[2] for record in city["cells"])
        for key, count in city["stats"]["classCounts"].items():
            total_counts[key] += count
        print(
            f"  {city['stats']['cells']:,} cells; median {city['stats']['median']:,.2f} R$/m²; "
            f"median match {city['stats']['medianMatchDistanceM']:.1f} m"
        )

    prices = np.asarray(all_prices, dtype=float)
    manifest = {
        "schemaVersion": 3,
        "title": "Northern Paraná Urban Twin",
        "datasetMode": "model-output",
        "warning": "Model-output visualization. Interpret values according to the validation, uncertainty and reference-parcel assumptions documented in the associated research.",
        "gridSizeM": args.grid_size_m,
        "dataYear": DATA_YEAR,
        "modelConfiguration": MODEL_CONFIGURATION,
        "referenceParcelAreaM2": REFERENCE_PARCEL_AREA_M2,
        "crs": "EPSG:4326",
        "sourceCrs": args.utm_crs,
        "modelLabels": {
            "landCover": "DINOv2 ViT-L/14 + LoRA",
            "landValue": "TabPFN v2 — median unit urban land value (configuration 60)",
        },
        "classes": [{"key": key, "label": CLASS_LABELS[key], "index": CLASS_INDEX[key]} for key in CLASS_KEYS],
        "globalStats": {
            "cities": len(city_manifest),
            "cells": len(all_prices),
            "min": round(float(prices.min()), 2),
            "median": round(float(np.percentile(prices, 50)), 2),
            "p90": round(float(np.percentile(prices, 90)), 2),
            "max": round(float(prices.max()), 2),
            "classCounts": total_counts,
        },
        "cities": city_manifest,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone: {len(all_prices):,} cells across {len(city_manifest)} cities written to {args.output_dir}")


if __name__ == "__main__":
    main()
