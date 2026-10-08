#!/usr/bin/env python3
"""Attach exact CSV patch vertices to site JSON and merge duplicate cell centres."""

from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COVER_DIR = ROOT / "raw" / "land_cover"
DATA_DIR = ROOT / "site" / "map3d" / "data"
CLASS_KEYS = ["bare", "bush", "crop", "grass", "hduf", "industrial", "lduf", "mduf", "tree", "water"]
EARTH_RADIUS_M = 6_371_008.8


def parse_latlon(value: str) -> tuple[float, float]:
    lat, lon = value.split(",")
    return float(lat), float(lon)


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    y = math.radians(lat2 - lat1) * EARTH_RADIUS_M
    x = math.radians(lon2 - lon1) * EARTH_RADIUS_M * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(x, y)


def cover_geometry(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    patches = []
    bins = defaultdict(list)
    step = 0.002
    for row in rows:
        lat, lon = parse_latlon(row["center"])
        polygon = []
        for column in ("top_left", "top_right", "bottom_right", "bottom_left"):
            vertex_lat, vertex_lon = parse_latlon(row[column])
            polygon.append([vertex_lon, vertex_lat])
        item = ((lon, lat), polygon)
        patches.append(item)
        bins[(int(lat / step), int(lon / step))].append(item)
    return patches, bins, step


def nearest_polygon(lon: float, lat: float, bins, step: float):
    key = (int(lat / step), int(lon / step))
    candidates = []
    for row in range(key[0] - 1, key[0] + 2):
        for column in range(key[1] - 1, key[1] + 2):
            candidates.extend(bins.get((row, column), []))
    if not candidates:
        raise ValueError(f"No land-cover patch near {lon}, {lat}")
    centre, polygon = min(candidates, key=lambda item: distance_m((lon, lat), item[0]))
    error = distance_m((lon, lat), centre)
    if error > 0.2:
        raise ValueError(f"Patch-centre mismatch is {error:.3f} m at {lon}, {lat}")
    return polygon


def median(values):
    return round(float(statistics.median(values)), 6)


def merge_group(group, polygon):
    classes = {cell[3] for cell in group}
    if len(classes) != 1:
        raise ValueError("Duplicate centre has conflicting land-cover categories")
    return [
        group[0][0], group[0][1], round(median([cell[2] for cell in group]), 2), group[0][3],
        round(median([cell[4] for cell in group]), 4), round(median([cell[5] for cell in group]), 2),
        median([cell[6] for cell in group]), round(median([cell[7] for cell in group]), 2),
        round(median([cell[8] for cell in group]), 2), polygon,
    ]


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def stats(cells, threshold):
    prices = [cell[2] for cell in cells]
    confidence = [cell[4] for cell in cells]
    distances = [cell[5] for cell in cells]
    counts = Counter(CLASS_KEYS[cell[3]] for cell in cells)
    class_counts = {key: counts.get(key, 0) for key in CLASS_KEYS}
    return {
        "cells": len(cells), "min": round(min(prices), 2), "p10": round(percentile(prices, 0.1), 2),
        "median": round(percentile(prices, 0.5), 2), "mean": round(statistics.mean(prices), 2),
        "p90": round(percentile(prices, 0.9), 2), "max": round(max(prices), 2),
        "meanConfidence": round(statistics.mean(confidence), 4),
        "medianMatchDistanceM": round(percentile(distances, 0.5), 2),
        "p95MatchDistanceM": round(percentile(distances, 0.95), 2),
        "dominantClass": max(class_counts, key=class_counts.get), "classCounts": class_counts,
        "matchesOverThreshold": sum(value > threshold for value in distances), "matchThresholdM": threshold,
    }


def main():
    manifest_path = DATA_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_cells = []
    total_counts = Counter()
    merged_total = 0
    for city in manifest["cities"]:
        slug = city["slug"]
        cover_path = COVER_DIR / f"inference_results_{slug}.csv"
        _, bins, step = cover_geometry(cover_path)
        city_path = ROOT / "site" / "map3d" / city["file"]
        payload = json.loads(city_path.read_text(encoding="utf-8"))
        groups = defaultdict(list)
        for cell in payload["cells"]:
            groups[(cell[0], cell[1])].append(cell)
        cells = []
        for (lon, lat), group in groups.items():
            polygon = nearest_polygon(lon, lat, bins, step)
            cells.append(merge_group(group, polygon))
        merged = len(payload["cells"]) - len(cells)
        merged_total += merged
        threshold = payload.get("stats", {}).get("matchThresholdM", 250.0)
        payload["schemaVersion"] = 4
        payload["geometryEncoding"] = "cell[9] = exact [lon,lat] patch vertices in TL,TR,BR,BL order"
        payload["cells"] = cells
        payload["stats"] = stats(cells, threshold)
        city["stats"] = payload["stats"]
        city_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        all_cells.extend(cells)
        total_counts.update({key: payload["stats"]["classCounts"][key] for key in CLASS_KEYS})
        print(f"{payload['name']}: {len(cells):,} unique patches ({merged} duplicates merged)")

    prices = [cell[2] for cell in all_cells]
    manifest["schemaVersion"] = 4
    manifest["geometryEncoding"] = "Exact four-vertex patch polygons; duplicate centres merged by median prediction"
    manifest["globalStats"] = {
        "cities": len(manifest["cities"]), "cells": len(all_cells), "min": round(min(prices), 2),
        "median": round(percentile(prices, 0.5), 2), "p90": round(percentile(prices, 0.9), 2),
        "max": round(max(prices), 2), "classCounts": {key: total_counts[key] for key in CLASS_KEYS},
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(all_cells):,} exact polygons; merged {merged_total} duplicate records")


if __name__ == "__main__":
    main()
