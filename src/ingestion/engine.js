import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";

function requireField(value, name) {
  if (!value) throw new Error(`Missing required ingestion field: ${name}`);
}

export async function ingestAdapter({ adapter, store, options = {} }) {
  requireField(adapter.id, "adapter.id");
  requireField(adapter.name, "adapter.name");
  requireField(adapter.source?.sourceKey, "adapter.source.sourceKey");
  requireField(adapter.source?.canonicalUrl, "adapter.source.canonicalUrl");

  const source = await store.upsertSource({
    id: adapter.source.id ?? randomUUID(),
    sourceKey: adapter.source.sourceKey,
    name: adapter.source.name ?? adapter.name,
    sourceClass: adapter.source.sourceClass ?? "inference_lead",
    publisher: adapter.source.publisher,
    canonicalUrl: adapter.source.canonicalUrl
  });

  const run = await store.startRun({
    id: randomUUID(),
    adapterId: adapter.id,
    sourceId: source.id,
    sourceVersion: adapter.source.version ?? null
  });

  try {
    const rawRecords = await adapter.fetch({
      since: options.since,
      cursor: options.cursor
    });

    let seen = 0;
    for await (const raw of rawRecords) {
      seen += 1;
      run.recordsSeen = seen;

      const rawPayload = raw?.payload ?? raw;
      const contentHash = raw?.contentHash ?? sha256(rawPayload);
      const rawDocument = await store.insertRawDocument({
        id: raw?.rawDocumentId ?? randomUUID(),
        ingestionRunId: run.id,
        sourceId: source.id,
        canonicalUrl: raw?.url ?? adapter.source.canonicalUrl,
        retrievedAt: raw?.retrievedAt ?? new Date().toISOString(),
        httpStatus: raw?.httpStatus ?? null,
        mimeType: raw?.mimeType ?? "application/json",
        contentHash,
        payload: rawPayload
      });

      const normalized = await adapter.normalize(rawPayload, {
        source,
        run,
        rawDocument,
        contentHash
      });

      for (const entityInput of normalized.entities ?? []) {
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
        }
      }

      for (const edgeInput of normalized.edges ?? []) {
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
    await store.failRun(run.id, error);
    throw error;
  }
}
