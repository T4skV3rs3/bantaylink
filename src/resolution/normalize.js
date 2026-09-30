function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,'’"]/g, " ")
    .replace(/\b(DR|ATTY|ATTORNEY|ENGR|ENGINEER|HON|HONORABLE|GOV|GOVERNOR|MAYOR|VICE MAYOR|CONG|CONGRESSMAN|CONGRESSWOMAN|REP)\b/g, " ")
    .replace(/\b(JR|SR|II|III|IV|V|VI)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlace(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(PROVINCE|CITY|MUNICIPALITY|MUNICIPAL)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePosition(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOrganizationName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LLC)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function personLocalityKey({ city, province } = {}) {
  const c = normalizePlace(city);
  const p = normalizePlace(province);
  return [c, p].filter(Boolean).join("::");
}

export function organizationIdentityKey({ name, pcabId } = {}) {
  const pcab = clean(pcabId);
  if (pcab) return { key: "pcab:" + pcab, basis: "pcab_id" };
  const normalized = normalizeOrganizationName(name);
  if (!normalized) return null;
  return { key: "name:" + normalized, basis: "normalized_organization_name" };
}
