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

## Ingestion adapters

Implemented: OpenHalalan winners/vote counts, DPWH Transparency project API and contract details, DPWH eFOI evidence documents, DA SIDLAN I-BUILD JSON ingestion, COA eLibrary explicit-document ingestion, and PhilGEPS Open Data JSON/CSV ingestion.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [ADAPTERS.md](./ADAPTERS.md), and [SOURCES.md](./SOURCES.md).

## Entity resolution v1.0

BantayLink now has a conservative entity-resolution pipeline in \`src/resolution/engine.js\`. It separates source identity records from derived canonical identities and creates reviewable candidate matches. Exact external identifiers can produce identifier-backed organization identities; person matches from names/locality remain \`INFERENCE_LEAD\` candidates and are not silently merged.

Run after provenance data is populated:

\`\`\`bash
npm run resolve
\`\`\`

Use \`BANTAYLINK_MAX_RESOLUTION_CANDIDATES\` to bound a run for testing.

## Evidence UI

The web UI includes **Entity resolution**, **Correlations**, and **Evidence trail** views. The evidence view is backed by \`/api/evidence\` and exposes the entity, observations, raw retrieval metadata, hashes, repeat-run occurrence counts, and source-backed edges that sit beneath a selected record or finding.

# Correlation engine v0.5

The v0.5 correlation engine produces source-referenced findings without mutating source-backed edges. It detects project status histories, multi-source project observations, contractor project portfolios, and election/project jurisdiction-year intersections. Intersections are labeled `INFERENCE_LEAD`; the engine does not infer causation, misconduct, or political relationships.

Run the engine after the provenance database is initialized and populated:

```bash
npm run correlate
```

Use `BANTAYLINK_MAX_FINDINGS` to bound a run for testing.

## Source ingestion

After PostgreSQL is provisioned and `DATABASE_URL` is configured:

```bash
node scripts/init-db.mjs
BANTAYLINK_MAX_RECORDS=100 node scripts/ingest-source.mjs openhalalan-winners
BANTAYLINK_MAX_RECORDS=100 node scripts/ingest-source.mjs dpwh-transparency
```

For the research sources:

```bash
SIDLAN_API_KEY=... BANTAYLINK_MAX_RECORDS=100 node scripts/ingest-source.mjs da-sidlan
COA_ELIBRARY_URLS="https://elibrary.coa.gov.ph/resource/view/..." node scripts/ingest-source.mjs coa-elibrary
PHILGEPS_OPEN_DATA_URLS="https://open.philgeps.gov.ph/..." node scripts/ingest-source.mjs philgeps
```

OpenHalalan resolves and records the exact repository commit used for an ingestion run. Large vote-count ingestion is stream-parsed; use `BANTAYLINK_MAX_RECORDS` for bounded tests.

DPWH Transparency requests the public project API directly and does not attempt to bypass bot protection or rate limits.
