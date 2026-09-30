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

Detail adapter:
- `src/adapters/dpwh.js` also exposes `dpwh-project-details`.
- Set `DPWH_CONTRACT_IDS` to a comma-separated list of contract IDs.
- It calls `/projects/{contractId}` for those explicit IDs and retains detail fields such as bidders, procurement, links, components, coordinates, and image metadata.
- It is intentionally bounded to supplied IDs rather than crawling every contract detail endpoint.

The public API is currently subject to bot/rate-limit controls in some non-browser environments. The adapter fails loudly on non-2xx responses rather than attempting to bypass those controls. Use an approved first-party access path or wait for the source to permit the request.

## DPWH eFOI

Implemented as a document adapter: `src/adapters/dpwh-efoi.js`.

It fetches an explicit URL list rather than crawling the entire FOI site:
- Default: the existing DPWH project-status request used by the alpha seed.
- Override with comma-separated `DPWH_EFOI_URLS`.

The HTML response is preserved as the raw document; the normalized observation records the request URL, title, tracking number when present, and source-native request status. It does not infer project wrongdoing from an FOI response.

## DA SIDLAN

Implemented adapter: `src/adapters/da-sidlan.js`.

The adapter targets the documented SIDLAN I-BUILD dataset endpoint. It supports filters for:
- `SIDLAN_DATASET_ID` (default `ib-01-001`)
- `SIDLAN_CLUSTER` (default `all`)
- `SIDLAN_REGION` (default `all`)
- `SIDLAN_PROVINCE` (default `all`)
- `SIDLAN_GROUP_STATUS` (default `all`)

It requires `SIDLAN_API_KEY` server-side. JSON and streamed CSV outputs are supported. CSV is parsed incrementally so bounded runs do not require loading the entire dataset into memory. The API key is never emitted into the stored retrieval URL; credential-like query parameters are redacted.

## COA eLibrary

Implemented adapter: `src/adapters/coa-elibrary.js`.

It ingests explicitly configured eLibrary resource/search URLs from `COA_ELIBRARY_URLS`. The HTML is retained as raw evidence and normalized into official-document source entities with document metadata. It intentionally does not crawl the eLibrary or infer audit findings from titles/categories.

## PhilGEPS

Implemented adapter: `src/adapters/philgeps.js`.

It ingests explicitly configured machine-readable Open Data URLs through `PHILGEPS_OPEN_DATA_URLS`. JSON and CSV are supported. Each row becomes a source-backed `procurement_event` with common fields such as reference number, procuring entity, procurement mode, ABC, award amount, awardee, dates, and source-row payload.

It does not scrape authenticated endpoints and does not infer contractor/political relationships from a procurement row.
