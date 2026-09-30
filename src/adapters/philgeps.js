import { fetchResponse, headersToObject } from "../ingestion/http.js";
import { parseCsv } from "../ingestion/csv.js";
import { sha256 } from "../ingestion/hash.js";

const DEFAULT_URLS = [];

function configuredUrls() {
  const value = process.env.PHILGEPS_OPEN_DATA_URLS;
  if (!value) return DEFAULT_URLS;
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/[₱$]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(record, names) {
  for (const name of names) {
    if (record[name] != null && String(record[name]).trim() !== "") return record[name];
  }
  return null;
}

function normalizeOrganizationName(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(INCORPORATED|CORPORATION|COMPANY|LIMITED|HOLDINGS|HOLDING)\b/g, " ")
    .replace(/\b(INC|CORP|CO|LTD|LLC|PLC)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectEventType(record) {
  const text = String(pick(record, ["Event Type", "Type", "Notice Type", "Procurement Stage"]) ?? "").toLowerCase();
  if (text.includes("award")) return "award";
  if (text.includes("contract")) return "contract";
  if (text.includes("notice")) return "bid_notice";
  return "procurement_record";
}

function normalizeProcurementRecord(record, contentHash, datasetUrl) {
  const reference = stringOrNull(pick(record, [
    "Notice Reference No.",
    "Notice Reference Number",
    "Reference Number",
    "Reference No.",
    "Notice ID",
    "Bid Notice No.",
    "Contract No.",
    "Contract ID",
    "Solicitation No."
  ]));

  const fallbackKey = sha256(record).slice(0, 32);
  const key = reference || fallbackKey;
  const eventType = detectEventType(record);
  const procuringEntity = stringOrNull(pick(record, ["Procuring Entity", "Organization", "Agency", "Buyer"]));
  const awardee = stringOrNull(pick(record, ["Awardee", "Supplier", "Merchant", "Winning Bidder", "Supplier Name"]));
  const merchantId = stringOrNull(pick(record, [
    "Merchant ID", "MerchantID", "Supplier ID", "Awardee ID", "Merchant Code", "Supplier Code"
  ]));
  const procuringEntityId = stringOrNull(pick(record, [
    "Procuring Entity ID", "Procuring Entity Code", "Organization ID", "Buyer ID", "PE ID"
  ]));

  const data = {
    datasetUrl,
    eventType,
    referenceNumber: reference,
    title: stringOrNull(pick(record, ["Project Name", "Project Title", "Title", "Description", "Name"])),
    procuringEntity,
    procuringEntityId,
    procurementMode: stringOrNull(pick(record, ["Procurement Mode", "Mode of Procurement"])),
    classification: stringOrNull(pick(record, ["Classification", "Category"])),
    abc: numberOrNull(pick(record, ["Approved Budget for the Contract", "ABC", "Approved Budget"])),
    awardAmount: numberOrNull(pick(record, ["Award Amount", "Contract Amount", "Winning Bid", "Awarded Amount"])),
    awardee,
    merchantId,
    postingDate: stringOrNull(pick(record, ["Posting Date", "Date Posted", "Published Date"])),
    awardDate: stringOrNull(pick(record, ["Award Date", "Date Awarded"])),
    status: stringOrNull(pick(record, ["Status", "Notice Status"])),
    region: stringOrNull(pick(record, ["Region"])),
    province: stringOrNull(pick(record, ["Province"])),
    municipality: stringOrNull(pick(record, ["Municipality", "City/Municipality", "City"])),
    city: stringOrNull(pick(record, ["City", "City/Municipality"])),
    district: stringOrNull(pick(record, ["District"]))
  };

  const sourceRecordId = reference || key;
  const eventKey = "philgeps:" + key;
  const eventLabel = data.title || data.referenceNumber || ("PhilGEPS " + eventType);
  const eventEntity = {
    entityType: "procurement_event",
    canonicalKey: eventKey,
    label: eventLabel,
    data,
    observations: [{
      recordType: "procurement_event",
      sourceRecordId,
      contentHash,
      data
    }]
  };

  const entities = [eventEntity];
  const edges = [];

  const organizationTargets = [
    {
      role: "awardee",
      name: awardee,
      id: merchantId,
      namespace: "merchant_id",
      edgeType: "awarded_to"
    },
    {
      role: "procuring_entity",
      name: procuringEntity,
      id: procuringEntityId,
      namespace: "source_organization_id",
      edgeType: "procured_by"
    }
  ];

  for (const target of organizationTargets) {
    if (!target.name) continue;
    const normalizedName = normalizeOrganizationName(target.name);
    if (!normalizedName) continue;

    const canonicalKey = target.id
      ? "philgeps-organization:" + target.namespace + ":" + target.id
      : "philgeps-organization:name:" + normalizedName;

    const organizationData = {
      legalName: target.name,
      name: target.name,
      merchantId: target.role === "awardee" ? target.id : null,
      sourceOrganizationId: target.role === "procuring_entity" ? target.id : null,
      identityBasis: target.id ? target.namespace : "normalized_name",
      roleObserved: target.role,
      sourceSystem: "PhilGEPS"
    };

    entities.push({
      entityType: "organization",
      canonicalKey,
      label: target.name,
      data: organizationData,
      observations: [{
        recordType: "organization",
        sourceRecordId: sourceRecordId + "::" + target.role,
        contentHash,
        data: organizationData
      }]
    });

    edges.push({
      from: {
        entityType: "procurement_event",
        canonicalKey: eventKey,
        label: eventLabel,
        data
      },
      to: {
        entityType: "organization",
        canonicalKey,
        label: target.name,
        data: organizationData
      },
      edgeType: target.edgeType,
      sourceRecordId: sourceRecordId + "::" + target.role,
      observedAt: data.awardDate || data.postingDate || undefined,
      contentHash,
      data: {
        role: target.role
      }
    });
  }

  return { entities, edges };
}

export function normalizePhilgepsRecord(record, contentHash, datasetUrl = null) {
  return normalizeProcurementRecord(record, contentHash, datasetUrl);
}

function rowsFromPayload(payload, url) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.items)) return payload.items;
  }
  if (typeof payload === "string") {
    return parseCsv(payload);
  }
  throw new Error("PhilGEPS payload at " + url + " is not a supported JSON/CSV dataset.");
}

