# BantayLink source notes

The alpha uses a small seed set, while the adapters now support provenance-preserving ingestion from OpenHalalan, DPWH, DA SIDLAN, COA eLibrary, and PhilGEPS Open Data. Every production record retains the source URL, retrieval date, source class, and source-native identifier.

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

The published project surface includes fields such as contract ID, description, category, status, budget, progress, contractor, dates, location, funding/program information, and additional monitoring/procurement fields on detailed records. BantayLink also supports explicit contract-detail retrieval for selected IDs, including bidder/procurement records, source links, components, coordinates, and image metadata.

BantayLink keeps DPWH status and progress values source-native and stores the retrieved payload as raw evidence. Status-derived signal tags such as `suspended` or `terminated` are exact-label mappings, not conclusions about conduct.

## DPWH eFOI

https://www.foi.gov.ph/agencies/dpwh/

The eFOI site publishes agency requests and responses. BantayLink treats these as official documents/evidence. A successful eFOI response can corroborate a project field, but it is not treated as a substitute for the underlying DPWH project record.

## DA SIDLAN

https://sidlan.da.gov.ph/api/index

The current SIDLAN API documentation exposes machine-readable JSON/CSV access to I-BUILD datasets and requires an API key. BantayLink targets the documented `ib-01-001` infrastructure subproject profile dataset by default and keeps the requested filter parameters in the retrieval URL.

## COA eLibrary

https://elibrary.coa.gov.ph/

COA eLibrary is a centralized repository with searchable categories including Annual Audit Reports, Compliance Audit Reports, Performance Audit Reports, Special Audit Reports, and other official issuances. BantayLink ingests only explicitly configured resource/search URLs so document provenance is deliberate rather than inferred by crawler discovery.

## PhilGEPS

https://open.philgeps.gov.ph/analytics/

The modernized PhilGEPS Open Data Portal exposes downloadable and machine-readable procurement information, including government agencies, merchants, bid notices and awards. BantayLink accepts explicit JSON/CSV dataset URLs and preserves each source row as a procurement observation rather than assuming every row is a contract.

