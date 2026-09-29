# Adapter registry

## OpenHalalan

Implemented adapters:
- `src/adapters/openhalalan.js`
- `openhalalan-winners` reads `data/output/NLE_Winners_2004-2025.csv`.
- `openhalalan-votes` reads `data/output/NLE_Vote_Counts_2007-2025.csv.gz`.

The adapter resolves `OPENHALALAN_REF` to an exact OpenHalalan commit (default: `main` -> resolved commit SHA) and then fetches the dataset from that pinned commit. The run stores the resolved SHA in `ingestion_runs.source_version`.

Rules:
- Preserve the source commit/version.
- Use a deterministic, source-scoped election-result key.
- Do not automatically merge identically named candidates into one real-world person.
- Keep historical gaps and source notes visible.
- Vote-count `rank` is preserved as reported; it is not treated as a vote standing.

## DPWH Transparency Portal

Implemented adapter: `src/adapters/dpwh.js`.

Endpoint:
`https://api.transparency.dpwh.gov.ph/projects?page={page}&limit={limit}`

The adapter requests paginated project records (max page size 5,000), preserves the source contract ID, normalizes the published project/status/progress/cost/location fields, and stores the full source payload as the raw document.

Controls:
- `DPWH_PAGE_LIMIT` (default 5000, capped at 5000)
- `DPWH_START_PAGE` (default 1)
- `DPWH_MAX_PAGES` (default 1000)
- `maxRecords` can be passed to the ingestion engine for bounded test runs.

The public API is currently subject to bot/rate-limit controls in some non-browser environments. The adapter fails loudly on non-2xx responses rather than attempting to bypass those controls. Use an approved first-party access path or wait for the source to permit the request.

## DPWH eFOI

Implemented as a document adapter: `src/adapters/dpwh-efoi.js`.

It fetches an explicit URL list rather than crawling the entire FOI site:
- Default: the existing DPWH project-status request used by the alpha seed.
- Override with comma-separated `DPWH_EFOI_URLS`.

The HTML response is preserved as the raw document; the normalized observation records the request URL, title, tracking number when present, and source-native request status. It does not infer project wrongdoing from an FOI response.

## DA SIDLAN

Purpose: consume documented infrastructure datasets such as I-BUILD records.

Target fields include project ID, location, coordinates, funding, estimated/awarded cost, physical progress, stage, and status.

Base: https://sidlan.da.gov.ph/api/index

An API key must be supplied server-side; never ship it in the static client.

## COA eLibrary

Purpose: index audit reports and official issuances.

Base: https://elibrary.coa.gov.ph/

## PhilGEPS

Purpose: normalize procurement events when suitable open/API access is available.

Base: https://ps-philgeps.gov.ph/

Do not scrape authenticated endpoints without an appropriate access path.
