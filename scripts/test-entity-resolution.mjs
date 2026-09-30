import assert from "node:assert/strict";
import {
  runEntityResolution,
  executeEntityResolutionRun,
  ENTITY_RESOLUTION_ENGINE_VERSION
} from "../src/entity-resolution/engine.js";
import { resolveEntities } from "../src/entity-resolution/rules.js";
import { MemoryStore } from "../src/db/memory.js";

function entity(id, entityType, canonicalKey, data = {}, label = canonicalKey) {
  return { id, entityType, canonicalKey, data, label };
}

function observation(id, entityId, data, recordType) {
  return {
    id,
    entityId,
    sourceId: "test-source",
    ingestionRunId: "test-run",
    rawDocumentId: "raw-" + id,
    recordType,
    sourceRecordId: id,
    observedAt: "2025-01-01T00:00:00Z",
    contentHash: "hash-" + id,
    data
  };
}

const electionA = entity("e1", "election_result", "winner|2025|DOE|TEST CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  firstName: "JOHN",
  lastName: "DOE",
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const electionB = entity("e2", "election_result", "winner|2022|DOE|TEST CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "JOHN DOE",
  firstName: "JOHN",
  lastName: "DOE",
  position: "MAYOR",
  year: 2022,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const electionProvince = entity("e3", "election_result", "winner|2025|DOE|OTHER CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  position: "MAYOR",
  year: 2025,
  city: "Other City",
  province: "Test Province",
  sex: "M"
});

const surnameOnly = entity("e4", "election_result", "winner|2025|DOE|THIRD CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JANE",
  position: "MAYOR",
  year: 2025,
  city: "Third City",
  province: "Other Province",
  sex: "F"
});

const voteRow = entity("vote", "election_result", "vote|2025|DOE", {
  dataset: "NLE_Vote_Counts_2007-2025",
  fullName: "DOE, JOHN",
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province"
});

const contractorA = entity("c1", "contractor", "contractor:pcab:34698", {
  pcabId: "34698",
  legalName: "Example Builders, Inc."
});

const contractorB = entity("c2", "contractor", "contractor:pcab:34698:detail", {
  pcabId: "34698",
  legalName: "Example Builders, Inc. (same PCAB)"
});

const contractorC = entity("c3", "contractor", "contractor:pcab:34698:history", {
  pcabId: "34698",
  legalName: "Example Builders Incorporated"
});

const contractorConflict = entity("c4", "contractor", "contractor:pcab:99999", {
  pcabId: "99999",
  legalName: "Example Builders Inc"
});

const contractorNameOnlyA = entity("c5", "contractor", "contractor:name:a", {
  legalName: "Regional Builders Cooperative"
});

const contractorNameOnlyB = entity("c6", "contractor", "contractor:name:b", {
  legalName: "Regional Builders Cooperative"
});

const project = entity("p1", "project", "dpwh-contract:TEST001", {
  contractId: "TEST001"
});

const sourceA = entity("s1", "source", "doc:a", {
  documentId: "DOC-123",
  url: "https://example.invalid/a"
});

const sourceB = entity("s2", "source", "doc:b", {
  documentId: "DOC-123",
  url: "https://example.invalid/b"
});

const snapshot = {
  entities: [
    electionA,
    electionB,
    electionProvince,
    surnameOnly,
    voteRow,
    contractorA,
    contractorB,
    contractorC,
    contractorConflict,
    contractorNameOnlyA,
    contractorNameOnlyB,
    project,
    sourceA,
    sourceB
  ],
  observations: [
    observation("oe1", "e1", electionA.data, "election_result"),
    observation("oe2", "e2", electionB.data, "election_result"),
    observation("oe3", "e3", electionProvince.data, "election_result"),
    observation("oe4", "e4", surnameOnly.data, "election_result"),
    observation("ov", "vote", voteRow.data, "election_result"),
    observation("oc1", "c1", contractorA.data, "contractor"),
    observation("oc2", "c2", contractorB.data, "contractor"),
    observation("oc3", "c3", contractorC.data, "contractor"),
    observation("oc4", "c4", contractorConflict.data, "contractor"),
    observation("oc5", "c5", contractorNameOnlyA.data, "contractor"),
    observation("oc6", "c6", contractorNameOnlyB.data, "contractor"),
    observation("op1", "p1", project.data, "project"),
    observation("os1", "s1", sourceA.data, "official_document"),
    observation("os2", "s2", sourceB.data, "official_document")
  ],
  edges: []
};

