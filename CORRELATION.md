# BantayLink correlation engine

## Version 0.5 scope

The correlation engine is a deterministic, derived layer over the provenance graph. It never rewrites source-backed observations or edges.

### Rules

`STATUS_HISTORY`

Detects a canonical project with multiple observations whose published status and/or progress differs. This is a verified statement about the records; it does not assert why the values differ.

`MULTI_SOURCE_PROJECT`

Detects a canonical project observed by multiple source records. The rule deliberately does not decide whether those sources are independent.

`CONTRACTOR_PORTFOLIO`

Groups projects only when a contractor identity key is available through a PCAB identifier or otherwise a normalized contractor name. This is a documented project portfolio pattern, not a political conclusion.

`ELECTION_PROJECT_OVERLAP`

Joins election-winner records to projects when the office level matches the project jurisdiction and the recorded project year matches the election year. Municipal offices join on city/municipality; provincial offices join on province.

This is an `INFERENCE_LEAD` because an election/jurisdiction overlap does not establish project control, participation, influence, favoritism, conflict of interest, or causation.

`ELECTION_PROJECT_CONTRACTOR_INTERSECTION`

Adds the named project contractor to the preceding intersection. It remains an `INFERENCE_LEAD` and explicitly limits the interpretation.

## Deliberate exclusions

The v0.5 engine does not:
- infer family relationships from names;
- merge people across election records;
- treat OpenHalalan vote-count rows as winner/person records for election/project joins;
- infer office tenure from election year alone;
- infer conflicts of interest, favoritism, corruption, illegality, or causation;
- persist derived findings as source-backed `edges`.

## Finding storage

Derived findings live in:
- `correlation_runs`
- `correlation_findings`

Each finding stores:
- correlation rule ID;
- engine version;
- deterministic fingerprint;
- status;
- subject and related entity IDs;
- evidence observation/edge IDs;
- explanatory payload.

Finding IDs are run-scoped. Fingerprints are deterministic from stable entity/source keys rather than volatile database row IDs, allowing repeat runs to be compared.

## Performance

The election/project join uses jurisdiction+year indexes rather than a full project-by-election cross product.

PostgreSQL correlation snapshots only load project entities and election-result entities other than the OpenHalalan vote-count dataset. Their relevant observations and connected source-backed edges are fetched with the entity IDs.

This avoids loading millions of vote-count rows into a v0.5 jurisdiction join.

## Version 1 direction

After additional source research and entity-resolution validation, v1 should add:
- explicit person identity-resolution records;
- documented family-relationship edges;
- office-tenure intervals;
- contractor legal-entity crosswalks;
- procurement-event entities;
- COA/FOI references attached to canonical projects;
- contradiction-aware source comparison;
- richer temporal intervals;
- explainable multi-hop paths;
- queryable finding filters;
- UI traceability from every finding to the underlying documents.

v1 should remain evidence-explanatory rather than turning the engine into a political judgment system.


## Read API

The read-only Vercel endpoint `/api/correlations` returns the latest completed correlation run and up to 250 findings. Optional query parameters:
- `limit`
- `rule`
- `status`

The endpoint is read-only and requires `DATABASE_URL`.
