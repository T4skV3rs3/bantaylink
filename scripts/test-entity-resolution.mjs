import assert from "node:assert/strict";
import {
  runEntityResolution,
  executeEntityResolutionRun,
  ENTITY_RESOLUTION_ENGINE_VERSION
} from "../src/entity-resolution/engine.js";
import { normalizeName, normalizeOrganizationName } from "../src/entity-resolution/rules.js";
import { MemoryStore } from "../src/db/memory.js";

function entity(id, entityType, canonicalKey, data = {}, label = canonicalKey) {
  return { id, entityType, canonicalKey, data, label };
}

function observation(id, entityId, sourceId, recordType, data) {
  return {
    id,
    entityId,
    sourceId,
    ingestionRunId: "test-run",
    rawDocumentId: "raw-" + id,
    recordType,
    sourceRecordId: id,
    observedAt: "2025-01-01T00:00:00Z",
    contentHash: "hash-" + id,
    data
  };
}

const electionA = entity("e1", "election_result", "winner|2025|MAYOR|TEST CITY|DOE JOHN", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  firstName: "John",
  lastName: "Doe",
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province",
  sex: "M"
}, "DOE, JOHN — MAYOR");

const electionB = entity("e2", "election_result", "winner|2022|MAYOR|TEST CITY|DOE JOHN", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "JOHN DOE",
  firstName: "John",
  lastName: "Doe",
  position: "MAYOR",
  year: 2022,
  city: "Test City",
  province: "Test Province",
  sex: "M"
}, "JOHN DOE — MAYOR");

const electionDifferentSex = entity("e3", "election_result", "winner|2021|MAYOR|TEST CITY|DOE JOHN|F", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  firstName: "John",
  lastName: "Doe",
  position: "MAYOR",
  year: 2021,
  city: "Test City",
  province: "Test Province",
  sex: "F"
}, "DOE, JOHN — MAYOR");

const surnameOnly = entity("e4", "election_result", "winner|2025|MAYOR|TEST CITY|DOE JANE", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JANE",
  firstName: "Jane",
  lastName: "Doe",
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province",
  sex: "F"
}, "DOE, JANE — MAYOR");

const voteRow = entity("vote", "election_result", "vote|2025|MAYOR|TEST CITY|DOE JOHN", {
  dataset: "NLE_Vote_Counts_2007-2025",
  candidateName: "DOE, JOHN",
  year: 2025,
  position: "MAYOR",
  city: "Test City",
  province: "Test Province"
}, "DOE, JOHN — vote row");

const contractorA = entity("c1", "contractor", "dpwh-contractor:34698", {
  pcabId: "34698",
  legalName: "Example Builders, Inc."
}, "Example Builders, Inc.");

const contractorB = entity("c2", "organization", "philgeps-organization:merchant_id:MER-9", {
  pcabId: "34698",
  legalName: "Example Builders Corporation",
  merchantId: "MER-9"
}, "Example Builders Corporation");

const contractorC = entity("c3", "organization", "other-source:pcab:34698", {
  pcabId: "34698",
  legalName: "Example Builders, Inc."
}, "Example Builders, Inc.");

const conflictingA = entity("o1", "organization", "org:a", {
  legalName: "Sample Infrastructure Corporation",
  sourceOrganizationId: "ORG-1"
}, "Sample Infrastructure Corporation");

const conflictingB = entity("o2", "organization", "org:b", {
  legalName: "Sample Infrastructure Corp.",
  sourceOrganizationId: "ORG-2"
}, "Sample Infrastructure Corp.");

const projectA = entity("p1", "project", "dpwh-contract:TEST001", {
  contractId: "TEST001",
  description: "Construction of Test City Road Improvement",
  infraYear: "2025",
  budget: 10000000,
  location: { city: "Test City", province: "Test Province", region: "Region Test" }
}, "TEST001 — Construction of Test City Road Improvement");

const projectB = entity("p2", "project", "da-sidlan:ibuild:IB-1", {
  spId: "IB-1",
  spName: "Construction of Test City Road Improvement",
  year: 2025,
  awardedCost: 9800000,
  municipality: "Test City",
  province: "Test Province",
  region: "Region Test"
}, "IB-1 — Construction of Test City Road Improvement");

const procurement = entity("proc-1", "procurement_event", "philgeps:REF-1", {
  referenceNumber: "REF-1",
  title: "Construction of Test City Road Improvement",
  procuringEntity: "Test LGU",
  awardAmount: 9900000,
  postingDate: "2025-02-01",
  awardDate: "2025-03-01",
  city: "Test City",
  province: "Test Province",
  region: "Region Test"
}, "REF-1 — Construction of Test City Road Improvement");

const sourceA = entity("s1", "source", "doc:a", {
  documentId: "DOC-123",
  url: "https://example.invalid/a"
}, "Document A");

const sourceB = entity("s2", "source", "doc:b", {
  documentId: "DOC-123",
  url: "https://example.invalid/b"
}, "Document B");

