import { ingestAdapter } from "../src/ingestion/engine.js";
import { createPool } from "../src/db/postgres.js";
import { openHalalanVotesAdapter, openHalalanWinnersAdapter } from "../src/adapters/openhalalan.js";
import { dpwhTransparencyAdapter } from "../src/adapters/dpwh.js";
import { dpwhEfoiAdapter } from "../src/adapters/dpwh-efoi.js";

const adapters = new Map([
  [openHalalanWinnersAdapter.id, openHalalanWinnersAdapter],
  [openHalalanVotesAdapter.id, openHalalanVotesAdapter],
  [dpwhTransparencyAdapter.id, dpwhTransparencyAdapter],
  [dpwhEfoiAdapter.id, dpwhEfoiAdapter]
]);

const adapterId = process.argv[2] || process.env.BANTAYLINK_ADAPTER;
if (!adapterId || !adapters.has(adapterId)) {
  throw new Error(
    `Choose an adapter: ${[...adapters.keys()].join(", ")}. Example: node scripts/ingest-source.mjs openhalalan-winners`
  );
}

const pool = createPool();
try {
  const maxRecords = process.env.BANTAYLINK_MAX_RECORDS
    ? Number(process.env.BANTAYLINK_MAX_RECORDS)
    : undefined;

  const run = await ingestAdapter({
    adapter: adapters.get(adapterId),
    store: createPostgresStore(pool),
    options: { maxRecords }
  });

  console.log(JSON.stringify(run, null, 2));
} finally {
  await pool.end();
}

