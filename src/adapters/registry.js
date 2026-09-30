import { openHalalanVotesAdapter, openHalalanWinnersAdapter } from "./openhalalan.js";
import { dpwhProjectDetailAdapter, dpwhTransparencyAdapter } from "./dpwh.js";
import { dpwhEfoiAdapter } from "./dpwh-efoi.js";
import { daSidlanAdapter } from "./da-sidlan.js";
import { coaElibraryAdapter } from "./coa-elibrary.js";
import { philgepsAdapter } from "./philgeps.js";

export const ADAPTER_REGISTRY = [
  { id: openHalalanWinnersAdapter.id, name: openHalalanWinnersAdapter.name, kind: "independent_dataset", mode: "implemented", source: "https://github.com/RobertRLeung/OpenHalalan" },
  { id: openHalalanVotesAdapter.id, name: openHalalanVotesAdapter.name, kind: "independent_dataset", mode: "implemented", source: "https://github.com/RobertRLeung/OpenHalalan" },
  { id: dpwhTransparencyAdapter.id, name: dpwhTransparencyAdapter.name, kind: "government_finding", mode: "implemented", source: "https://transparency.dpwh.gov.ph/" },
  { id: dpwhProjectDetailAdapter.id, name: dpwhProjectDetailAdapter.name, kind: "government_finding", mode: "implemented", source: "https://transparency.dpwh.gov.ph/" },
  { id: dpwhEfoiAdapter.id, name: dpwhEfoiAdapter.name, kind: "official_document", mode: "implemented", source: "https://www.foi.gov.ph/agencies/dpwh/" },
  { id: daSidlanAdapter.id, name: daSidlanAdapter.name, kind: "government_finding", mode: "implemented", source: "https://sidlan.da.gov.ph/api/index" },
  { id: coaElibraryAdapter.id, name: coaElibraryAdapter.name, kind: "official_document", mode: "implemented", source: "https://elibrary.coa.gov.ph/" },
  { id: philgepsAdapter.id, name: philgepsAdapter.name, kind: "government_finding", mode: "implemented", source: "https://open.philgeps.gov.ph/analytics/" }
];

export function listAdapters() {
  return ADAPTER_REGISTRY.map(({ id, name, kind, mode, source }) => ({ id, name, kind, mode, source }));
}
