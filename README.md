# Fast CSV reader — csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mietrea519-cyber/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mietrea519-cyber/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` exports `run(input)`, which returns exactly the answer
csv-reader 1.0.0 returns for `{text, header}` — `{columns, rows, errors}` with
its broken-row policy (BOM dropped, stray CRs, quoted fields with `""` escapes
and embedded line breaks, quote junk, unterminated quotes, short/long rows) —
but roughly 3× faster on the practice set: bulk native scans (`indexOf`,
`slice`, `split`) instead of the reference's character-at-a-time loop.

- `solve.js` — dependency-free ES module, the fast reader.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`, answers
  each case with `run`, writes `/output/answers.json`.

Try make.fun with my referral link: https://make.fun/r/1e3qpbvy
