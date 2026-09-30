import { fetchResponse, responseBodyToNodeStream, headersToObject, redactUrl } from "../ingestion/http.js";
import { fetchResponse, responseBodyToNodeStream } from "../ingestion/http.js";
import { sha256 } from "../ingestion/hash.js";

const REPO = "RobertRLeung/OpenHalalan";
const API = `https://api.github.com/repos/${REPO}/commits/`;
const RAW = `https://raw.githubusercontent.com/${REPO}/`;

const DATASETS = {
  winners: {
    id: "openhalalan-winners",
    name: "OpenHalalan Election Winners",
    path: "data/output/NLE_Winners_2004-2025.csv",
    sourceClass: "independent_dataset"
  },
  votes: {
    id: "openhalalan-votes",
    name: "OpenHalalan Vote Counts",
    path: "data/output/NLE_Vote_Counts_2007-2025.csv.gz",
    sourceClass: "independent_dataset"
  }
};

function isSha(ref) {
  return /^[0-9a-f]{40}$/i.test(ref);
}

async function resolveRef(ref) {
  if (isSha(ref)) return ref.toLowerCase();

  const response = await fetchResponse(`${API}${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  const payload = await response.json();
  if (!payload.sha) throw new Error("OpenHalalan commit response did not contain a SHA.");
  return payload.sha;
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

function booleanFromCsv(value, defaultValue = null) {
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return defaultValue;
}

function winnerCanonicalKey(row) {
  const locality = [
    row.Year,
    row.Position,
    row.Region,
    row.Province,
    row.City
  ].map(value => String(value ?? "").trim()).join("|");

  return [
    "openhalalan-winner",
    locality,
    row["Full Name"] ?? [
      row["Last Name"],
      row["First Name"],
      row["Middle Name"]
    ].filter(Boolean).join(", ")
  ].map(value => String(value ?? "").trim()).join("|");
}

function voteCanonicalKey(row) {
  return [
    "openhalalan-vote",
    row.year,
    row.position,
    row.region,
    row.province,
    row.city,
    row.candidate_name
  ].map(value => String(value ?? "").trim()).join("|");
}

export function normalizeWinner(row, contentHash) {
  const canonicalKey = winnerCanonicalKey(row);
  if (!row.Year || !row.Position || !row["Full Name"]) {
    throw new Error("OpenHalalan winner row is missing required identity fields.");
  }

  const data = {
    dataset: "NLE_Winners_2004-2025",
    personRecordKey: canonicalKey,
    lastName: stringOrNull(row["Last Name"]),
    firstName: stringOrNull(row["First Name"]),
    middleName: stringOrNull(row["Middle Name"]),
    title: stringOrNull(row.Title),
    fullName: row["Full Name"],
    position: row.Position,
    party: stringOrNull(row.Party),
    year: numberOrNull(row.Year),
    province: stringOrNull(row.Province),
    city: stringOrNull(row.City),
    region: stringOrNull(row.Region),
    sex: stringOrNull(row.Sex),
    middleNameSource: stringOrNull(row["Middle Name Source"]),
    sexSource: stringOrNull(row["Sex Source"])
  };

  return {
    entities: [{
      entityType: "election_result",
      canonicalKey,
      label: `${row["Full Name"]} — ${row.Position}`,
      data,
      observations: [{
        recordType: "election_result",
        sourceRecordId: canonicalKey,
        contentHash,
        data
      }]
    }]
  };
}

export function normalizeVote(row, contentHash) {
  const canonicalKey = voteCanonicalKey(row);
  if (!row.year || !row.position || !row.candidate_name) {
    throw new Error("OpenHalalan vote row is missing required identity fields.");
  }

  const data = {
    dataset: "NLE_Vote_Counts_2007-2025",
    candidateName: row.candidate_name,
    position: row.position,
    year: numberOrNull(row.year),
    region: stringOrNull(row.region),
    province: stringOrNull(row.province),
    city: stringOrNull(row.city),
    district: stringOrNull(row.district),
    rawPosition: stringOrNull(row.raw_position),
    party: stringOrNull(row.party),
    reportedParty: stringOrNull(row.reported_party),
    votes: numberOrNull(row.votes),
    percentage: numberOrNull(row.percentage),
    rank: numberOrNull(row.rank),
    isNationalRace: booleanFromCsv(row.is_national_race, false),
    isGeographic: booleanFromCsv(row.is_geographic, true),
    sex: stringOrNull(row.sex),
    sexSource: stringOrNull(row.sex_source)
  };

  return {
    entities: [{
      entityType: "election_result",
      canonicalKey,
      label: `${row.candidate_name} — ${row.position}`,
      data,
      observations: [{
        recordType: "election_result",
        sourceRecordId: canonicalKey,
        contentHash,
        data
      }]
    }]
  };
}

function buildAdapter(dataset) {
  const config = DATASETS[dataset];
  if (!config) throw new Error(`Unsupported OpenHalalan dataset: ${dataset}`);

  return {
    id: config.id,
    name: config.name,

    async getSource() {
      const ref = process.env.OPENHALALAN_REF || "main";
      const version = await resolveRef(ref);
      return {
        id: config.id,
        sourceKey: config.id,
        name: config.name,
        sourceClass: config.sourceClass,
        publisher: "OpenHalalan",
        canonicalUrl: `https://github.com/${REPO}/blob/${version}/${config.path}`,
        version
      };
    },

    async *fetch({ source, maxRecords } = {}) {
      const url = `${RAW}${source.version}/${config.path}`;
      const response = await fetchResponse(url, {
        headers: { Accept: "text/csv, application/octet-stream;q=0.9" }
      });
      const stream = responseBodyToNodeStream(response, { gzip: config.path.endsWith(".gz") });
      let yielded = 0;

      for await (const row of parseCsvStream(stream)) {
        if (maxRecords && yielded >= Number(maxRecords)) break;
        yield {
          payload: row,
          url,
          httpStatus: response.status,
          mimeType: config.path.endsWith(".gz") ? "application/gzip" : "text/csv",
          contentHash: sha256(row)
        };
        yielded += 1;
      }
    },

    normalize(record, { contentHash }) {
      return dataset === "winners"
        ? normalizeWinner(record, contentHash)
        : normalizeVote(record, contentHash);
    }
  };
}

export const openHalalanWinnersAdapter = buildAdapter("winners");
export const openHalalanVotesAdapter = buildAdapter("votes");
