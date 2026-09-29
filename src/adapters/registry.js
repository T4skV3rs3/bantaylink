export const ADAPTER_REGISTRY = [
  { id: "openhalalan", name: "OpenHalalan", kind: "independent_dataset", mode: "planned", source: "https://github.com/RobertRLeung/OpenHalalan" },
  { id: "dpwh-transparency", name: "DPWH Transparency Portal", kind: "government_finding", mode: "planned", source: "https://transparency.dpwh.gov.ph/" },
  { id: "dpwh-efoi", name: "DPWH eFOI", kind: "official_document", mode: "planned", source: "https://www.foi.gov.ph/agencies/dpwh/" },
  { id: "da-sidlan", name: "DA SIDLAN", kind: "government_finding", mode: "documented_api", source: "https://sidlan.da.gov.ph/api/index" },
  { id: "coa-elibrary", name: "COA eLibrary", kind: "official_document", mode: "planned", source: "https://elibrary.coa.gov.ph/" },
  { id: "philgeps", name: "PhilGEPS", kind: "government_finding", mode: "planned", source: "https://ps-philgeps.gov.ph/" }
];

export function listAdapters() {
  return ADAPTER_REGISTRY.map(({ id, name, kind, mode, source }) => ({ id, name, kind, mode, source }));
}
