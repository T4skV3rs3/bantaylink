import assert from "node:assert/strict";
import { executeCorrelationRun, runCorrelation, CORRELATION_ENGINE_VERSION } from "../src/correlation/engine.js";
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

const procurement = entity(
  "proc-1",
  "procurement_event",
  "philgeps:TEST001",
  {
    eventType: "award",
    referenceNumber: "TEST001",
    title: "Test Road Award",
    procuringEntity: "Test LGU",
    awardAmount: 900000,
    awardee: "Example Builders, Inc.",
    pcabId: "34698"
  },
  "TEST001 — Test Road Award"
);

const procurementConflict = entity(
  "proc-conflict",
  "procurement_event",
  "philgeps:TEST001-CONFLICT",
  {
    eventType: "award",
    referenceNumber: "TEST001",
    title: "Test Road Award Conflict Record",
    procuringEntity: "Test LGU",
    awardAmount: 900000,
    awardee: "Other Builders, Inc.",
    pcabId: "99999"
  },
  "TEST001 — Test Road Award Conflict Record"
);

const procurementNotice = entity(
  "proc-notice",
  "procurement_event",
  "philgeps:TEST001-NOTICE",
  {
    eventType: "bid_notice",
    referenceNumber: "TEST001",
    title: "Test Road Bid Notice",
    procuringEntity: "Test LGU"
  },
  "TEST001 — Test Road Bid Notice"
);

const procurementContractor = entity(
  "proc-contractor",
  "contractor",
  "contractor:pcab:34698",
  {
    pcabId: "34698",
    legalName: "Example Builders, Inc."
  },
  "Example Builders, Inc."
);

const procurementOrganization = entity(
  "proc-org",
  "organization",
  "organization:philgeps-name:TEST LGU",
  {
    legalName: "Test LGU"
  },
  "Test LGU"
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
  observation("obs-p1-d", "project-1", "coa", "project", "TEST001", "2025-08-06T00:00:00Z", {
    ...project.data,
    status: "Suspended",
    progress: 60
  }, "hash-p1-d"),
  observation("obs-p2-a", "project-2", "dpwh", "project", "TEST002", "2025-03-01T00:00:00Z", project2.data, "hash-p2-a"),
  observation("obs-e1", "election-1", "openhalalan", "election_result", "winner-1", "2025-06-01T00:00:00Z", election.data, "hash-e1"),
  observation("obs-v1", "vote-1", "openhalalan", "election_result", "vote-1", "2025-06-01T00:00:00Z", vote.data, "hash-v1"),
  observation("obs-proc", "proc-1", "philgeps", "procurement_event", "TEST001", "2025-02-01T00:00:00Z", procurement.data, "hash-proc"),
  observation("obs-proc-conflict", "proc-conflict", "philgeps", "procurement_event", "TEST001-CONFLICT", "2025-02-02T00:00:00Z", procurementConflict.data, "hash-proc-conflict"),
  observation("obs-proc-notice", "proc-notice", "philgeps", "procurement_event", "TEST001-NOTICE", "2025-02-03T00:00:00Z", procurementNotice.data, "hash-proc-notice"),
  observation("obs-proc-contractor", "proc-contractor", "philgeps", "contractor", "34698", "2025-02-01T00:00:00Z", procurementContractor.data, "hash-proc-contractor"),
  observation("obs-proc-org", "proc-org", "philgeps", "organization", "TEST-LGU", "2025-02-01T00:00:00Z", procurementOrganization.data, "hash-proc-org")
];

