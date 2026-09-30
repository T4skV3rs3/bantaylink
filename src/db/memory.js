export class MemoryStore {
  constructor() {
    this.sources = new Map();
    this.runs = new Map();
    this.rawDocuments = new Map();
    this.entities = new Map();
    this.entityByKey = new Map();
    this.observations = new Map();
    this.edges = new Map();
    this.observationOccurrences = new Map();
    this.edgeOccurrences = new Map();
  }

  async startRun(input) {
    const run = {
      id: input.id,
      adapterId: input.adapterId,
      sourceId: input.sourceId ?? null,
      sourceVersion: input.sourceVersion ?? null,
      sourceSnapshot: input.sourceSnapshot ?? {},
      status: "running",
      recordsSeen: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errors: []
    };
    this.runs.set(run.id, run);
    return run;
  }

  async completeRun(id, patch) {
    const run = this.runs.get(id);
    Object.assign(run, patch, { status: "completed" });
    return run;
  }

  async failRun(id, error, errors = null) {
    const run = this.runs.get(id);
    run.status = "failed";
    run.errors = Array.isArray(errors)
      ? [...errors]
      : [...run.errors, String(error?.message ?? error)];
    return run;
  }

  async upsertSource(source) {
    const key = source.sourceKey;
    const existing = this.sources.get(key);
    if (existing) {
      existing.name = source.name;
      existing.sourceClass = source.sourceClass;
      existing.publisher = source.publisher ?? null;
      existing.canonicalUrl = source.canonicalUrl;
      return existing;
    }
    const value = {
      id: source.id,
      sourceKey: key,
      name: source.name,
      sourceClass: source.sourceClass,
      publisher: source.publisher ?? null,
      canonicalUrl: source.canonicalUrl
    };
    this.sources.set(key, value);
    return value;
  }

  async insertRawDocument(doc) {
    this.rawDocuments.set(doc.id, { ...doc, responseHeaders: { ...(doc.responseHeaders ?? {}) } });
    return this.rawDocuments.get(doc.id);
  }

  async upsertEntity(entity) {
    const key = `${entity.entityType}::${entity.canonicalKey}`;
    const existingId = this.entityByKey.get(key);
    if (existingId) {
      const existing = this.entities.get(existingId);
      existing.data = { ...existing.data, ...entity.data };
      existing.label = entity.label ?? existing.label;
      existing.lastSeenAt = new Date().toISOString();
      return { entity: existing, created: false };
    }
    const value = {
      id: entity.id,
      entityType: entity.entityType,
      canonicalKey: entity.canonicalKey,
      label: entity.label ?? null,
      data: entity.data ?? {},
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    this.entityByKey.set(key, value.id);
    this.entities.set(value.id, value);
    return { entity: value, created: true };
  }

  async insertObservation(observation) {
    const key = `${observation.sourceId}::${observation.sourceRecordId}::${observation.contentHash}`;
    for (const item of this.observations.values()) {
      const existingKey = `${item.sourceId}::${item.sourceRecordId}::${item.contentHash}`;
      if (existingKey === key) return { inserted: false, observation: item };
    }
    const value = { ...observation };
    this.observations.set(value.id, value);
    return { inserted: true, observation: value };
  }

  async linkObservationOccurrence(link) {
    const key = `${link.observationId}::${link.ingestionRunId}::${link.rawDocumentId}`;
    this.observationOccurrences.set(key, { ...link });
  }

  async insertEdge(edge) {
    const key = `${edge.sourceId}::${edge.sourceRecordId}::${edge.contentHash}`;
    for (const item of this.edges.values()) {
      const existingKey = `${item.sourceId}::${item.sourceRecordId}::${item.contentHash}`;
      if (existingKey === key) return { inserted: false, edge: item };
    }
    const value = { ...edge };
    this.edges.set(value.id, value);
    return { inserted: true, edge: value };
  }

  async linkEdgeOccurrence(link) {
    const key = `${link.edgeId}::${link.ingestionRunId}::${link.rawDocumentId}`;
    this.edgeOccurrences.set(key, { ...link });
  }

  async getEntityResolutionSnapshot() {
    const entities = [...this.entities.values()].filter(entity =>
      entity.entityType !== "election_result" ||
      entity.data?.dataset === "NLE_Winners_2004-2025" ||
      entity.data?.dataset == null
    );
    const ids = new Set(entities.map(entity => entity.id));
    return {
      entities: entities.map(row => ({ ...row })),
      observations: [...this.observations.values()].filter(row => ids.has(row.entityId)).map(row => ({ ...row })),
      edges: [...this.edges.values()].filter(row => ids.has(row.fromEntityId) || ids.has(row.toEntityId)).map(row => ({ ...row }))
    };
  }

  async getCorrelationSnapshot() {
    return {
      entities: [...this.entities.values()].map(row => ({ ...row })),
      observations: [...this.observations.values()].map(row => ({ ...row })),
      edges: [...this.edges.values()].map(row => ({ ...row }))
    };
  }

  async startEntityResolutionRun(input) {
    const run = {
      id: input.id,
      engineVersion: input.engineVersion,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      entityCount: 0,
      identityRecordCount: 0,
      candidateCount: 0,
      autoConfirmedCount: 0,
      reviewRequiredCount: 0,
      conflictCount: 0,
      clusterCount: 0,
      truncated: false,
      comparisonCount: 0,
      errors: []
    };
    if (!this.entityResolutionRuns) this.entityResolutionRuns = new Map();
    this.entityResolutionRuns.set(run.id, run);
    return run;
  }

  async insertEntityResolutionIdentityRecord(runId, identity) {
    if (!this.entityResolutionIdentityRecords) this.entityResolutionIdentityRecords = new Map();
    const id = identity.id || runId + ":" + identity.entityId;
    const row = { ...identity, id, entityResolutionRunId: runId };
    this.entityResolutionIdentityRecords.set(id, row);
    return row;
  }

  async insertEntityResolutionCandidate(runId, candidate) {
    if (!this.entityResolutionCandidates) this.entityResolutionCandidates = new Map();
    const id = candidate.id || runId + ":" + candidate.fingerprint;
    const row = { ...candidate, id, entityResolutionRunId: runId };
    this.entityResolutionCandidates.set(id, row);
    return row;
  }

  async insertEntityResolutionCluster(runId, cluster) {
    if (!this.entityResolutionClusters) this.entityResolutionClusters = new Map();
    const id = cluster.id || runId + ":" + cluster.clusterKey;
    const row = { ...cluster, id, entityResolutionRunId: runId };
    this.entityResolutionClusters.set(id, row);
    return row;
  }

  async completeEntityResolutionRun(id, patch) {
    const run = this.entityResolutionRuns.get(id);
    Object.assign(run, patch, { status: "completed", completedAt: new Date().toISOString() });
    return run;
  }

  async failEntityResolutionRun(id, error) {
    const run = this.entityResolutionRuns.get(id);
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    run.errors.push(String(error?.message ?? error));
    return run;
  }

  async insertEntityResolutionAssertion(assertion) {
    if (!this.entityResolutionAssertions) this.entityResolutionAssertions = [];
    const row = {
      ...assertion,
      id: assertion.id || "assertion-" + this.entityResolutionAssertions.length + 1
    };
    this.entityResolutionAssertions.push(row);
    return row;
  }

  async getEvidenceBundle({ observationIds = [], edgeIds = [] } = {}) {
    const obsSet = new Set(observationIds);
    const edgeSet = new Set(edgeIds);
    const observations = [...this.observations.values()].filter(row => obsSet.has(row.id)).map(row => ({ ...row }));
    const edges = [...this.edges.values()].filter(row => edgeSet.has(row.id)).map(row => ({ ...row }));
    const sourceMap = new Map([...this.sources.values()].map(source => [source.id, source]));
    for (const row of observations) {
      const source = sourceMap.get(row.sourceId);
      if (source) Object.assign(row, { sourceName: source.name, sourceClass: source.sourceClass, publisher: source.publisher, canonicalUrl: source.canonicalUrl });
    }
    return {
      observations,
      edges,
      observationOccurrences: [...this.observationOccurrences.values()].filter(row => obsSet.has(row.observationId)).map(row => ({ ...row })),
      edgeOccurrences: [...this.edgeOccurrences.values()].filter(row => edgeSet.has(row.edgeId)).map(row => ({ ...row }))
    };
  }

  async startCorrelationRun(input) {
    const run = {
      id: input.id,
      engineVersion: input.engineVersion,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      entityCount: 0,
      observationCount: 0,
      edgeCount: 0,
      findingCount: 0,
      errors: []
    };
    if (!this.correlationRuns) this.correlationRuns = new Map();
    this.correlationRuns.set(run.id, run);
    return run;
  }

  async insertCorrelationFinding(runId, finding) {
    if (!this.correlationFindings) this.correlationFindings = new Map();
    const id = finding.id || runId + ":" + finding.fingerprint;
    const row = { ...finding, id, correlationRunId: runId };
    this.correlationFindings.set(id, row);
    return row;
  }

  async completeCorrelationRun(id, patch) {
    const run = this.correlationRuns.get(id);
    Object.assign(run, patch, { status: "completed", completedAt: new Date().toISOString() });
    return run;
  }

  async failCorrelationRun(id, error) {
    const run = this.correlationRuns.get(id);
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    run.errors.push(String(error?.message ?? error));
    return run;
  }

}
