import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";

function requireField(value, name) {
  if (!value) throw new Error(`Missing required ingestion field: ${name}`);
}

function normalizeMaxRecords(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("maxRecords must be a finite number.");
  return Math.max(Math.floor(number), 0);
}

function normalizeError(error, context = {}) {
  return {
    stage: context.stage ?? "record",
    message: String(error?.message ?? error),
    sourceRecordId: context.sourceRecordId ?? null,
    url: context.url ?? null,
    at: new Date().toISOString()
  };
}

function pushRunError(run, error, options) {
  if (!Array.isArray(run.errors)) run.errors = [];
  const maxErrors = Number.isFinite(Number(options.maxErrors))
    ? Math.max(Math.floor(Number(options.maxErrors)), 1)
    : 100;
  if (run.errors.length < maxErrors) run.errors.push(error);
}

function safeSourceSnapshot(sourceConfig) {
  const blocked = /^(api[_-]?key|token|secret|password|authorization|cookie|session)$/i;

  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        blocked.test(key) ? "[REDACTED]" : visit(item)
      ])
    );
  }

  return visit(sourceConfig);
}

function assertNormalizedResult(normalized) {
  if (!normalized || typeof normalized !== "object") {
    throw new Error("Adapter normalize() must return an object.");
  }
  if (normalized.entities != null && !Array.isArray(normalized.entities)) {
    throw new Error("Adapter normalize().entities must be an array.");
  }
  if (normalized.edges != null && !Array.isArray(normalized.edges)) {
    throw new Error("Adapter normalize().edges must be an array.");
  }
}

function assertEntityInput(entity) {
  requireField(entity?.entityType, "normalized entityType");
  requireField(entity?.canonicalKey, "normalized canonicalKey");
}

function assertEdgeInput(edge) {
  requireField(edge?.from, "normalized edge.from");
  requireField(edge?.to, "normalized edge.to");
  requireField(edge?.edgeType, "normalized edgeType");
  assertEntityInput(edge.from);
  assertEntityInput(edge.to);
}

async function linkOccurrence(store, kind, occurrence) {
  const method = kind === "observation"
    ? store.linkObservationOccurrence
    : store.linkEdgeOccurrence;

  requireField(method, kind === "observation"
    ? "store.linkObservationOccurrence"
    : "store.linkEdgeOccurrence");

  await method(occurrence);
}

