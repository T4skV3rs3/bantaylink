import assert from "node:assert/strict";
import { runCorrelation, CORRELATION_ENGINE_VERSION } from "../src/correlation/engine.js";
import { MemoryStore } from "../src/db/memory.js";

function entity(id, entityType, canonicalKey, data = {}, label = canonicalKey) {
  return { id, entityType, canonicalKey, data, label };
}

function observation(id, entityId, sourceId, recordType, sourceRecordId, observedAt, data, contentHash) {
  return {
    id,
    entityId,
    sourceId,
    ingestionRunId: "test-run",
    rawDocumentId: "raw-" + id,
    recordType,
    sourceRecordId,
    observedAt,
    contentHash,
    data
  };
}

const project = entity("project-1", "project", "dpwh-contract:TEST001", {
  contractId: "TEST001",
  description: "Test Road",
  contractor: "Example Builders, Inc. (34698)",
  pcabId: "34698",
  infraYear: "2025",
  startDate: "2025-01-10",
  location: {
    city: "Test City",
    municipality: "Test City",
    province: "Test Province",
    region: "Region Test"
  },
  status: "Suspended",
  progress: 50
}, "TEST001 — Test Road");

const project2 = entity("project-2", "project", "dpwh-contract:TEST002", {
  contractId: "TEST002",
  description: "Test Bridge",
  contractor: "Example Builders, Inc. (34698)",
  pcabId: "34698",
  infraYear: "2025",
  location: {
    city: "Other City",
    province: "Other Province",
    region: "Region Test"
  },
  status: "Ongoing",
  progress: 20
}, "TEST002 — Test Bridge");

const election = entity(
  "election-1",
  "election_result",
  "openhalalan-winner|2025|MAYOR|REGION TEST|TEST PROVINCE|TEST CITY|DOE, JOHN",
  {
    dataset: "NLE_Winners_2004-2025",
    fullName: "DOE, JOHN",
    position: "MAYOR",
    year: 2025,
    city: "Test City",
    province: "Test Province",
    region: "Region Test"
  },
  "DOE, JOHN — MAYOR"
);

const vote = entity(
  "vote-1",
  "election_result",
  "openhalalan-vote|2025|MAYOR|REGION TEST|TEST PROVINCE|TEST CITY|DOE, JOHN",
  {
    dataset: "NLE_Vote_Counts_2007-2025",
    candidateName: "DOE, JOHN",
    position: "MAYOR",
    year: 2025,
    city: "Test City",
    province: "Test Province",
    region: "Region Test"
  },
  "DOE, JOHN — MAYOR vote"
);

const observations = [
  observation("obs-p1-a", "project-1", "dpwh", "project", "TEST001", "2025-03-01T00:00:00Z", {
    ...project.data,
    status: "Suspended",
    progress: 50
  }, "hash-p1-a"),
  observation("obs-p1-b", "project-1", "dpwh", "project", "TEST001", "2025-08-01T00:00:00Z", {
    ...project.data,
    status: "Ongoing",
    progress: 80
  }, "hash-p1-b"),
  observation("obs-p1-c", "project-1", "foi", "project", "TEST001", "2025-08-05T00:00:00Z", {
    ...project.data,
    status: "Ongoing",
    progress: 80
  }, "hash-p1-c"),
  observation("obs-p2-a", "project-2", "dpwh", "project", "TEST002", "2025-03-01T00:00:00Z", project2.data, "hash-p2-a"),
  observation("obs-e1", "election-1", "openhalalan", "election_result", "winner-1", "2025-06-01T00:00:00Z", election.data, "hash-e1"),
  observation("obs-v1", "vote-1", "openhalalan", "election_result", "vote-1", "2025-06-01T00:00:00Z", vote.data, "hash-v1")
];

const snapshot = {
  entities: [project, project2, election, vote],
  observations,
  edges: []
};

const first = runCorrelation({ snapshot });
const second = runCorrelation({ snapshot });

assert.equal(first.run.engineVersion, CORRELATION_ENGINE_VERSION);
assert.deepEqual(
  first.findings.map(finding => finding.fingerprint).sort(),
  second.findings.map(finding => finding.fingerprint).sort()
);

const types = new Set(first.findings.map(finding => finding.findingType));
assert(types.has("STATUS_HISTORY"));
assert(types.has("MULTI_SOURCE_PROJECT"));
assert(types.has("CONTRACTOR_PORTFOLIO"));
const contractorPortfolio = first.findings.find(finding => finding.findingType === "CONTRACTOR_PORTFOLIO");
assert.equal(contractorPortfolio.status, "VERIFIED_FACT");
assert.equal(contractorPortfolio.payload.contractorIdentityBasis, "pcab_id");
assert(types.has("ELECTION_PROJECT_OVERLAP"));
assert(types.has("ELECTION_PROJECT_CONTRACTOR_INTERSECTION"));

const overlaps = first.findings.filter(
  finding => finding.findingType === "ELECTION_PROJECT_OVERLAP"
);
assert.equal(overlaps.length, 1);

const overlap = overlaps[0];
assert.equal(overlap.status, "INFERENCE_LEAD");
assert.equal(overlap.payload.joinBasis, "city+election_year");
assert.match(overlap.payload.interpretationLimit, /do not establish/i);
assert.equal(overlap.payload.election.canonicalKey.includes("vote"), false);

const snapshotWithDifferentObservationIds = {
  ...snapshot,
  observations: observations.map(obs => ({
    ...obs,
    id: "other-" + obs.id
  }))
};
const third = runCorrelation({ snapshot: snapshotWithDifferentObservationIds });
assert.deepEqual(
  first.findings.map(finding => finding.fingerprint).sort(),
  third.findings.map(finding => finding.fingerprint).sort()
);

const store = new MemoryStore();
for (const item of [project, project2, election, vote]) {
  await store.upsertEntity(item);
}
for (const obs of observations) {
  await store.insertObservation(obs);
}

const persistedSnapshot = await store.getCorrelationSnapshot();
const persistedRun = runCorrelation({ snapshot: persistedSnapshot, maxFindings: 2 });
await store.startCorrelationRun({
  id: persistedRun.run.id,
  engineVersion: persistedRun.run.engineVersion
});
for (const finding of persistedRun.findings) {
  await store.insertCorrelationFinding(persistedRun.run.id, finding);
}
const stored = await store.completeCorrelationRun(persistedRun.run.id, {
  entityCount: persistedRun.run.entityCount,
  observationCount: persistedRun.run.observationCount,
  edgeCount: persistedRun.run.edgeCount,
  findingCount: persistedRun.findings.length,
  errors: []
});

assert.equal(store.correlationFindings.size, 2);
assert.equal(stored.findingCount, 2);

console.log("Correlation engine v0.5 tests passed.");