const snapshot = {
  entities: [project, project2, election, vote, procurement, procurementConflict, procurementNotice, procurementContractor, procurementOrganization],
  observations,
  edges: [
    {
      id: "edge-proc-award",
      fromEntityId: "proc-1",
      toEntityId: "proc-contractor",
      edgeType: "awarded_to",
      sourceId: "philgeps",
      ingestionRunId: "test-run",
      rawDocumentId: "raw-edge-proc-award",
      sourceRecordId: "TEST001::awardee",
      observedAt: "2025-02-01T00:00:00Z",
      contentHash: "hash-edge-proc-award",
      data: {}
    },
    {
      id: "edge-proc-org",
      fromEntityId: "proc-1",
      toEntityId: "proc-org",
      edgeType: "procured_by",
      sourceId: "philgeps",
      ingestionRunId: "test-run",
      rawDocumentId: "raw-edge-proc-org",
      sourceRecordId: "TEST001::procuring-entity",
      observedAt: "2025-02-01T00:00:00Z",
      contentHash: "hash-edge-proc-org",
      data: {}
    },
    {
      id: "edge-project-contractor",
      fromEntityId: "project-1",
      toEntityId: "proc-contractor",
      edgeType: "contracted_to",
      sourceId: "dpwh",
      ingestionRunId: "test-run",
      rawDocumentId: "raw-edge-project-contractor",
      sourceRecordId: "TEST001::contractor",
      observedAt: "2025-01-10T00:00:00Z",
      contentHash: "hash-edge-project-contractor",
      data: {}
    }
  ]
};

const first = runCorrelation({ snapshot });
const second = runCorrelation({ snapshot });

assert.equal(first.run.engineVersion, CORRELATION_ENGINE_VERSION);
assert.equal(CORRELATION_ENGINE_VERSION, "0.6.0");
assert.deepEqual(
  first.findings.map(finding => finding.fingerprint).sort(),
  second.findings.map(finding => finding.fingerprint).sort()
);

const types = new Set(first.findings.map(finding => finding.findingType));
assert(types.has("STATUS_HISTORY"));
assert(types.has("MULTI_SOURCE_PROJECT"));
assert(types.has("SOURCE_STATUS_DIVERGENCE"));
assert(types.has("PROJECT_PROCUREMENT_LINK"));
assert(types.has("PROJECT_PROCUREMENT_CONTRACTOR_CONFLICT"));
assert(types.has("CONTRACTOR_PORTFOLIO"));
const contractorPortfolio = first.findings.find(finding => finding.findingType === "CONTRACTOR_PORTFOLIO");
assert.equal(contractorPortfolio.status, "VERIFIED_FACT");
assert.equal(contractorPortfolio.payload.contractorIdentityBasis, "pcab_id");
assert(types.has("ELECTION_PROJECT_OVERLAP"));
assert(types.has("ELECTION_PROJECT_CONTRACTOR_INTERSECTION"));

const divergence = first.findings.find(finding =>
  finding.findingType === "SOURCE_STATUS_DIVERGENCE"
);
assert.equal(divergence.status, "VERIFIED_FACT");
assert.deepEqual(divergence.payload.differingFields.sort(), ["progress", "status"]);
assert.match(divergence.payload.interpretationLimit, /does not determine which source is correct/i);

const procurementLink = first.findings.find(finding =>
  finding.findingType === "PROJECT_PROCUREMENT_LINK"
);
assert(procurementLink);
assert.equal(procurementLink.status, "VERIFIED_FACT");
assert.equal(procurementLink.payload.joinBasis, "project.contractId=procurement.referenceNumber");
assert.equal(procurementLink.payload.contractId, "TEST001");
assert.equal(procurementLink.payload.pcabMatch, true);
assert.equal(procurementLink.payload.path[0].kind, "derived_join");
assert(procurementLink.payload.path.some(step =>
  step.kind === "source_edge" && step.edgeType === "awarded_to"
));

const procurementConflictFinding = first.findings.find(finding =>
  finding.findingType === "PROJECT_PROCUREMENT_CONTRACTOR_CONFLICT"
);
assert(procurementConflictFinding);
assert.equal(procurementConflictFinding.status, "VERIFIED_FACT");
assert.equal(procurementConflictFinding.payload.projectPcabId, "34698");
assert.equal(procurementConflictFinding.payload.procurementPcabId, "99999");

assert(!first.findings.some(finding =>
  finding.findingType === "PROJECT_PROCUREMENT_LINK" &&
  finding.relatedEntityIds.includes("proc-notice")
), "Bid notices must not be treated as project contract/award links.");

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

const stored = await executeCorrelationRun({
  store,
  maxFindings: 2
});

assert.equal(store.correlationFindings.size, 2);
assert.equal(stored.findingCount, 2);
assert.equal(stored.engineVersion, CORRELATION_ENGINE_VERSION);
assert.equal(stored.status, "completed");
assert.equal(stored.truncated, true);

console.log("Correlation engine v0.6 tests passed.");
