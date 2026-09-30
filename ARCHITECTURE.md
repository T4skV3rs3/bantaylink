# BantayLink data architecture

## Core entities

`Person`, `ElectionResult`, `FamilyRelationship`, `Project`, `ProcurementEvent`, `AuditFinding`, `Source`, and `Edge`.

## Evidence classes

- `government_finding`
- `official_document`
- `independent_dataset`
- `media_report`
- `inference_lead`

The UI should not collapse these into a single opaque confidence score.

## Provenance database

The database is append-oriented around source observations.

`sources` identifies the publisher/dataset and preserves its canonical URL and evidence class.

`ingestion_runs` records every adapter execution, resolved source version, counters, timestamps, and errors.

`raw_documents` preserves each retrieved payload plus canonical/retrieval URLs, request method, response headers, retrieval time, payload encoding, hash scope, and a SHA-256 content hash. Raw retrievals are retained across runs so repeat pulls remain auditable. Document adapters may supply raw response text so the hash can cover the exact body; row-oriented adapters use a canonical structured-payload hash.

`entities` stores canonical identities using `entity_type + canonical_key`. Entity data can be refreshed, but historical observations remain separate.

`observations` stores the normalized source-backed state of an entity. Each observation points to its source, original ingestion run, raw document, source record ID, observation time, and content hash. `observation_occurrences` records every later run/raw-document pair that saw the same immutable observation, so a deduplicated observation is not detached from repeat retrieval history.

`edges` stores source-backed relationships between entities with the same provenance fields as observations. `edge_occurrences` performs the same repeat-run traceability function for deduplicated source-backed edges.

This gives us an auditable chain:

`source → ingestion run → raw payload → normalized observation/edge → canonical entity`.

## Ingestion lifecycle

Every adapter follows this sequence:

1. Register the source and adapter metadata.
2. Start an `ingestion_run`.
3. Fetch raw records without discarding source-native identifiers.
4. Hash the payload deterministically (or use an adapter-supplied content hash).
5. Persist the raw document before normalization.
6. Normalize the record into canonical entities, observations, and source-backed edges.
7. Validate the normalized shape and upsert canonical entities.
8. Insert observations/edges only when their source-record key + content hash is new.
9. Record record-level normalization/persistence errors without discarding already captured raw evidence; strict mode can fail the run immediately.
10. Complete the run with counters, or mark it failed when the fetch/run itself cannot continue.

This makes repeated pulls idempotent at the observation/edge level while keeping raw retrieval history available. The error trail is bounded so a noisy source cannot create an unbounded run record.

## Correlation engine v0.6

Correlation is a derived layer over canonical entities, observations, and source-backed edges. Derived findings are stored separately in \`correlation_runs\` and \`correlation_findings\`; they are not inserted into \`edges\`, because \`edges\` require direct source provenance.

Version 0.6 rules:
- \`STATUS_HISTORY\`: a project has multiple observations with differing published status and/or progress.
- \`MULTI_SOURCE_PROJECT\`: a canonical project has observations from multiple source records. Source independence is not asserted by this rule.
- \`CONTRACTOR_PORTFOLIO\`: the same contractor identity key appears across multiple projects.
- \`ELECTION_PROJECT_OVERLAP\`: an election record and project share the applicable municipal/provincial jurisdiction and recorded year.
- \`ELECTION_PROJECT_CONTRACTOR_INTERSECTION\`: the preceding intersection plus a named contractor.

The last two are \`INFERENCE_LEAD\` findings. They do not establish a role in a project, favoritism, influence, conflict of interest, wrongdoing, or causation.

Finding fingerprints are deterministic from rule/version/entity keys rather than volatile database row IDs, so repeated runs can be compared. Correlation runs record whether a finding limit truncated the result set. Database finding IDs are run-scoped.

## Entity resolution

The entity-resolution layer is deterministic and derived. `src/entity-resolution/rules.js` generates only reviewable identity candidates from source-backed entities; `src/entity-resolution/engine.js` persists candidates, identifier-backed assertions, and deterministic identity clusters.

Resolution rules currently include:
- typed stable-identifier matching for source entities such as projects, contractors, procurement events, source documents, and person records when an explicit stable person identifier exists;
- conservative person-name matching using normalized name variants plus locality, province, or compatible office/time context, always classified as `REVIEW_REQUIRED`;
- contractor-name matching as `REVIEW_REQUIRED` when no stable identifier exists;
- conflicting contractor-name / PCAB pairs as `CONFLICT`;
- deterministic connected components for `AUTO_CONFIRMED` same-type identifier matches.

OpenHalalan vote-count entities are excluded from person identity resolution. Same-surname matching is never sufficient for a person merge or family relationship. Auto-confirmed assertions retain the candidate fingerprint and source observation/edge references, and the database prevents resolution candidate/assertion records from disappearing through source-entity deletion.

Identity clusters are derived topology over explicit identifier matches. They do not rewrite or replace source-backed entities.

## Evidence UI and trace API

`/api/entity/:id` (served by `api/entity.js`) exposes the selected entity, source-backed observations and edges, repeat-run occurrences, resolution candidates/assertions/clusters, and raw retrieval metadata. Raw payload content is returned only when `includeRaw=1` is supplied.

`/api/evidence` accepts an entity ID, canonical key, correlation finding ID, resolution candidate ID, observation IDs, and/or edge IDs and returns the complete evidence bundle behind that selection. The UI presents the evidence chain rather than collapsing it into a single score.

## Infrastructure signal taxonomy

- `terminated`
- `suspended`
- `negative_slippage`
- `procurement_change`
- `audit_observation`
- `disallowance_or_charge`
- `status_mismatch`

These signals are source-native research inputs, not automatic proof of wrongdoing.

## Correlation rules

A correlation lead should expose the exact join key, such as jurisdiction overlap, time overlap, office-holder tenure, procuring entity, contractor, or document cross-reference.

Family relationships require documented relationship evidence or corroboration. Same-surname matching is never sufficient by itself.

## Adapter contract

Adapters should expose:

- stable `id` and human-readable `name`
- source metadata and source class
- a paginatable/iterable raw `fetch()`
- a deterministic `normalize()` that returns canonical entities and source-backed edges
- source version or dataset revision whenever the source publishes one

Adapters must not silently invent missing fields or convert disputed/source-native labels into stronger conclusions.

## Runtime stores

- `src/db/memory.js` is used for deterministic CI ingestion tests.
- `src/db/postgres.js` is the production-compatible store for a Postgres `DATABASE_URL`.
- `db/schema.sql` is the canonical database schema.

## Product boundary

BantayLink is an investigative indexing and provenance tool. It does not determine criminality, corruption, legality, or causation on its own.


## Implemented source adapters

### OpenHalalan

Supports both published CSV datasets, resolves a ref to an exact commit, and fetches the pinned file. Candidate rows remain source-scoped election-result entities; identical names are not automatically merged into one real-world person.

### DPWH Transparency

Consumes the public project listing API page-by-page, preserves the source contract ID, and keeps status/progress/cost/location fields source-native. It does not perform Cloudflare/TLS/proxy evasion.

### DPWH eFOI

Ingests explicitly configured FOI response URLs as official documents. It does not infer wrongdoing or crawl the entire site.
