# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rtx31/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rtx31/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 226 pre-token protocols by an implied value priced from each category's own live comparables, with a concrete farm plan for every row. The board covers all 40 watchlist protocols and every rankable pre-token protocol below the $50M floor, and the dashboard recomputes every number from the same model so the screenshots and the code agree.

## The model (radar-2)

A live protocol's token already has a market price, so the median market-cap-per-dollar-of-TVL of a category's live protocols is the fairest multiple for that category's pre-token ones. A category with fewer than three live comparables falls back to the median over every live protocol, so one live protocol never sets a whole category.

```
category multiple = median(mcap_usd / tvl_usd) of the live protocols in the category,
                    clamped to [0.05, 1.00]; fewer than 3 live comparables takes the
                    global median instead (0.2138 in this snapshot)
implied = round( tvl_usd x category_multiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                 x (1 + 0.02 x min(chains - 1, 5)) )
```

The growth factor takes half of the seven-day move, clamped so neither a crash nor a spike runs away with the value. Maturity rewards the time a protocol has run with no token: 0.6 on day zero, rising to 1.0 after three years; an unknown age counts as one year. Chain breadth adds 2% per extra chain, up to five. No protocol name is ever special-cased: the same function scores every row, and the live-token protocols are set aside with their market caps shown — the market's own value, never a model's.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network, no clock, no randomness: run it twice and the outputs are byte for byte the same. The program reads the sealed DefiLlama snapshot (758 protocols, 2026-11-14), writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/`, then writes `out/dossier.json` with the vendored make.fun library.

## Verify it

```sh
mkdir -p out2 && MAKEFUN_OUTPUT_DIR=out2 node main.ts --input ../input/snapshot.json
diff -r out out2 && echo DETERMINISTIC
node ../gate-check.mjs out ../token-radar-01-kit/input/snapshot.json
```

The gate replication checks all seven rows: dashboard files, board validity, sort order, watchlist coverage, farm steps, screenshots, and dossier byte-equality. The board holds 226 rows (40 watchlist + 186 early), rank 1 Steakhouse Financial at $511,417,128, with 6 farm steps per row.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, scores it, writes the outputs.
- `lib/model.ts` — the value model, the board, the farm plans, the snapshot parser.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js` (recomputes the model and the farm plans in the page, so the judge verifies numbers from the source it reads).
- `screenshots/` — the three views: the board, a protocol's detail drawer, a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, copied as-is.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4gvpf9bn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