export const philgepsAdapter = {
  id: "philgeps",
  name: "PhilGEPS Open Data",

  source: {
    id: "philgeps",
    sourceKey: "philgeps-open-data",
    name: "PhilGEPS Open Data",
    sourceClass: "government_finding",
    publisher: "Procurement Service — Department of Budget and Management",
    canonicalUrl: "https://open.philgeps.gov.ph/analytics/",
    version: "explicit-dataset-url"
  },

  async *fetch({ maxRecords } = {}) {
    const urls = configuredUrls();
    if (!urls.length) {
      throw new Error("PHILGEPS_OPEN_DATA_URLS is required for philgeps; provide explicit machine-readable dataset URLs.");
    }

    const limit = maxRecords == null ? null : Math.max(Math.floor(Number(maxRecords)), 0);
    let yielded = 0;

    for (const url of urls) {
      const response = await fetchResponse(url, {
        headers: { Accept: "application/json, text/csv, application/octet-stream;q=0.9" }
      });
      const contentType = response.headers.get("content-type") || "";
      if (/\.xlsx(?:$|[?#])/i.test(url) || contentType.includes("spreadsheetml")) {
        throw new Error("PhilGEPS XLSX datasets are not enabled in this ingestion cut; provide a CSV or JSON Open Data export URL.");
      }
      const isJson = contentType.includes("json") || /\.json(?:$|[?#])/i.test(url);
      const body = isJson ? await response.json() : await response.text();
      const rows = rowsFromPayload(body, url);

      for (const row of rows) {
        if (limit != null && yielded >= limit) return;
        yield {
          payload: row,
          url,
          retrievalUrl: response.url,
          requestMethod: "GET",
          responseHeaders: headersToObject(response.headers),
          httpStatus: response.status,
          mimeType: contentType || (isJson ? "application/json" : "text/csv"),
          payloadEncoding: "utf-8",
          hashScope: "canonical_payload",
          contentHash: sha256(row)
        };
        yielded += 1;
      }
    }
  },

  normalize(record, { contentHash, rawDocument }) {
    return normalizePhilgepsRecord(record, contentHash, rawDocument?.retrievalUrl ?? null);
  }
};