function createPostgresStore(pool) {
  return {
    startRun: async input => {
      const result = await pool.query(
        `INSERT INTO ingestion_runs
          (id, adapter_id, source_id, source_version, status, records_seen, records_inserted, records_updated, records_skipped, errors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [input.id, input.adapterId, input.sourceId, input.sourceVersion, "running", 0, 0, 0, 0, []]
      );
      return mapRun(result.rows[0]);
    },
    completeRun: async (id, patch) => {
      const result = await pool.query(
        `UPDATE ingestion_runs
         SET status='completed', records_seen=$2, records_inserted=$3, records_updated=$4,
             records_skipped=$5, errors=$6, finished_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, patch.recordsSeen, patch.recordsInserted, patch.recordsUpdated, patch.recordsSkipped, patch.errors]
      );
      return mapRun(result.rows[0]);
    },
    failRun: async (id, error) => {
      await pool.query(
        `UPDATE ingestion_runs SET status='failed', errors=ARRAY_APPEND(errors,$2), finished_at=NOW() WHERE id=$1`,
        [id, String(error?.message ?? error)]
      );
    },
    upsertSource: async source => {
      const result = await pool.query(
        `INSERT INTO sources (id, source_key, name, source_class, publisher, canonical_url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_key) DO UPDATE
         SET name=EXCLUDED.name, source_class=EXCLUDED.source_class,
             publisher=EXCLUDED.publisher, canonical_url=EXCLUDED.canonical_url
         RETURNING *`,
        [source.id, source.sourceKey, source.name, source.sourceClass, source.publisher ?? null, source.canonicalUrl]
      );
      return mapSource(result.rows[0]);
    },
    insertRawDocument: async doc => {
      const existing = await pool.query(
        `SELECT * FROM raw_documents WHERE source_id=$1 AND content_hash=$2 LIMIT 1`,
        [doc.sourceId, doc.contentHash]
      );
      if (existing.rows[0]) return mapRawDocument(existing.rows[0]);

      const result = await pool.query(
        `INSERT INTO raw_documents
          (id, ingestion_run_id, source_id, canonical_url, retrieved_at, http_status, mime_type, content_hash, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [doc.id, doc.ingestionRunId, doc.sourceId, doc.canonicalUrl, doc.retrievedAt, doc.httpStatus, doc.mimeType, doc.contentHash, JSON.stringify(doc.payload)]
      );
      return mapRawDocument(result.rows[0]);
    },
    upsertEntity: async entity => {
      const existing = await pool.query(
        `SELECT * FROM entities WHERE entity_type=$1 AND canonical_key=$2 LIMIT 1`,
        [entity.entityType, entity.canonicalKey]
      );
      if (existing.rows[0]) {
        const result = await pool.query(
          `UPDATE entities
           SET label=COALESCE($3,label), data=data || $4::jsonb, last_seen_at=NOW()
           WHERE id=$5
           RETURNING *`,
          [entity.entityType, entity.canonicalKey, entity.label ?? null, JSON.stringify(entity.data ?? {}), existing.rows[0].id]
        );
        return { entity: mapEntity(result.rows[0]), created: false };
      }

      const result = await pool.query(
        `INSERT INTO entities
          (id, entity_type, canonical_key, label, data)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [entity.id, entity.entityType, entity.canonicalKey, entity.label ?? null, JSON.stringify(entity.data ?? {})]
      );
      return { entity: mapEntity(result.rows[0]), created: true };
    },
    insertObservation: async observation => {
      const existing = await pool.query(
        `SELECT * FROM observations
         WHERE source_id=$1 AND source_record_id=$2 AND content_hash=$3 LIMIT 1`,
        [observation.sourceId, observation.sourceRecordId, observation.contentHash]
      );
      if (existing.rows[0]) return { inserted: false, observation: mapObservation(existing.rows[0]) };

      const result = await pool.query(
        `INSERT INTO observations
          (id, entity_id, source_id, ingestion_run_id, raw_document_id, record_type,
           source_record_id, observed_at, content_hash, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          observation.id, observation.entityId, observation.sourceId, observation.ingestionRunId,
          observation.rawDocumentId, observation.recordType, observation.sourceRecordId,
          observation.observedAt, observation.contentHash, JSON.stringify(observation.data ?? {})
        ]
      );
      return { inserted: true, observation: mapObservation(result.rows[0]) };
    },
    insertEdge: async edge => {
      const existing = await pool.query(
        `SELECT * FROM edges
         WHERE source_id=$1 AND source_record_id=$2 AND content_hash=$3 LIMIT 1`,
        [edge.sourceId, edge.sourceRecordId, edge.contentHash]
      );
      if (existing.rows[0]) return { inserted: false, edge: existing.rows[0] };

      const result = await pool.query(
        `INSERT INTO edges
          (id, from_entity_id, to_entity_id, edge_type, source_id, ingestion_run_id,
           raw_document_id, source_record_id, observed_at, content_hash, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          edge.id, edge.fromEntityId, edge.toEntityId, edge.edgeType, edge.sourceId,
          edge.ingestionRunId, edge.rawDocumentId, edge.sourceRecordId, edge.observedAt,
          edge.contentHash, JSON.stringify(edge.data ?? {})
        ]
      );
      return { inserted: true, edge: result.rows[0] };
    }
  };
}

function mapRun(row) {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    status: row.status,
    recordsSeen: row.records_seen,
    recordsInserted: row.records_inserted,
    recordsUpdated: row.records_updated,
    recordsSkipped: row.records_skipped,
    errors: row.errors ?? []
  };
}

function mapSource(row) {
  return {
    id: row.id,
    sourceKey: row.source_key,
    name: row.name,
    sourceClass: row.source_class,
    publisher: row.publisher,
    canonicalUrl: row.canonical_url
  };
}

function mapRawDocument(row) {
  return {
    id: row.id,
    ingestionRunId: row.ingestion_run_id,
    sourceId: row.source_id,
    canonicalUrl: row.canonical_url,
    retrievedAt: row.retrieved_at,
    httpStatus: row.http_status,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    payload: row.payload
  };
}

function mapEntity(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    canonicalKey: row.canonical_key,
    label: row.label,
    data: row.data
  };
}

function mapObservation(row) {
  return {
    id: row.id,
    entityId: row.entity_id,
    sourceId: row.source_id,
    ingestionRunId: row.ingestion_run_id,
    rawDocumentId: row.raw_document_id,
    recordType: row.record_type,
    sourceRecordId: row.source_record_id,
    observedAt: row.observed_at,
    contentHash: row.content_hash,
    data: row.data
  };
}
