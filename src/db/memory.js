export class MemoryStore {
  constructor() {
    this.sources = new Map();
    this.runs = new Map();
    this.rawDocuments = new Map();
    this.entities = new Map();
    this.entityByKey = new Map();
    this.observations = new Map();
    this.edges = new Map();
  }

  async startRun(input) {
    const run = {
      id: input.id,
      adapterId: input.adapterId,
      sourceId: input.sourceId ?? null,
      sourceVersion: input.sourceVersion ?? null,
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

  async failRun(id, error) {
    const run = this.runs.get(id);
    run.status = "failed";
    run.errors.push(String(error?.message ?? error));
    return run;
  }

  async upsertSource(source) {
    const key = source.sourceKey;
    const existing = this.sources.get(key);
    if (existing) return existing;
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
    this.rawDocuments.set(doc.id, doc);
    return doc;
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
    this.observations.set(observation.id, observation);
    return { inserted: true, observation };
  }

  async insertEdge(edge) {
    const key = `${edge.sourceId}::${edge.sourceRecordId}::${edge.contentHash}`;
    for (const item of this.edges.values()) {
      const existingKey = `${item.sourceId}::${item.sourceRecordId}::${item.contentHash}`;
      if (existingKey === key) return { inserted: false, edge: item };
    }
    this.edges.set(edge.id, edge);
    return { inserted: true, edge };
  }

  async getCorrelationSnapshot() {
    return {
      entities: [...this.entities.values()].map(row => ({ ...row })),
      observations: [...this.observations.values()].map(row => ({ ...row })),
      edges: [...this.edges.values()].map(row => ({ ...row }))
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
