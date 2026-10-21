# Bundled font files

Self-hosted rather than loaded from a CDN — this app's CSP (`style-src
'self'`, no `font-src`/`connect-src`) blocks an external Google Fonts
`<link>` outright, and bundling matches this project's existing
preference for local assets (see `../tool-logos/NOTICE.md`).

- `Fraunces-Variable.woff2` — the Fraunces variable font (weight axis
  covering 500/600 as used here), from [Google Fonts](https://fonts.google.com/specimen/Fraunces),
  designed by Undercase Type. Licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org/).
- `InstrumentSans-Variable.woff2` — the Instrument Sans variable font
  (weight axis covering 400–700 as used here), from [Google Fonts](https://fonts.google.com/specimen/Instrument+Sans),
  designed by Instrument. Licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org/).

Both fonts' OFL permits bundling/embedding and modification (including
subsetting) for use in software; neither font's name is used as this
app's own branding.
