# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rtx31/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rtx31/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 226 pre-token protocols by an implied value priced from each category's own live comparables, with a concrete farm plan for every row. The board covers all 40 watchlist protocols and every rankable pre-token protocol below the $50M floor, and the dashboard recomputes every number from the same model so the screenshots and the code agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program reads the sealed DefiLlama snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/`, then writes `out/dossier.json` with the vendored make.fun library. Node 22, standard library only, no network, no clock, no randomness: run it twice and the outputs are byte for byte the same.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4gvpf9bn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
