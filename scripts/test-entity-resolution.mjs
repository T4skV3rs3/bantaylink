import assert from "node:assert/strict";
import { runEntityResolution, executeEntityResolutionRun, ENTITY_RESOLUTION_ENGINE_VERSION } from "../src/entity-resolution/engine.js";
import { MemoryStore } from "../src/db/memory.js";

function entity(id, entityType, canonicalKey, data = {}, label = canonicalKey) {
  return { id, entityType, canonicalKey, data, label };
}

function observation(id, entityId, data, recordType = "election_result") {
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
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const electionB = entity("e2", "election_result", "winner|2022|DOE|TEST CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  position: "MAYOR",
  year: 2022,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const electionOther = entity("e3", "election_result", "winner|2025|DOE|OTHER CITY", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DOE, JOHN",
  position: "MAYOR",
  year: 2025,
  city: "Other City",
  province: "Other Province",
  sex: "M"
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
  entities: [electionA, electionB, electionOther, voteRow, contractorA, contractorB, project, sourceA, sourceB],
  observations: [
    observation("oe1", "e1", electionA.data),
    observation("oe2", "e2", electionB.data),
    observation("oe3", "e3", electionOther.data),
    observation("ov", "vote", voteRow.data),
    observation("oc1", "c1", contractorA.data, "contractor"),
    observation("oc2", "c2", contractorB.data, "contractor"),
    observation("os1", "s1", sourceA.data, "official_document"),
    observation("os2", "s2", sourceB.data, "official_document")
  ],
  edges: []
};

const first = runEntityResolution({ snapshot });
const second = runEntityResolution({ snapshot });

assert.equal(first.run.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert.deepEqual(
  first.candidates.map(item => item.fingerprint).sort(),
  second.candidates.map(item => item.fingerprint).sort()
);

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
), "Vote-count dataset must not participate in person resolution.");

const contractor = first.candidates.find(item =>
  item.matchMethod === "pcab_id" &&
  item.sourceEntityId === "c1" &&
  item.candidateEntityId === "c2"
);
assert(contractor);
assert.equal(contractor.status, "AUTO_CONFIRMED");

const document = first.candidates.find(item =>
  item.matchMethod === "document_id" &&
  item.sourceEntityId === "s1" &&
  item.candidateEntityId === "s2"
);
assert(document);
assert.equal(document.status, "AUTO_CONFIRMED");

const store = new MemoryStore();
for (const item of snapshot.entities) await store.upsertEntity(item);
for (const item of snapshot.observations) await store.insertObservation(item);
const persistedRun = await executeEntityResolutionRun({ store, maxCandidates: 100 });
if (persistedRun.status !== "completed") throw new Error("Persisted entity-resolution run did not complete.");
if (persistedRun.candidateCount !== first.candidates.length) throw new Error("Persisted candidate count mismatch.");
if (store.entityResolutionCandidates.size !== first.candidates.length) throw new Error("Persisted candidate count mismatch in store.");
if (store.entityResolutionAssertions.length !== first.candidates.filter(item => item.status === "AUTO_CONFIRMED").length) {
  throw new Error("Auto-confirmed assertions were not persisted.");
}

console.log("Entity-resolution engine v1.0 tests passed.");
