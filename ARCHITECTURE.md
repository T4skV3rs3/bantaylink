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

`ingestion_runs` records every adapter execution, source version, counters, timestamps, and errors.

`raw_documents` preserves the retrieved payload plus retrieval metadata and a SHA-256 content hash.

`entities` stores canonical identities using `entity_type + canonical_key`. Entity data can be refreshed, but historical observations remain separate.

`observations` stores the normalized source-backed state of an entity. Each observation points to its source, ingestion run, raw document, source record ID, retrieval time, and content hash.

`edges` stores source-backed relationships between entities with the same provenance fields as observations.

This gives us an auditable chain:

`source → ingestion run → raw payload → normalized observation/edge → canonical entity`.

## Ingestion lifecycle

Every adapter follows this sequence:

1. Register the source and adapter metadata.
2. Start an `ingestion_run`.
3. Fetch raw records without discarding source-native identifiers.
4. Hash the raw payload deterministically.
5. Persist the raw document.
6. Normalize the record into canonical entities, observations, and edges.
7. Upsert canonical entities.
8. Insert observations/edges only when their content hash is new.
9. Complete the run with counters, or mark it failed with an error trail.

This makes repeated pulls idempotent at the observation/edge level while keeping the raw retrieval history available.

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
