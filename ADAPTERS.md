# Adapter registry

## OpenHalalan

Purpose: normalize election winners and candidate vote-count records.

Planned module: `src/adapters/openhalalan.js`

Rules:
- Preserve dataset version/commit.
- Preserve source row identifiers when available.
- Keep historical gaps visible rather than silently filling them.

## DPWH Transparency Portal

Purpose: normalize project and contract records.

Target fields include project/contract ID, description, implementing office, contractor, cost, accomplishment, dates, and source-native status.

Base: https://transparency.dpwh.gov.ph/

## DPWH eFOI

Purpose: attach official responses as evidence documents for project-status and project-information questions.

Base: https://www.foi.gov.ph/agencies/dpwh/

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
