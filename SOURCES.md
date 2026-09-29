# BantayLink source notes

The alpha uses a small seed set, while the adapters now support provenance-preserving ingestion from OpenHalalan and DPWH. Every production record retains the source URL, retrieval date, source class, and source-native identifier.

## OpenHalalan

https://github.com/RobertRLeung/OpenHalalan

OpenHalalan publishes two independently usable datasets:
- Election Winners: one row per winning candidate per office across 2001–2025, with documented gaps and provenance.
- Vote Counts: candidate vote counts across 2007–2025, including winners and losers, with documented partial coverage for 2007, 2010, and 2013.

The adapter resolves the repository ref to an exact commit and stores that SHA in each ingestion run for reproducibility.

## DPWH Transparency Portal

https://transparency.dpwh.gov.ph/

Public API:
https://api.transparency.dpwh.gov.ph/projects

Contract-detail API:
https://api.transparency.dpwh.gov.ph/projects/{contractId}

The published project surface includes fields such as contract ID, description, category, status, budget, progress, contractor, dates, location, funding/program information, and additional monitoring/procurement fields on detailed records.

BantayLink keeps DPWH status and progress values source-native and stores the retrieved payload as raw evidence. Status-derived signal tags such as `suspended` or `terminated` are exact-label mappings, not conclusions about conduct.

## DPWH eFOI

https://www.foi.gov.ph/agencies/dpwh/

The eFOI site publishes agency requests and responses. BantayLink treats these as official documents/evidence. A successful eFOI response can corroborate a project field, but it is not treated as a substitute for the underlying DPWH project record.

## Existing alpha seed examples

https://www.foi.gov.ph/agencies/dpwh/status-of-listed-dpwh-project/

The official response reports that project IDs 24GF0034 and 24G00023 were listed as ongoing with 96.60% and 73.15% accomplishment, respectively, based on DPWH's PCMA website at the time of the response. These are retained as seed evidence, not as permanent current statuses.

https://www.foi.gov.ph/agencies/dpwh/project-status-clarification/

The prototype references this as a seed evidence URL; the adapter does not treat seed metadata alone as a verified current project status.

https://apps2.dpwh.gov.ph/infra_projects/default.aspx

The older PCMA infrastructure-project interface referenced by DPWH eFOI responses.

## DA SIDLAN

https://sidlan.da.gov.ph/api/index

The API documentation describes machine-readable infrastructure fields and an API-key requirement.

## COA

https://elibrary.coa.gov.ph/

https://www.coa.gov.ph/

Use official audit reports and issuances as evidence documents.

## PhilGEPS

https://ps-philgeps.gov.ph/

Use appropriate open/API procurement data when access is available.
