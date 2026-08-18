#!/usr/bin/env python3
"""Generate a deterministic demonstration dataset for the 12-city 3D viewer.

The generated values are synthetic and must not be interpreted as estimates.
They exist so the GitHub Pages site works before the model-output CSV files are added.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer

OUT = Path(__file__).resolve().parents[1] / "site" / "data"
CITY_OUT = OUT / "cities"
GRID_SIZE_M = 109.45

# lon, lat, relative east-west radius, relative north-south radius, price factor, seed
CITIES = {
    "londrina": ("Londrina", -51.1696, -23.3045, 31, 29, 1.26, 101),
    "cambe": ("Cambé", -51.2785, -23.2766, 20, 18, 0.86, 102),
    "ibipora": ("Ibiporã", -51.0484, -23.2692, 18, 17, 0.84, 103),
    "rolandia": ("Rolândia", -51.3669, -23.3103, 19, 18, 0.79, 104),
    "arapongas": ("Arapongas", -51.4245, -23.4157, 23, 21, 0.94, 105),
    "apucarana": ("Apucarana", -51.4600, -23.5508, 23, 22, 0.91, 106),
    "cambira": ("Cambira", -51.5780, -23.5890, 11, 10, 0.49, 107),
    "jandaia": ("Jandaia do Sul", -51.6404, -23.6011, 13, 12, 0.58, 108),
    "mandaguari": ("Mandaguari", -51.6710, -23.5442, 16, 15, 0.67, 109),
    "marialva": ("Marialva", -51.7917, -23.4855, 15, 14, 0.72, 110),
    "sarandi": ("Sarandi", -51.8733, -23.4430, 18, 17, 0.88, 111),
    "maringa": ("Maringá", -51.9386, -23.4205, 29, 27, 1.35, 112),
}

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
CLASS_PRICE_FACTOR = {
    "hduf": 1.50,
    "mduf": 1.18,
    "lduf": 0.96,
    "industrial": 0.82,
    "bare": 0.68,
    "grass": 0.54,
    "tree": 0.56,
    "bush": 0.50,
    "crop": 0.43,
    "water": 0.28,
}

WGS_TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
UTM_TO_WGS = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)


def percentile(values: list[float], p: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=float), p))


def choose_class(nx: float, ny: float, radial: float, rng: np.random.Generator) -> str:
    # A stylized but spatially coherent urban morphology used only for demonstration.
    river = abs(ny - (0.34 * math.sin(nx * 3.8) - 0.50))
    if river < 0.035 and nx > -0.55:
        return "water"
    if radial < 0.20:
        return "hduf"
    if radial < 0.42:
        if nx > 0.15 and -0.30 < ny < 0.05 and rng.random() < 0.42:
            return "industrial"
        return "mduf" if rng.random() > 0.10 else "tree"
    if radial < 0.68:
        if nx < -0.15 and ny > 0.10 and rng.random() < 0.18:
            return "industrial"
        return rng.choice(["lduf", "tree", "grass"], p=[0.68, 0.18, 0.14]).item()
    return rng.choice(["crop", "grass", "tree", "bush", "bare", "lduf"], p=[0.27, 0.22, 0.18, 0.11, 0.13, 0.09]).item()


def make_city(slug: str, cfg: tuple) -> dict:
    name, lon0, lat0, rx, ry, price_factor, seed = cfg
    rng = np.random.default_rng(seed)
    x0, y0 = WGS_TO_UTM.transform(lon0, lat0)
    records: list[list] = []
    prices: list[float] = []
    confidences: list[float] = []
    counts = {key: 0 for key in CLASS_KEYS}

    for ix in range(-rx, rx + 1):
        for iy in range(-ry, ry + 1):
            nx, ny = ix / rx, iy / ry
            radial = math.sqrt((nx * 0.98) ** 2 + (ny * 1.04) ** 2)
            boundary_noise = 0.06 * math.sin(ix * 0.61) + 0.04 * math.cos(iy * 0.77)
            if radial > 1.02 + boundary_noise:
                continue
            if radial > 0.70 and rng.random() < 0.08:
                continue

            klass = choose_class(nx, ny, radial, rng)
            directional = 1.0 + 0.18 * max(0.0, nx) + 0.09 * math.sin((nx + ny) * 4.0)
            accessibility = math.exp(-1.22 * radial)
            local_noise = float(np.exp(rng.normal(0.0, 0.18)))
            price = 135.0 + 4200.0 * price_factor * accessibility * CLASS_PRICE_FACTOR[klass] * directional * local_noise
            price = float(np.clip(price, 70.0, 8500.0))

            confidence_base = 0.94 if klass in {"water", "hduf", "industrial"} else 0.88
            confidence = float(np.clip(confidence_base - 0.12 * radial + rng.normal(0, 0.035), 0.56, 0.995))
            pointwise_width = float(np.clip(0.16 + 0.24 * radial + rng.normal(0, 0.025), 0.03, 0.75))
            q10 = price * math.exp(-0.5 * pointwise_width)
            q90 = price * math.exp(0.5 * pointwise_width)

            x = x0 + ix * GRID_SIZE_M
            y = y0 + iy * GRID_SIZE_M
            lon, lat = UTM_TO_WGS.transform(x, y)
            # Compact tuple: longitude, latitude, value R$/m², class index,
            # confidence, join distance m, normalized pointwise interval width,
            # lower and upper predictive quantiles in R$/m²
            records.append([round(lon, 6), round(lat, 6), round(price, 2), CLASS_INDEX[klass], round(confidence, 4), 0.0, round(pointwise_width, 6), round(q10, 2), round(q90, 2)])
            prices.append(price)
            confidences.append(confidence)
            counts[klass] += 1

    lons = [r[0] for r in records]
    lats = [r[1] for r in records]
    dominant = max(counts, key=counts.get)
    stats = {
        "cells": len(records),
        "min": round(min(prices), 2),
        "p10": round(percentile(prices, 10), 2),
        "median": round(percentile(prices, 50), 2),
        "mean": round(float(np.mean(prices)), 2),
        "p90": round(percentile(prices, 90), 2),
        "max": round(max(prices), 2),
        "meanConfidence": round(float(np.mean(confidences)), 4),
        "dominantClass": dominant,
        "classCounts": counts,
    }
    return {
        "schemaVersion": 3,
        "source": "synthetic-demonstration",
        "slug": slug,
        "name": name,
        "center": [lon0, lat0],
        "bounds": [[min(lons), min(lats)], [max(lons), max(lats)]],
        "gridSizeM": GRID_SIZE_M,
        "stats": stats,
        "cells": records,
    }


def main() -> None:
    CITY_OUT.mkdir(parents=True, exist_ok=True)
    manifest_cities = []
    all_prices = []
    total_cells = 0
    total_counts = {key: 0 for key in CLASS_KEYS}

    for slug, cfg in CITIES.items():
        city = make_city(slug, cfg)
        (CITY_OUT / f"{slug}.json").write_text(json.dumps(city, separators=(",", ":")), encoding="utf-8")
        manifest_cities.append({
            "slug": slug,
            "name": city["name"],
            "center": city["center"],
            "bounds": city["bounds"],
            "stats": city["stats"],
            "file": f"data/cities/{slug}.json",
        })
        all_prices.extend([r[2] for r in city["cells"]])
        total_cells += city["stats"]["cells"]
        for key, value in city["stats"]["classCounts"].items():
            total_counts[key] += value

    manifest = {
        "schemaVersion": 3,
        "title": "Northern Paraná Urban Twin",
        "datasetMode": "demo",
        "warning": "Synthetic demonstration data. Replace with model-output data before scientific interpretation.",
        "generatedAt": "2026-07-11",
        "gridSizeM": GRID_SIZE_M,
        "crs": "EPSG:4326",
        "modelLabels": {
            "landCover": "DINOv2 ViT-L/14 + LoRA",
            "landValue": "TabPFN v2 — median unit urban land value",
        },
        "classes": [{"key": key, "label": CLASS_LABELS[key], "index": CLASS_INDEX[key]} for key in CLASS_KEYS],
        "globalStats": {
            "cities": len(manifest_cities),
            "cells": total_cells,
            "min": round(min(all_prices), 2),
            "median": round(percentile(all_prices, 50), 2),
            "p90": round(percentile(all_prices, 90), 2),
            "max": round(max(all_prices), 2),
            "classCounts": total_counts,
        },
        "cities": manifest_cities,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Generated {total_cells:,} synthetic cells for {len(manifest_cities)} cities in {OUT}")


if __name__ == "__main__":
    main()
