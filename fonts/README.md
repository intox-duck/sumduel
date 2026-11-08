# Fonts

Self-hosted web fonts, subset to the characters Sum Duel uses (Latin, digits, maths operators).
Subsetting counts as modification, so every file has a new name (`sd-` prefix) as the licences ask.

| File | Source | Licence |
|---|---|---|
| `sd-lmroman-{regular,italic,bold}.woff2`, `sd-lmroman-caps.woff2` | Latin Modern Roman 10 / Roman Caps 10 (GUST e-foundry, CTAN `fonts/lm`) | GUST Font License (LPPL 1.3c), see `GUST-FONT-LICENSE.txt` |
| `sd-leanmono-{regular,bold}.woff2` | JuliaMono v0.63.2 by cormullion. Internal name changed to "SD Lean Mono" because "JuliaMono" is an OFL Reserved Font Name | SIL OFL 1.1, see `JuliaMono-OFL.txt` |

To rebuild, use `pyftsubset` from fonttools with `--flavor=woff2`. The unicode ranges are in master-ref.md §4.
