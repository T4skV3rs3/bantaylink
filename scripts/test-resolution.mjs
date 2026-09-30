import assert from "node:assert/strict";
import { runEntityResolution, ENTITY_RESOLUTION_ENGINE_VERSION } from "../src/resolution/engine.js";
import { MemoryStore } from "../src/db/memory.js";
import { executeEntityResolutionRun } from "../src/resolution/engine.js";

function entity(id, entityType, canonicalKey, data = {}) {
  return { id, entityType, canonicalKey, data, label: canonicalKey };
}

function observation(id, entityId, sourceId, recordType, sourceRecordId, data = {}) {
  return {
    id,
    entityId,
    sourceId,
    ingestionRunId: "run-1",
    rawDocumentId: "raw-" + id,
    recordType,
    sourceRecordId,
    observedAt: "2025-01-01T00:00:00Z",
    contentHash: "hash-" + id,
    data
  };
}

const e1 = entity("e1", "election_result", "oh-2022-a", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DEL ROSARIO, JUAN CARLOS",
  position: "MAYOR",
  year: 2022,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const e2 = entity("e2", "election_result", "oh-2025-a", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DEL ROSARIO, JUAN CARLOS",
  position: "MAYOR",
  year: 2025,
  city: "Test City",
  province: "Test Province",
  sex: "M"
});

const e3 = entity("e3", "election_result", "oh-2025-b", {
  dataset: "NLE_Winners_2004-2025",
  fullName: "DEL ROSARIO, JUAN CARLOS",
  position: "MAYOR",
  year: 2025,
  city: "Other City",
  province: "Other Province"
});

const p1 = entity("p1", "project", "dpwh:A", {
  contractId: "A",
  contractor: "Example Builders, Inc.",
  pcabId: "34698"
});

const p2 = entity("p2", "project", "dpwh:B", {
  contractId: "B",
  contractor: "Example Builders Incorporated",
  pcabId: "34698"
});

const procurement = entity("pr1", "procurement_event", "philgeps:ABC-123", {
  referenceNumber: "ABC-123",
  awardee: "Example Builders, Inc."
});

const snapshot = {
  entities: [e1, e2, e3, p1, p2, procurement],
  observations: [
    observation("o1", "e1", "openhalalan", "election_result", "oh-2022-a"),
    observation("o2", "e2", "openhalalan", "election_result", "oh-2025-a"),
    observation("o3", "e3", "openhalalan", "election_result", "oh-2025-b"),
    observation("o4", "p1", "dpwh", "project", "A"),
    observation("o5", "p2", "dpwh", "project", "B"),
    observation("o6", "pr1", "philgeps", "procurement_event", "ABC-123")
  ],
  edges: []
};

const result = runEntityResolution({ snapshot });
assert.equal(result.run.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);

const personCandidates = result.candidates.filter(candidate => candidate.payload.identityType === "person");
assert(personCandidates.length >= 1);
assert(personCandidates.every(candidate => candidate.status === "INFERENCE_LEAD"));
assert(personCandidates.some(candidate => candidate.basis === "exact_name_locality_position"));
assert(!personCandidates.some(candidate =>
  candidate.payload.left?.entityId === "e3" || candidate.payload.right?.entityId === "e3"
));

const identifierOrganizationCandidates = result.candidates.filter(candidate =>
  candidate.payload.identityType === "organization" &&
  candidate.status === "VERIFIED_FACT"
);
assert(identifierOrganizationCandidates.length >= 1);
assert.equal(result.resolvedEntities.length, 1);
assert.equal(result.resolvedEntities[0].canonicalKey, "resolved:pcab:34698");
assert.equal(result.resolvedEntities[0].resolutionStatus, "VERIFIED_BY_IDENTIFIER");

const store = new MemoryStore();
for (const item of snapshot.entities) await store.upsertEntity(item);
for (const item of snapshot.observations) await store.insertObservation(item);
const run = await executeEntityResolutionRun({ store });
assert.equal(run.status, "completed");
assert.equal(run.engineVersion, ENTITY_RESOLUTION_ENGINE_VERSION);
assert(store.resolutionIdentityRecords.size > 0);
assert(store.resolutionCandidates.size > 0);
assert(store.resolvedEntities.size === 1);

console.log("Entity resolution v1 tests passed.");
