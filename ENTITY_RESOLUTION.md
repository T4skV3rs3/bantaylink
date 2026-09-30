# BantayLink entity resolution

## Purpose

Entity resolution converts repeated source records into explicit, reviewable identity relationships without silently overwriting source evidence.

The resolver produces three kinds of artifacts:

- identity records: the normalized identity profile extracted from each eligible source-backed entity;
- candidate matches: pairwise possible matches with a method, status, rationale, and evidence IDs;
- auto-confirmed clusters: connected components created only from typed stable-identifier matches.

The resolver does not create family relationships and does not infer political influence or causation.

## Identity domains

Source records are kept in separate identity domains:

- person — election-winner records and canonical person entities.
- organization — contractors and organizations, including cross-source contractor records.
- document — official/source-document records.
- project — infrastructure/project records.
- procurement_event — procurement records.

An identity domain prevents unrelated entity types from being merged simply because they contain the same identifier value.

## Stable identifiers

The engine can auto-confirm identity at the identifier level when a source supplies a typed identifier:

- project: contract_id or sp_id;
- procurement: procuring-entity + procurement reference;
- organizations: pcab_id, merchant ID, stable contractor/organization ID, or source organization ID;
- documents: document ID or tracking number;
- people: an explicitly supplied stable/source person ID.

A shared identifier is not a general-purpose truth claim. The UI exposes descriptive-field differences and the exact identifier namespace/value used for the match.

Source URLs alone are not treated as person/organization identity evidence.

## Person matching

Person names are normalized to reduce formatting noise, including honorifics and accents. Name variants are generated from full-name and structured first/middle/last fields.

Name-based matches are always REVIEW_REQUIRED:

- same normalized name + city/municipality + province;
- same normalized name + province;
- same normalized name + compatible office/time context.

A sex conflict blocks a name-based candidate. Same surname without a matching full-name variant never creates a person candidate.

OpenHalalan vote-count rows are excluded from person resolution because the dataset contains both winners and non-winners and serves a different evidentiary role.

The resolver does not infer kinship from names.

## Organization matching

Organizations and contractors can cross-resolve into the organization identity domain.

A shared typed organization identifier can produce AUTO_CONFIRMED.

A shared normalized organization name without a shared stable identifier produces REVIEW_REQUIRED.

A shared normalized organization name with conflicting values in the same typed identifier namespace produces CONFLICT.

## Project and procurement crosswalks

Project/project and project/procurement crosswalks are candidates rather than automatic merges.

The engine uses deterministic blocking by exact normalized title plus contextual blocks based on significant title tokens, jurisdiction, and year. Within a block it evaluates:

- title equality or high token similarity;
- city/municipality;
- province;
- region;
- overlapping project/procurement year;
- amount within 5% where both values are available.

The candidate must satisfy a strong title match plus contextual overlap. Each candidate records the exact context fields used.

Blocking prevents a full project-by-project cross product. The engine also records a comparison count and sets truncated=true when the candidate limit or block-comparison guard is reached.

## Identity records and clusters

Each eligible entity gets an identity record containing its identity domain, source record basis, normalized display name, locality key, typed external identifier when available, and evidence observation IDs.

Auto-confirmed identifier matches form deterministic connected components. A cluster has:

- a deterministic cluster key;
- a representative entity;
- all member entity IDs;
- identifier namespaces and match methods that support the component.

Membership assertions are written as immutable resolution assertions, each with supporting candidate fingerprints and evidence observation IDs.

The resolver never writes derived identity matches into the source-backed edges table.

## Status semantics

AUTO_CONFIRMED — used only for supported typed stable-identifier matches.

REVIEW_REQUIRED — used for name/context or project/procurement crosswalk candidates that require human evidence review.

CONFLICT — used when matching context is present but the same typed stable identifier namespace contains conflicting values.

REJECTED — reserved for persisted human decisions in the assertion layer; the automated engine does not currently invent rejection decisions.

## Evidence linkage

Every candidate and identity record references the source observations used to produce it. The evidence UI can follow those IDs to the original source and retrieval metadata.

Raw provenance remains append-only. The evidence API exposes safe retrieval metadata and hashes; it does not expose full raw document payloads by default.

## Running the resolver

After PostgreSQL is initialized and source data is ingested:

npm run resolve:entities

Optional bound:

BANTAYLINK_MAX_RESOLUTION_CANDIDATES=10000 npm run resolve:entities

The latest completed run is available through /api/entity-resolution.

## Deliberate limits

The resolver does not:

- infer family relationships;
- treat surname overlap as kinship;
- turn a name match into an identity assertion automatically;
- establish office tenure from election year alone;
- infer conflict of interest, favoritism, corruption, illegality, or causation;
- silently reconcile contradictory source records;
- treat a procurement crosswalk candidate as proof that two records describe the same project.

Those are separate evidence-resolution steps that can consume these outputs later.