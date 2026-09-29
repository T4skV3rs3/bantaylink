# BantayLink

Evidence-first public accountability explorer for Philippine election records, political-family research, infrastructure status, procurement, FOI responses, and audit evidence.

## Alpha

This is a static-first research alpha. It runs without a database, paid API, or secret key. The UI uses a small provenance-preserving seed dataset while live adapters are developed.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Core data rules

- Preserve the source-native status of a record. Do not turn a weak signal into a claim of illegality or misconduct.
- Never infer kinship from surname alone. A same-surname match is only a research lead.
- Every record and relationship should retain its provenance.
- Distinguish government findings, official documents, independent datasets, media reports, and inference leads.
- Correlation is a research lead, not a causal claim.

## Planned source adapters

OpenHalalan, DPWH Transparency/eFOI, DA SIDLAN, COA eLibrary, and PhilGEPS.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [ADAPTERS.md](./ADAPTERS.md), and [SOURCES.md](./SOURCES.md).