const snapshot = {
  entities: [
    electionA, electionB, electionDifferentSex, surnameOnly, voteRow,
    contractorA, contractorB, contractorC,
    conflictingA, conflictingB,
    projectA, projectB, procurement,
    sourceA, sourceB
  ],
  observations: [
    observation("oe1", "e1", "openhalalan", "election_result", electionA.data),
    observation("oe2", "e2", "openhalalan", "election_result", electionB.data),
    observation("oe3", "e3", "openhalalan", "election_result", electionDifferentSex.data),
    observation("oe4", "e4", "openhalalan", "election_result", surnameOnly.data),
    observation("ov", "vote", "openhalalan", "election_result", voteRow.data),
    observation("oc1", "c1", "dpwh", "contractor", contractorA.data),
    observation("oc2", "c2", "philgeps", "organization", contractorB.data),
    observation("oc3", "c3", "other", "organization", contractorC.data),
    observation("oo1", "o1", "other", "organization", conflictingA.data),
    observation("oo2", "o2", "other", "organization", conflictingB.data),
    observation("op1", "p1", "dpwh", "project", projectA.data),
    observation("op2", "p2", "sidlan", "project", projectB.data),
    observation("opr", "proc-1", "philgeps", "procurement_event", procurement.data),
    observation("os1", "s1", "coa", "official_document", sourceA.data),
    observation("os2", "s2", "coa", "official_document", sourceB.data)
  ],
  edges: []
};

assert.equal(normalizeName("HON. Doe, John Jr."), "DOE JOHN JR");
assert.equal(normalizeOrganizationName("Example Builders, Inc."), "EXAMPLE BUILDERS");

const first = runEntityResolution({ snapshot, maxCandidates: 5000 });
const second = runEntityResolution({ snapshot, maxCandidates: 5000 });

assert.equal(first.run.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert.deepEqual(
  first.candidates.map(item => item.fingerprint).sort(),
  second.candidates.map(item => item.fingerprint).sort()
);
assert.equal(first.run.truncated, false);

const personCandidate = first.candidates.find(item =>
  item.matchMethod === "name_locality_candidate" &&
  item.sourceEntityId === "e1" &&
  item.candidateEntityId === "e2"
);
assert(personCandidate);
assert.equal(personCandidate.status, "REVIEW_REQUIRED");
assert.match(personCandidate.rationale, /does not establish/i);

assert(!first.candidates.some(item =>
  item.sourceEntityId === "e1" && item.candidateEntityId === "vote"
), "Vote-count rows must not participate in person resolution.");

assert(!first.candidates.some(item =>
  item.sourceEntityId === "e1" && item.candidateEntityId === "e3"
), "Sex conflicts should block a person candidate.");

assert(!first.candidates.some(item =>
  item.sourceEntityId === "e1" && item.candidateEntityId === "e4"
), "Surname-only overlap must not produce a person candidate.");

const crossTypeStable = first.candidates.find(item =>
  item.matchMethod === "pcab_id" &&
  item.sourceEntityId === "c1" &&
  item.candidateEntityId === "c2"
);
assert(crossTypeStable);
assert.equal(crossTypeStable.status, "AUTO_CONFIRMED");
assert.equal(crossTypeStable.entityType, "organization");

const cluster = first.clusters.find(item => item.entityType === "organization" && item.memberEntityIds.includes("c1"));
assert(cluster);
assert.equal(cluster.memberEntityIds.length, 3);
assert.equal(cluster.status, "AUTO_CONFIRMED");

const conflict = first.candidates.find(item =>
  item.matchMethod === "organization_name_conflicting_identifier" &&
  item.sourceEntityId === "o1" &&
  item.candidateEntityId === "o2"
);
assert(conflict);
assert.equal(conflict.status, "CONFLICT");

const projectCrosswalk = first.candidates.find(item =>
  item.matchMethod === "project_context_candidate" &&
  item.sourceEntityId === "p1" &&
  item.candidateEntityId === "p2"
);
assert(projectCrosswalk);
assert.equal(projectCrosswalk.status, "REVIEW_REQUIRED");

const procurementCrosswalk = first.candidates.find(item =>
  item.matchMethod === "project_procurement_context_candidate" &&
  item.sourceEntityId === "p1" &&
  item.candidateEntityId === "proc-1"
);
assert(procurementCrosswalk);
assert.equal(procurementCrosswalk.status, "REVIEW_REQUIRED");

const docMatch = first.candidates.find(item =>
  item.matchMethod === "document_id" &&
  item.sourceEntityId === "s1" &&
  item.candidateEntityId === "s2"
);
assert(docMatch);
assert.equal(docMatch.status, "AUTO_CONFIRMED");

const changedObservationSnapshot = {
  ...snapshot,
  observations: snapshot.observations.map(item => ({ ...item, id: "changed-" + item.id }))
};
const changed = runEntityResolution({ snapshot: changedObservationSnapshot, maxCandidates: 5000 });
assert.deepEqual(
  first.candidates.map(item => item.fingerprint).sort(),
  changed.candidates.map(item => item.fingerprint).sort()
);

const limited = runEntityResolution({ snapshot, maxCandidates: 1 });
assert.equal(limited.run.truncated, true);

const store = new MemoryStore();
for (const item of snapshot.entities) await store.upsertEntity(item);
for (const item of snapshot.observations) await store.insertObservation(item);

const persisted = await executeEntityResolutionRun({ store, maxCandidates: 5000 });
assert.equal(persisted.status, "completed");
assert.equal(persisted.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert.equal(persisted.identityRecordCount, first.run.identityRecordCount);
assert.equal(persisted.candidateCount, first.candidates.length);
assert.equal(store.entityResolutionIdentityRecords.size, first.run.identityRecordCount);
assert.equal(store.entityResolutionClusters.size, first.clusters.length);
assert.equal(store.entityResolutionAssertions.length, first.clusters.reduce((sum, item) => sum + item.memberEntityIds.length - 1, 0));

console.log("Entity-resolution engine v1.3 tests passed.");