export async function ingestAdapter({ adapter, store, options = {} }) {
  requireField(adapter.id, "adapter.id");
  requireField(adapter.name, "adapter.name");
  requireField(store?.upsertSource, "store.upsertSource");
  requireField(store?.startRun, "store.startRun");
  requireField(store?.insertRawDocument, "store.insertRawDocument");
  requireField(store?.upsertEntity, "store.upsertEntity");
  requireField(store?.insertObservation, "store.insertObservation");
  requireField(store?.insertEdge, "store.insertEdge");
  requireField(store?.completeRun, "store.completeRun");
  requireField(store?.failRun, "store.failRun");
  requireField(adapter.fetch, "adapter.fetch");
  requireField(adapter.normalize, "adapter.normalize");

  const maxRecords = normalizeMaxRecords(options.maxRecords);
  const strict = Boolean(options.strict || process.env.BANTAYLINK_STRICT_INGESTION === "1");

  const sourceConfig = typeof adapter.getSource === "function"
    ? await adapter.getSource(options)
    : adapter.source;

  requireField(sourceConfig?.sourceKey, "adapter.source.sourceKey");
  requireField(sourceConfig?.canonicalUrl, "adapter.source.canonicalUrl");

  const source = await store.upsertSource({
    id: sourceConfig.id ?? randomUUID(),
    sourceKey: sourceConfig.sourceKey,
    name: sourceConfig.name ?? adapter.name,
    sourceClass: sourceConfig.sourceClass ?? "inference_lead",
    publisher: sourceConfig.publisher,
    canonicalUrl: sourceConfig.canonicalUrl
  });

  const run = await store.startRun({
    id: randomUUID(),
    adapterId: adapter.id,
    sourceId: source.id,
    sourceVersion: sourceConfig.version ?? null,
    sourceSnapshot: safeSourceSnapshot(sourceConfig)
  });

  try {
    const rawRecords = await adapter.fetch({
      since: options.since,
      cursor: options.cursor,
      maxRecords,
      source: sourceConfig
    });

    if (!rawRecords || typeof rawRecords[Symbol.asyncIterator] !== "function") {
      throw new Error("Adapter fetch() must return an async iterable.");
    }

    let seen = 0;
    for await (const raw of rawRecords) {
      seen += 1;
      run.recordsSeen = seen;

      try {
        if (raw == null) throw new Error("Adapter yielded an empty raw record.");

        const rawPayload = raw?.payload ?? raw?.rawContent ?? raw;
        const contentHash = raw?.contentHash ?? (
          raw?.rawContent != null ? sha256(raw.rawContent) : sha256(rawPayload)
        );
        const hashScope = raw?.hashScope ?? (
          raw?.rawContent != null ? "raw_content" : "canonical_payload"
        );

        const rawDocument = await store.insertRawDocument({
          id: raw?.rawDocumentId ?? randomUUID(),
          ingestionRunId: run.id,
          sourceId: source.id,
          canonicalUrl: sourceConfig.canonicalUrl,
          retrievalUrl: raw?.retrievalUrl ?? raw?.url ?? sourceConfig.canonicalUrl,
          requestMethod: raw?.requestMethod ?? "GET",
          responseHeaders: raw?.responseHeaders ?? {},
          retrievedAt: raw?.retrievedAt ?? new Date().toISOString(),
          httpStatus: raw?.httpStatus ?? null,
          mimeType: raw?.mimeType ?? "application/json",
          payloadEncoding: raw?.payloadEncoding ?? "jsonb",
          hashAlgorithm: "sha256",
          hashScope,
          contentHash,
          payload: raw?.payload ?? raw?.rawContent ?? raw
        });

        const normalized = await adapter.normalize(rawPayload, {
          source,
          sourceConfig,
          run,
          rawDocument,
          contentHash
        });

        assertNormalizedResult(normalized);

        for (const entityInput of normalized.entities ?? []) {
          assertEntityInput(entityInput);

          const result = await store.upsertEntity({
            id: entityInput.id ?? randomUUID(),
            entityType: entityInput.entityType,
            canonicalKey: entityInput.canonicalKey,
            label: entityInput.label,
            data: entityInput.data ?? {}
          });
          if (result.created) run.recordsInserted += 1;
          else run.recordsUpdated += 1;

          for (const observation of entityInput.observations ?? []) {
            const value = {
              id: observation.id ?? randomUUID(),
              entityId: result.entity.id,
              sourceId: source.id,
              ingestionRunId: run.id,
              rawDocumentId: rawDocument.id,
              recordType: observation.recordType ?? entityInput.entityType,
              sourceRecordId: String(observation.sourceRecordId ?? entityInput.canonicalKey),
              observedAt: observation.observedAt ?? new Date().toISOString(),
              contentHash: observation.contentHash ?? contentHash,
              data: observation.data ?? {}
            };
            const inserted = await store.insertObservation(value);
            if (!inserted.inserted) run.recordsSkipped += 1;

            await linkOccurrence(store, "observation", {
              observationId: inserted.observation.id,
              ingestionRunId: run.id,
              rawDocumentId: rawDocument.id,
              seenAt: rawDocument.retrievedAt
            });
          }
        }

        for (const edgeInput of normalized.edges ?? []) {
          assertEdgeInput(edgeInput);

          const from = await store.upsertEntity({
            id: edgeInput.from.id ?? randomUUID(),
            entityType: edgeInput.from.entityType,
            canonicalKey: edgeInput.from.canonicalKey,
            label: edgeInput.from.label,
            data: edgeInput.from.data ?? {}
          });
          const to = await store.upsertEntity({
            id: edgeInput.to.id ?? randomUUID(),
            entityType: edgeInput.to.entityType,
            canonicalKey: edgeInput.to.canonicalKey,
            label: edgeInput.to.label,
            data: edgeInput.to.data ?? {}
          });

          const value = {
            id: edgeInput.id ?? randomUUID(),
            fromEntityId: from.entity.id,
            toEntityId: to.entity.id,
            edgeType: edgeInput.edgeType,
            sourceId: source.id,
            ingestionRunId: run.id,
            rawDocumentId: rawDocument.id,
            sourceRecordId: String(edgeInput.sourceRecordId ?? `${from.entity.canonicalKey}->${to.entity.canonicalKey}`),
            observedAt: edgeInput.observedAt ?? new Date().toISOString(),
            contentHash: edgeInput.contentHash ?? contentHash,
            data: edgeInput.data ?? {}
          };
          const inserted = await store.insertEdge(value);
          if (!inserted.inserted) run.recordsSkipped += 1;

          await linkOccurrence(store, "edge", {
            edgeId: inserted.edge.id,
            ingestionRunId: run.id,
            rawDocumentId: rawDocument.id,
            seenAt: rawDocument.retrievedAt
          });
        }
      } catch (error) {
        const sourceRecordId = raw?.sourceRecordId ?? raw?.recordId ?? null;
        const normalizedError = normalizeError(error, {
          stage: "record",
          sourceRecordId,
          url: raw?.retrievalUrl ?? raw?.url ?? sourceConfig.canonicalUrl
        });
        pushRunError(run, normalizedError, options);
        if (strict) throw error;
      }
    }

    return await store.completeRun(run.id, {
      recordsSeen: run.recordsSeen,
      recordsInserted: run.recordsInserted,
      recordsUpdated: run.recordsUpdated,
      recordsSkipped: run.recordsSkipped,
      errors: run.errors
    });
  } catch (error) {
    pushRunError(run, normalizeError(error, {
      stage: "run",
      url: sourceConfig.canonicalUrl
    }), options);
    await store.failRun(run.id, error, run.errors);
    throw error;
  }
}
