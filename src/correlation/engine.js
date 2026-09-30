import { randomUUID } from "node:crypto";
import { CORRELATION_ENGINE_VERSION, runCorrelationRules } from "./rules.js";

export { CORRELATION_ENGINE_VERSION };

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error("Correlation snapshot requires array: " + name);
}

function normalizeMaxFindings(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(Math.floor(number), 0) : null;
}

export function normalizeSnapshot(snapshot) {
  assertArray(snapshot.entities, "entities");
  assertArray(snapshot.observations, "observations");
  assertArray(snapshot.edges, "edges");

  return {
    entities: [...snapshot.entities].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    observations: [...snapshot.observations].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    edges: [...snapshot.edges].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
}

export function runCorrelation({ snapshot, maxFindings } = {}) {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const startedAt = new Date().toISOString();
  const findings = runCorrelationRules(normalizedSnapshot);

  const limit = normalizeMaxFindings(maxFindings);

  const limitedFindings = limit == null ? findings : findings.slice(0, limit);

  return {
    run: {
      id: randomUUID(),
      engineVersion: CORRELATION_ENGINE_VERSION,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      entityCount: normalizedSnapshot.entities.length,
      observationCount: normalizedSnapshot.observations.length,
      edgeCount: normalizedSnapshot.edges.length,
      findingCount: limitedFindings.length,
      errors: []
    },
    findings: limitedFindings
  };
}

export async function executeCorrelationRun({ store, maxFindings } = {}) {
  if (!store?.getCorrelationSnapshot ||
      !store?.startCorrelationRun ||
      !store?.insertCorrelationFinding ||
      !store?.completeCorrelationRun ||
      !store?.failCorrelationRun) {
    throw new Error("Correlation store is missing required run/finding methods.");
  }

  const snapshot = await store.getCorrelationSnapshot();
  const runId = randomUUID();

  await store.startCorrelationRun({
    id: runId,
    engineVersion: CORRELATION_ENGINE_VERSION
  });

  try {
    const result = runCorrelation({ snapshot, maxFindings });

    for (const finding of result.findings) {
      await store.insertCorrelationFinding(runId, finding);
    }

    return await store.completeCorrelationRun(runId, {
      entityCount: result.run.entityCount,
      observationCount: result.run.observationCount,
      edgeCount: result.run.edgeCount,
      findingCount: result.findings.length,
      errors: []
    });
  } catch (error) {
    await store.failCorrelationRun(runId, error);
    throw error;
  }
}
