#!/usr/bin/env python3
"""Validate the static website data and required asset references using stdlib only."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
MAP3D = SITE / "map3d"


def fail(message: str) -> None:
    raise SystemExit(f"VALIDATION ERROR: {message}")


def main() -> None:
    landing = SITE / "index.html"
    index = MAP3D / "index.html"
    app = MAP3D / "assets" / "app.js"
    css = MAP3D / "assets" / "styles.css"
    manifest_path = MAP3D / "data" / "manifest.json"
    for path in (landing, index, app, css, manifest_path):
        if not path.exists():
            fail(f"Missing {path.relative_to(ROOT)}")

    html = index.read_text(encoding="utf-8")
    for ref in ("./assets/app.js", "./assets/styles.css"):
        if ref not in html:
            fail(f"index.html does not reference {ref}")
    required_ids = ["map", "citySelect", "classFilters", "loadingOverlay", "aboutDialog"]
    for element_id in required_ids:
        if not re.search(rf'id=["\']{re.escape(element_id)}["\']', html):
            fail(f"index.html is missing #{element_id}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("datasetMode") == "model-output":
        if manifest.get("modelConfiguration") != 60:
            fail("Model-output manifest does not identify configuration 60")
        if manifest.get("referenceParcelAreaM2") != 450:
            fail("Model-output manifest does not identify the 450 m² reference parcel")
    classes = manifest.get("classes", [])
    cities = manifest.get("cities", [])
    if len(classes) != 10:
        fail(f"Expected 10 classes, found {len(classes)}")
    if not cities:
        fail("Manifest contains no cities")

    class_keys = [item["key"] for item in classes]
    if len(class_keys) != len(set(class_keys)):
        fail("Class keys are not unique")

    total = 0
    for meta in cities:
        city_path = MAP3D / meta["file"]
        if not city_path.exists():
            fail(f"Missing city data file {meta['file']}")
        city = json.loads(city_path.read_text(encoding="utf-8"))
        if city.get("slug") != meta.get("slug"):
            fail(f"City slug mismatch in {meta['file']}")
        cells = city.get("cells", [])
        if not cells:
            fail(f"No cells in {meta['file']}")
        for i, cell in enumerate(cells):
            if len(cell) != 6:
                fail(f"{meta['file']} cell {i} has {len(cell)} fields, expected 6")
            lon, lat, price, class_index, confidence, distance = cell
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                fail(f"Invalid coordinate in {meta['file']} cell {i}")
            if not (price > 0):
                fail(f"Non-positive price in {meta['file']} cell {i}")
            if not (0 <= class_index < len(classes)):
                fail(f"Invalid class index in {meta['file']} cell {i}")
            if not (0 <= confidence <= 1):
                fail(f"Invalid confidence in {meta['file']} cell {i}")
            if distance < 0:
                fail(f"Negative match distance in {meta['file']} cell {i}")
        if meta.get("stats", {}).get("cells") != len(cells):
            fail(f"Cell count mismatch in manifest for {meta['slug']}")
        total += len(cells)

    if manifest.get("globalStats", {}).get("cells") != total:
        fail("Global cell count does not match city files")

    print(
        f"Validated static site: {len(cities)} cities, {len(classes)} classes, "
        f"{total:,} cells, datasetMode={manifest.get('datasetMode')}"
    )


if __name__ == "__main__":
    main()
