import { randomUUID } from "node:crypto";
import { ENTITY_RESOLUTION_ENGINE_VERSION, resolveEntities } from "./rules.js";

export { ENTITY_RESOLUTION_ENGINE_VERSION };

function normalizeMaxCandidates(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(Math.floor(number), 0);
}

export function runEntityResolution({ snapshot, maxCandidates } = {}) {
  const result = resolveEntities(snapshot, {
    maxCandidates: normalizeMaxCandidates(maxCandidates) ?? 25000
  });

  const autoConfirmed = result.candidates.filter(item => item.status === "AUTO_CONFIRMED").length;
  const reviewRequired = result.candidates.filter(item => item.status === "REVIEW_REQUIRED").length;
  const conflicts = result.candidates.filter(item => item.status === "CONFLICT").length;

  return {
    run: {
      id: randomUUID(),
      engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      entityCount: snapshot.entities.length,
      candidateCount: result.candidates.length,
      autoConfirmedCount: autoConfirmed,
      reviewRequiredCount: reviewRequired,
      conflictCount: conflicts,
      errors: []
    },
    candidates: result.candidates
  };
}

export async function executeEntityResolutionRun({ store, maxCandidates } = {}) {
  if (!store?.getEntityResolutionSnapshot ||
      !store?.startEntityResolutionRun ||
      !store?.insertEntityResolutionCandidate ||
      !store?.insertEntityResolutionAssertion ||
      !store?.completeEntityResolutionRun ||
      !store?.failEntityResolutionRun) {
    throw new Error("Entity-resolution store is missing required run/candidate methods.");
  }

  const snapshot = await store.getEntityResolutionSnapshot();
  const runId = randomUUID();

  await store.startEntityResolutionRun({
    id: runId,
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION
  });

  try {
    const result = runEntityResolution({ snapshot, maxCandidates });

    for (const item of result.candidates) {
      await store.insertEntityResolutionCandidate(runId, item);

      if (item.status === "AUTO_CONFIRMED") {
        await store.insertEntityResolutionAssertion({
          id: runId + ":assertion:" + item.fingerprint,
          sourceEntityId: item.sourceEntityId,
          canonicalEntityId: item.candidateEntityId,
          assertionType: "AUTO_CONFIRMED",
          resolutionRunId: runId,
          evidenceObservationIds: item.evidenceObservationIds,
          evidenceEdgeIds: item.evidenceEdgeIds,
          basis: {
            matchMethod: item.matchMethod,
            rationale: item.rationale,
            fingerprint: item.fingerprint
          }
        });
      }
    }

    return await store.completeEntityResolutionRun(runId, {
      entityCount: result.run.entityCount,
      candidateCount: result.run.candidateCount,
      autoConfirmedCount: result.run.autoConfirmedCount,
      reviewRequiredCount: result.run.reviewRequiredCount,
      conflictCount: result.run.conflictCount,
      errors: []
    });
  } catch (error) {
    await store.failEntityResolutionRun(runId, error);
    throw error;
  }
}