const first = runEntityResolution({ snapshot });
const second = runEntityResolution({ snapshot });

assert.equal(first.run.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert.equal(ENTITY_RESOLUTION_ENGINE_VERSION, "1.1.0");

assert.deepEqual(
  first.candidates.map(item => item.fingerprint).sort(),
  second.candidates.map(item => item.fingerprint).sort()
);

const personPair = first.candidates.find(item =>
  item.matchMethod === "name_locality_candidate" &&
  new Set([item.sourceEntityId, item.candidateEntityId]).size === 2 &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("e1") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("e2")
);
assert(personPair);
assert.equal(personPair.status, "REVIEW_REQUIRED");
assert.match(personPair.rationale, /does not establish/i);
assert.equal(personPair.payload.sharedNameVariant, "JOHN DOE");

const provincePair = first.candidates.find(item =>
  item.matchMethod === "name_province_candidate" &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("e1") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("e3")
);
assert(provincePair);
assert.equal(provincePair.status, "REVIEW_REQUIRED");

assert(!first.candidates.some(item =>
  item.sourceEntityId === "e4" ||
  item.candidateEntityId === "e4"
), "Surname-only matching must not create an identity candidate.");

assert(!first.candidates.some(item =>
  item.sourceEntityId === "vote" ||
  item.candidateEntityId === "vote"
), "Vote-count dataset must not participate in person resolution.");

const contractorAuto = first.candidates.filter(item =>
  item.matchMethod === "pcab_id" &&
  item.status === "AUTO_CONFIRMED"
);
assert(contractorAuto.some(item =>
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c1") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c2")
));
assert(contractorAuto.some(item =>
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c2") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c3")
));

const contractorConflictCandidates = first.candidates.filter(item =>
  item.matchMethod === "contractor_name_conflicting_pcab"
);
assert(contractorConflictCandidates.length >= 1);
assert(contractorConflictCandidates.every(item => item.status === "CONFLICT"));

const nameOnlyContractor = first.candidates.find(item =>
  item.matchMethod === "normalized_contractor_name" &&
  item.status === "REVIEW_REQUIRED" &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c5") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("c6")
);
assert(nameOnlyContractor);

const document = first.candidates.find(item =>
  item.matchMethod === "document_id" &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("s1") &&
  new Set([item.sourceEntityId, item.candidateEntityId]).has("s2")
);
assert(document);
assert.equal(document.status, "AUTO_CONFIRMED");

assert(first.clusters.length >= 1);
const contractorCluster = first.clusters.find(cluster =>
  cluster.entityType === "contractor" &&
  cluster.memberEntityIds.includes("c1") &&
  cluster.memberEntityIds.includes("c2") &&
  cluster.memberEntityIds.includes("c3")
);
assert(contractorCluster);
assert.equal(contractorCluster.status, "AUTO_CONFIRMED");
assert.equal(contractorCluster.memberEntityIds.length, 3);

const store = new MemoryStore();
for (const item of snapshot.entities) await store.upsertEntity(item);
for (const item of snapshot.observations) await store.insertObservation(item);

const persistedRun = await executeEntityResolutionRun({ store, maxCandidates: 100 });
assert.equal(persistedRun.status, "completed");
assert.equal(persistedRun.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert.equal(persistedRun.candidateCount, first.candidates.length);
assert.equal(persistedRun.clusterCount, first.clusters.length);
assert.equal(store.entityResolutionCandidates.size, first.candidates.length);
assert.equal(
  store.entityResolutionAssertions.length,
  first.candidates.filter(item => item.status === "AUTO_CONFIRMED").length
);
assert.equal(store.entityResolutionClusters.size, first.clusters.length);

const reduced = resolveEntities(snapshot, { maxCandidates: 2 });
assert.equal(reduced.candidates.length, 2);

console.log("Entity-resolution engine v1.1 tests passed.");
