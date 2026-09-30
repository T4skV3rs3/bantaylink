import { fetchResponse, headersToObject, redactUrl } from "../ingestion/http.js";
import { sha256 } from "../ingestion/hash.js";

const API_BASE = "https://sidlan.da.gov.ph/api/ibuild";

function envOr(name, fallback) {
  const value = process.env[name];
  return value == null || String(value).trim() === "" ? fallback : String(value).trim();
}

function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeSidlanIbuild(record, contentHash) {
  const spId = stringOrNull(record?.sp_id ?? record?.spId);
  if (!spId) throw new Error("DA SIDLAN I-BUILD record is missing sp_id.");

  const data = {
    datasetId: stringOrNull(record?.dataset_id ?? record?.datasetId) || envOr("SIDLAN_DATASET_ID", "ib-01-001"),
    spIndex: stringOrNull(record?.sp_index ?? record?.spIndex),
    timestamp: stringOrNull(record?.timestamp),
    spId,
    spName: stringOrNull(record?.sp_name ?? record?.spName),
    cluster: stringOrNull(record?.cluster),
    region: stringOrNull(record?.region),
    province: stringOrNull(record?.province),
    municipality: stringOrNull(record?.municipality),
    latitude: numberOrNull(record?.latitude),
    longitude: numberOrNull(record?.longitude),
    spType: stringOrNull(record?.sp_type ?? record?.spType),
    category: stringOrNull(record?.category),
    fundingSource: stringOrNull(record?.funding_source ?? record?.fundingSource),
    projectDescription: stringOrNull(record?.project_description ?? record?.projectDescription),
    developmentObjective: stringOrNull(record?.development_objective ?? record?.developmentObjective),
    indicativeCost: numberOrNull(record?.sp_indicative_cost),
    costDuringValidation: numberOrNull(record?.cost_during_validation),
    estimatedProjectCost: numberOrNull(record?.estimated_project_cost),
    rpabApprovedCost: numberOrNull(record?.rpab_approved_cost),
    nol1ApprovedCost: numberOrNull(record?.nol1_approved_cost),
    awardedCost: numberOrNull(record?.awarded_cost),
    dateValidated: stringOrNull(record?.date_validated),
    commodity: stringOrNull(record?.commodity),
    stage: stringOrNull(record?.stage),
    specificStatus: stringOrNull(record?.specific_status ?? record?.specificStatus),
    physicalProgress: numberOrNull(record?.Physical_Progress ?? record?.physical_progress ?? record?.physicalProgress),
    beneficiaryTotalHouseholds: numberOrNull(record?.beneficiary_total_hh),
    beneficiaryFarmerFisherHouseholds: numberOrNull(record?.beneficiary_total_ff_hh),
    beneficiaryMale: numberOrNull(record?.beneficiary_male),
    beneficiaryFemale: numberOrNull(record?.beneficiary_female),
    sourceRecord: record
  };

  return {
    entities: [{
      entityType: "project",
      canonicalKey: `da-sidlan:ibuild:${spId}`,
      label: data.spName ? `${spId} — ${data.spName}` : spId,
      data,
      observations: [{
        recordType: "project",
        sourceRecordId: spId,
        contentHash,
        data
      }]
    }]
  };
}

export const daSidlanAdapter = {
  id: "da-sidlan",
  name: "DA SIDLAN I-BUILD Infrastructure",

  source: {
    id: "da-sidlan",
    sourceKey: "da-sidlan-ibuild",
    name: "DA SIDLAN I-BUILD",
    sourceClass: "government_finding",
    publisher: "Department of Agriculture — Philippine Rural Development Project",
    canonicalUrl: "https://sidlan.da.gov.ph/api/index",
    version: "api-ibuild"
  },

  async *fetch({ maxRecords } = {}) {
    const apiKey = process.env.SIDLAN_API_KEY;
    if (!apiKey) {
      throw new Error("SIDLAN_API_KEY is required for da-sidlan.");
    }

    const datasetId = envOr("SIDLAN_DATASET_ID", "ib-01-001");
    const returnValues = envOr("SIDLAN_RETURN_VALUES", "json");
    const cluster = envOr("SIDLAN_CLUSTER", "all");
    const region = envOr("SIDLAN_REGION", "all");
    const province = envOr("SIDLAN_PROVINCE", "all");
    const groupStatus = envOr("SIDLAN_GROUP_STATUS", "all");

    if (!["json", "csv"].includes(returnValues)) {
      throw new Error("SIDLAN_RETURN_VALUES must be json or csv.");
    }

    const url = new URL(API_BASE);
    url.searchParams.set("dataset_id", datasetId);
    url.searchParams.set("return_values", returnValues);
    url.searchParams.set("cluster", cluster);
    url.searchParams.set("region", region);
    url.searchParams.set("province", province);
    url.searchParams.set("group_status", groupStatus);
    url.searchParams.set("api_key", apiKey);

    const response = await fetchResponse(url.toString(), {
      headers: {
        Accept: returnValues === "csv" ? "text/csv,application/octet-stream;q=0.9" : "application/json, text/plain, */*"
      }
    });

    if (returnValues === "csv") {
      throw new Error("SIDLAN csv output is documented but not enabled in the first ingestion cut; use SIDLAN_RETURN_VALUES=json.");
    }

    const payload = await response.json();
    const items = listItems(payload);
    const limit = maxRecords == null ? null : Math.max(Math.floor(Number(maxRecords)), 0);
    let yielded = 0;

    for (const item of items) {
      if (limit != null && yielded >= limit) return;
      yield {
        payload: item,
        url: url.toString(),
        httpStatus: response.status,
        mimeType: response.headers.get("content-type") || "application/json",
        contentHash: sha256(item)
      };
      yielded += 1;
    }
  },

  normalize(record, { contentHash }) {
    return normalizeSidlanIbuild(record, contentHash);
  }
};
