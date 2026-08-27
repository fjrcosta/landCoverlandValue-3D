#!/usr/bin/env python3
"""Extract the published OSM road hierarchy into compact 3D-viewer data.

The source Folium HTML contains one embedded GeoJSON layer for each displayed
OSM ``highway`` class. Directed graph edges that share the same geometry are
deduplicated (including reversed coordinate order) before writing one compact
JSON file per municipality.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROAD_CLASSES = [
    {"key": "motorway", "label": "Motorway", "color": "#4B0082", "width": 3.5},
    {"key": "trunk", "label": "Trunk", "color": "#6A0DAD", "width": 3.0},
    {"key": "primary", "label": "Primary", "color": "#8B008B", "width": 2.5},
    {"key": "secondary", "label": "Secondary", "color": "#9932CC", "width": 2.0},
    {"key": "residential", "label": "Residential", "color": "#DDA0DD", "width": 0.8},
]
CLASS_INDEX = {item["key"]: index for index, item in enumerate(ROAD_CLASSES)}
CITY_SLUGS = {
    "Londrina": "londrina",
    "Maringá": "maringa",
    "Cambé": "cambe",
    "Ibiporã": "ibipora",
    "Apucarana": "apucarana",
    "Arapongas": "arapongas",
    "Marialva": "marialva",
    "Sarandi": "sarandi",
    "Rolândia": "rolandia",
    "Mandaguari": "mandaguari",
    "Jandaia do Sul": "jandaia",
    "Cambira": "cambira",
}
CITY_ORDER = [
    "londrina", "cambe", "ibipora", "rolandia", "arapongas", "apucarana",
    "cambira", "jandaia", "mandaguari", "marialva", "sarandi", "maringa",
]
CITY_NAMES = {slug: name for name, slug in CITY_SLUGS.items()}
GEOJSON_CALL = re.compile(r"(geo_json_[A-Za-z0-9]+)_add\s*\(")


def structured_end(text: str, start: int) -> int:
    depth = 0
    in_string = False
    escaped = False
    for position in range(start, len(text)):
        character = text[position]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return position + 1
    raise ValueError("Could not find the end of an embedded GeoJSON object")


def embedded_geojson(text: str):
    seen: set[tuple[int, int]] = set()
    for match in GEOJSON_CALL.finditer(text):
        start = match.end()
        while start < len(text) and text[start].isspace():
            start += 1
        if start >= len(text) or text[start] != "{":
            continue
        end = structured_end(text, start)
        if (start, end) in seen:
            continue
        seen.add((start, end))
        yield json.loads(text[start:end])


def compact_path(coordinates) -> list[list[float]]:
    return [[round(float(lon), 6), round(float(lat), 6)] for lon, lat, *rest in coordinates]


def canonical_path(path: list[list[float]]) -> tuple[tuple[float, float], ...]:
    forward = tuple((point[0], point[1]) for point in path)
    reverse = tuple(reversed(forward))
    return min(forward, reverse)


def extract_roads(source: Path) -> tuple[dict[str, list[list]], int]:
    text = source.read_text(encoding="utf-8")
    roads: dict[str, list[list]] = defaultdict(list)
    seen: dict[str, set[tuple[int, tuple[tuple[float, float], ...]]]] = defaultdict(set)
    directed_count = 0

    for layer in embedded_geojson(text):
        features = layer.get("features", [])
        if not features:
            continue
        properties = features[0].get("properties", {})
        highway = properties.get("highway")
        if highway not in CLASS_INDEX:
            continue
        for feature in features:
            props = feature.get("properties", {})
            city_name = props.get("cidade")
            feature_highway = props.get("highway")
            geometry = feature.get("geometry", {})
            if city_name not in CITY_SLUGS:
                raise ValueError(f"Unknown municipality in OSM layer: {city_name!r}")
            if feature_highway not in CLASS_INDEX:
                raise ValueError(f"Unexpected highway class: {feature_highway!r}")
            if geometry.get("type") != "LineString":
                raise ValueError(f"Expected LineString, found {geometry.get('type')!r}")
            directed_count += 1
            path = compact_path(geometry["coordinates"])
            class_index = CLASS_INDEX[feature_highway]
            key = (class_index, canonical_path(path))
            slug = CITY_SLUGS[city_name]
            if key in seen[slug]:
                continue
            seen[slug].add(key)
            roads[slug].append([class_index, path])

    missing = [slug for slug in CITY_ORDER if not roads.get(slug)]
    if missing:
        raise ValueError(f"No OSM roads extracted for: {', '.join(missing)}")
    return roads, directed_count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-html", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("site/map3d/data/transport"))
    parser.add_argument("--snapshot", default="2025-12-28")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    roads, directed_count = extract_roads(args.source_html)
    city_dir = args.output_dir / "cities"
    city_dir.mkdir(parents=True, exist_ok=True)

    city_manifest = []
    global_counts: Counter[str] = Counter()
    for slug in CITY_ORDER:
        records = sorted(roads[slug], key=lambda item: (item[0], item[1]))
        counts = Counter(ROAD_CLASSES[record[0]]["key"] for record in records)
        global_counts.update(counts)
        payload = {
            "schemaVersion": 1,
            "slug": slug,
            "name": CITY_NAMES[slug],
            "roads": records,
        }
        relative_file = f"data/transport/cities/{slug}.json"
        (city_dir / f"{slug}.json").write_text(
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8",
        )
        city_manifest.append({
            "slug": slug,
            "name": CITY_NAMES[slug],
            "file": relative_file,
            "segments": len(records),
            "classCounts": {item["key"]: counts[item["key"]] for item in ROAD_CLASSES},
        })

    total = sum(global_counts.values())
    manifest = {
        "schemaVersion": 1,
        "source": "OpenStreetMap contributors",
        "sourceUrl": "https://www.openstreetmap.org/",
        "license": "Open Data Commons Open Database License (ODbL)",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/",
        "snapshot": args.snapshot,
        "classes": ROAD_CLASSES,
        "globalStats": {
            "cities": len(city_manifest),
            "segments": total,
            "sourceDirectedSegments": directed_count,
            "classCounts": {item["key"]: global_counts[item["key"]] for item in ROAD_CLASSES},
        },
        "cities": city_manifest,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        f"Wrote {total:,} unique OSM road geometries across {len(city_manifest)} cities "
        f"({directed_count:,} directed source segments)."
    )


if __name__ == "__main__":
    main()
