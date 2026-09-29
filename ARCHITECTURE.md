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

## Product boundary

BantayLink is an investigative indexing and provenance tool. It does not determine criminality, corruption, legality, or causation on its own.
