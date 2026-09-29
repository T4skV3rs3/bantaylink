import { createPool } from "../src/db/postgres.js";
import { ingestAdapter } from "../src/ingestion/engine.js";
import { seedAdapter } from "../src/adapters/seed.js";

const pool = createPool();

const store = {
  async upsertSource(source) {
    const result = await pool.query(
      `INSERT INTO sources (id, source_key, name, source_class, publisher, canonical_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (source_key) DO UPDATE SET
         name=EXCLUDED.name,
         source_class=EXCLUDED.source_class,
         publisher=EXCLUDED.publisher,
         canonical_url=EXCLUDED.canonical_url
       RETURNING id, source_key AS "sourceKey", name, source_class AS "sourceClass", publisher, canonical_url AS "canonicalUrl"`,
      [source.id,source.sourceKey,source.name,source.sourceClass,source.publisher,source.canonicalUrl]
    );
    return result.rows[0];
  },
  async startRun(input) {
    const result = await pool.query(
      `INSERT INTO ingestion_runs (id, adapter_id, source_id, source_version)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [input.id,input.adapterId,input.sourceId,input.sourceVersion]
    );
    const row=result.rows[0];
    return {id:row.id,recordsSeen:0,recordsInserted:0,recordsUpdated:0,recordsSkipped:0,errors:[]};
  },
  async completeRun(id, patch) {
    const result=await pool.query(
      `UPDATE ingestion_runs SET completed_at=NOW(),status='completed',
       records_seen=$2,records_inserted=$3,records_updated=$4,records_skipped=$5,errors=$6::jsonb
       WHERE id=$1 RETURNING *`,
      [id,patch.recordsSeen,patch.recordsInserted,patch.recordsUpdated,patch.recordsSkipped,JSON.stringify(patch.errors??[])]
    );
    return result.rows[0];
  },
  async failRun(id,error) {
    await pool.query(
      `UPDATE ingestion_runs SET completed_at=NOW(),status='failed',errors=errors || $2::jsonb WHERE id=$1`,
      [id,JSON.stringify([String(error?.message??error)])]
    );
  },
  async insertRawDocument(doc) {
    const result=await pool.query(
      `INSERT INTO raw_documents (id,ingestion_run_id,source_id,canonical_url,retrieved_at,http_status,mime_type,content_hash,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [doc.id,doc.ingestionRunId,doc.sourceId,doc.canonicalUrl,doc.retrievedAt,doc.httpStatus,doc.mimeType,doc.contentHash,JSON.stringify(doc.payload)]
    );
    return result.rows[0] ?? doc;
  },
  async upsertEntity(entity) {
    const result=await pool.query(
      `INSERT INTO entities (id,entity_type,canonical_key,label,data)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (entity_type,canonical_key) DO UPDATE SET
         label=COALESCE(EXCLUDED.label,entities.label),
         data=entities.data || EXCLUDED.data,
         last_seen_at=NOW()
       RETURNING id,entity_type AS "entityType",canonical_key AS "canonicalKey",label,data`,
      [entity.id,entity.entityType,entity.canonicalKey,entity.label,JSON.stringify(entity.data??{})]
    );
    const row=result.rows[0];
    return {entity:row,created:row.id===entity.id};
  },
  async insertObservation(observation) {
    const result=await pool.query(
      `INSERT INTO observations (id,entity_id,source_id,ingestion_run_id,raw_document_id,record_type,source_record_id,observed_at,content_hash,data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (source_id,source_record_id,content_hash) DO NOTHING
       RETURNING id`,
      [observation.id,observation.entityId,observation.sourceId,observation.ingestionRunId,observation.rawDocumentId,observation.recordType,observation.sourceRecordId,observation.observedAt,observation.contentHash,JSON.stringify(observation.data??{})]
    );
    return {inserted:result.rowCount===1,observation};
  },
  async insertEdge(edge) {
    const result=await pool.query(
      `INSERT INTO edges (id,from_entity_id,to_entity_id,edge_type,source_id,ingestion_run_id,raw_document_id,source_record_id,observed_at,content_hash,data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (source_id,source_record_id,content_hash) DO NOTHING
       RETURNING id`,
      [edge.id,edge.fromEntityId,edge.toEntityId,edge.edgeType,edge.sourceId,edge.ingestionRunId,edge.rawDocumentId,edge.sourceRecordId,edge.observedAt,edge.contentHash,JSON.stringify(edge.data??{})]
    );
    return {inserted:result.rowCount===1,edge};
  }
};

try {
  const run=await ingestAdapter({adapter:seedAdapter,store});
  console.log(JSON.stringify({
    runId:run.id,
    status:run.status,
    recordsSeen:run.recordsSeen,
    recordsInserted:run.recordsInserted,
    recordsUpdated:run.recordsUpdated,
    recordsSkipped:run.recordsSkipped
  },null,2));
} finally {
  await pool.end();
}
