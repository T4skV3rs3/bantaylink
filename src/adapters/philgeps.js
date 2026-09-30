import { fetchResponse } from "../ingestion/http.js";
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

  const data = {
    datasetUrl,
    eventType,
    referenceNumber: reference,
    title: stringOrNull(pick(record, ["Project Name", "Project Title", "Title", "Description", "Name"])),
    procuringEntity: stringOrNull(pick(record, ["Procuring Entity", "Organization", "Agency", "Buyer"])),
    procurementMode: stringOrNull(pick(record, ["Procurement Mode", "Mode of Procurement"])),
    classification: stringOrNull(pick(record, ["Classification", "Category"])),
    abc: numberOrNull(pick(record, ["Approved Budget for the Contract", "ABC", "Approved Budget"])),
    awardAmount: numberOrNull(pick(record, ["Award Amount", "Contract Amount", "Winning Bid", "Awarded Amount"])),
    awardee: stringOrNull(pick(record, ["Awardee", "Supplier", "Merchant", "Winning Bidder", "Supplier Name"])),
    postingDate: stringOrNull(pick(record, ["Posting Date", "Date Posted", "Published Date"])),
    awardDate: stringOrNull(pick(record, ["Award Date", "Date Awarded"])),
    status: stringOrNull(pick(record, ["Status", "Notice Status"])),
    rawRecord: record
  };

  return {
    entityType: "procurement_event",
    canonicalKey: `philgeps:${key}`,
    label: data.title || data.referenceNumber || `PhilGEPS ${eventType}`,
    data,
    observations: [{
      recordType: "procurement_event",
      sourceRecordId: reference || key,
      contentHash,
      data
    }]
  };
}

export function normalizePhilgepsRecord(record, contentHash, datasetUrl = null) {
  return { entities: [normalizeProcurementRecord(record, contentHash, datasetUrl)] };
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
  throw new Error(`PhilGEPS payload at ${url} is not a supported JSON/CSV dataset.`);
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
      const isJson = contentType.includes("json") || /\.json(?:$|[?#])/i.test(url);
      const body = isJson ? await response.json() : await response.text();
      const rows = rowsFromPayload(body, url);

      for (const row of rows) {
        if (limit != null && yielded >= limit) return;
        yield {
          payload: row,
          url,
          httpStatus: response.status,
          mimeType: contentType || (isJson ? "application/json" : "text/csv"),
          contentHash: sha256(row)
        };
        yielded += 1;
      }
    }
  },

  normalize(record, { contentHash, rawDocument }) {
    return normalizePhilgepsRecord(record, contentHash, rawDocument?.canonicalUrl ?? null);
  }
};
