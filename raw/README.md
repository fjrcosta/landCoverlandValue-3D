# Raw model outputs

Place the twelve DINOv2–LoRA land-cover CSVs in `land_cover/` and the twelve TabPFN model-60 land-value CSVs (`inferencia_<City>_cfg60_450m2.csv`) in `land_value/`. The land-value files must provide `utm_x`, `utm_y`, `unit_q50`, `configuracao` and `area_m2`; `unit_q50` is consumed directly in R$/m². CSV files are ignored by Git by default to prevent accidental publication of large or restricted research data. The generated compact website files under `site/map3d/data/` are not ignored.
