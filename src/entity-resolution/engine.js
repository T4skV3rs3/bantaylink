import { randomUUID } from "node:crypto";
import {
  ENTITY_RESOLUTION_ENGINE_VERSION,
  resolveEntities,
  buildAutoConfirmedClusters
} from "./rules.js";

export { ENTITY_RESOLUTION_ENGINE_VERSION };

function normalizeMaxCandidates(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(Math.floor(number), 0);
}

function candidateByFingerprint(candidates) {
  return new Map(candidates.map(item => [item.fingerprint, item]));
}

export function runEntityResolution({ snapshot, maxCandidates } = {}) {
  const result = resolveEntities(snapshot, {
    maxCandidates: normalizeMaxCandidates(maxCandidates) ?? 25000
  });

  const autoConfirmed = result.candidates.filter(item => item.status === "AUTO_CONFIRMED").length;
  const reviewRequired = result.candidates.filter(item => item.status === "REVIEW_REQUIRED").length;
  const conflicts = result.candidates.filter(item => item.status === "CONFLICT").length;
  const clusters = buildAutoConfirmedClusters(result.candidates, snapshot.entities);

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
      clusterCount: clusters.length,
      truncated: Boolean(result.truncated),
      errors: []
    },
    candidates: result.candidates,
    clusters
  };
}

export async function executeEntityResolutionRun({ store, maxCandidates } = {}) {
  if (!store?.getEntityResolutionSnapshot ||
      !store?.startEntityResolutionRun ||
      !store?.insertEntityResolutionCandidate ||
      !store?.insertEntityResolutionAssertion ||
      !store?.completeEntityResolutionRun ||
      !store?.failEntityResolutionRun ||
      !store?.insertEntityResolutionCluster) {
    throw new Error("Entity-resolution store is missing required run/cluster/assertion methods.");
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
    }

    const candidatesByFingerprint = candidateByFingerprint(result.candidates);
    for (const cluster of result.clusters) {
      await store.insertEntityResolutionCluster(runId, cluster);

      const evidenceObservationIds = [...new Set(
        cluster.basis.identityGroupKeys.flatMap(groupKey =>
          result.candidates
            .filter(item => item.identityGroupKey === groupKey && item.status === "AUTO_CONFIRMED")
            .flatMap(item => item.evidenceObservationIds)
        )
      )].sort();

      for (const memberEntityId of cluster.memberEntityIds) {
        if (memberEntityId === cluster.representativeEntityId) continue;

        const supportingCandidates = result.candidates.filter(item =>
          item.status === "AUTO_CONFIRMED" &&
          item.entityType === cluster.entityType &&
          cluster.memberEntityIds.includes(item.sourceEntityId) &&
          cluster.memberEntityIds.includes(item.candidateEntityId) &&
          (item.sourceEntityId === memberEntityId || item.candidateEntityId === memberEntityId)
        );

        const evidence = [...new Set(supportingCandidates.flatMap(item => item.evidenceObservationIds))].sort();
        const assertionId = runId + ":assertion:" + cluster.clusterKey + ":" + memberEntityId;

        await store.insertEntityResolutionAssertion({
          id: assertionId,
          sourceEntityId: memberEntityId,
          canonicalEntityId: cluster.representativeEntityId,
          assertionType: "AUTO_CONFIRMED",
          resolutionRunId: runId,
          identityGroupKey: cluster.clusterKey,
          evidenceObservationIds: evidence.length ? evidence : evidenceObservationIds,
          evidenceEdgeIds: [],
          basis: {
            identityType: cluster.entityType,
            clusterKey: cluster.clusterKey,
            representativeEntityId: cluster.representativeEntityId,
            supportingMatchMethods: [...new Set(supportingCandidates.map(item => item.matchMethod))].sort(),
            supportingFingerprints: supportingCandidates.map(item => item.fingerprint).sort(),
            transitiveResolution: true
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
      clusterCount: result.clusters.length,
      truncated: result.run.truncated,
      errors: []
    });
  } catch (error) {
    await store.failEntityResolutionRun(runId, error);
    throw error;
  }
}
