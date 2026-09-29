import { fetchResponse } from "../ingestion/http.js";
import { sha256 } from "../ingestion/hash.js";

const API_BASE = "https://api.transparency.dpwh.gov.ph/projects";

function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractProject(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data
    : record;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function sourceSignal(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "terminated") return ["terminated"];
  if (normalized === "suspended") return ["suspended"];
  return [];
}

export function normalizeDpwhProject(record, contentHash) {
  const project = extractProject(record);
  const contractId = stringOrNull(project.contractId);
  if (!contractId) throw new Error("DPWH project record is missing contractId.");

  const data = {
    contractId,
    description: stringOrNull(project.description),
    category: stringOrNull(project.category),
    componentCategories: project.componentCategories ?? null,
    status: stringOrNull(project.status),
    budget: numberOrNull(project.budget),
    amountPaid: numberOrNull(project.amountPaid),
    progress: numberOrNull(project.progress),
    location: project.location ?? null,
    contractor: stringOrNull(project.contractor),
    implementingOffice: stringOrNull(project.implementingOffice ?? project.implementing_office),
    startDate: stringOrNull(project.startDate),
    completionDate: stringOrNull(project.completionDate),
    infraYear: stringOrNull(project.infraYear),
    contractEffectivityDate: stringOrNull(project.contractEffectivityDate),
    expiryDate: stringOrNull(project.expiryDate),
    programName: stringOrNull(project.programName),
    sourceOfFunds: stringOrNull(project.sourceOfFunds),
    isVerifiedByDpwh: project.isVerifiedByDpwh ?? null,
    isVerifiedByPublic: project.isVerifiedByPublic ?? null,
    isLive: project.isLive ?? null,
    livestreamUrl: stringOrNull(project.livestreamUrl),
    livestreamVideoId: stringOrNull(project.livestreamVideoId),
    latitude: numberOrNull(project.latitude ?? project.location?.coordinates?.latitude),
    longitude: numberOrNull(project.longitude ?? project.location?.coordinates?.longitude),
    signals: sourceSignal(project.status)
  };

  return {
    entities: [{
      entityType: "project",
      canonicalKey: `dpwh-contract:${contractId}`,
      label: project.description ? `${contractId} — ${project.description}` : contractId,
      data,
      observations: [{
        recordType: "project",
        sourceRecordId: contractId,
        contentHash,
        data
      }]
    }]
  };
}

export const dpwhTransparencyAdapter = {
  id: "dpwh-transparency",
  name: "DPWH Transparency Portal",

  source: {
    id: "dpwh-transparency",
    sourceKey: "dpwh-transparency-api",
    name: "DPWH Transparency Portal",
    sourceClass: "government_finding",
    publisher: "Department of Public Works and Highways",
    canonicalUrl: "https://transparency.dpwh.gov.ph/",
    version: "live-api"
  },

  async *fetch({ maxRecords } = {}) {
    const limit = Math.min(Math.max(Number(process.env.DPWH_PAGE_LIMIT || 5000), 1), 5000);
    const startPage = Math.max(Number(process.env.DPWH_START_PAGE || 1), 1);
    const maxPages = Math.max(Number(process.env.DPWH_MAX_PAGES || 1000), 1);
    let yielded = 0;

    for (let page = startPage; page < startPage + maxPages; page += 1) {
      const url = `${API_BASE}?page=${page}&limit=${limit}`;
      let response;
      try {
        response = await fetchResponse(url, {
          headers: {
            Origin: "https://transparency.dpwh.gov.ph",
            Referer: "https://transparency.dpwh.gov.ph/",
            Accept: "application/json, text/plain, */*"
          }
        });
      } catch (error) {
        throw new Error(`DPWH Transparency API fetch failed at page ${page}: ${error.message}`);
      }

      const payload = await response.json();
      const items = listItems(payload);
      if (!items.length) return;

      for (const item of items) {
        if (maxRecords && yielded >= Number(maxRecords)) return;
        const project = extractProject(item);
        yield {
          payload: project,
          url,
          mimeType: "application/json",
          contentHash: sha256(project)
        };
        yielded += 1;
      }

      if (items.length < limit) return;
    }
  },

  normalize(record, { contentHash }) {
    return normalizeDpwhProject(record, contentHash);
  }
};
