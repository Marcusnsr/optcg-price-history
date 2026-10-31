# OPTCG price history

Daily price snapshots for One Piece Card Game singles, used by the OPTCG Collector app to show price history.

- `data/YYYY-MM.json` – one file per month (format described in `scripts/snapshot.mjs`)
- `data/index.json` – which months exist and the latest date

A GitHub Action (`.github/workflows/snapshot.yml`) runs once a day and adds that day's prices:

- **USD** – TCGplayer market price per printing, via [optcgapi.com](https://optcgapi.com)
- **EUR** – Cardmarket trend price per product, from Cardmarket's public price guide (English versions only)

Prices belong to their respective sources. This repository only contains price data, no app code.
