import pg from "pg";

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the Postgres store.");
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 4),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
  });
}

function mapRawDocument(row) {
  return {
    id: row.id,
    ingestionRunId: row.ingestion_run_id,
    sourceId: row.source_id,
    canonicalUrl: row.canonical_url,
    retrievalUrl: row.retrieval_url,
    requestMethod: row.request_method,
    responseHeaders: row.response_headers,
    retrievedAt: row.retrieved_at,
    httpStatus: row.http_status,
    mimeType: row.mime_type,
    payloadEncoding: row.payload_encoding,
    hashAlgorithm: row.hash_algorithm,
    hashScope: row.hash_scope,
    contentHash: row.content_hash,
    payload: row.payload
  };
}

export function createPostgresStore(pool) {
  return {
    async upsertSource(source) {
      const result = await pool.query(
        `INSERT INTO sources (id, source_key, name, source_class, publisher, canonical_url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_key) DO UPDATE SET
           name=EXCLUDED.name,
           source_class=EXCLUDED.source_class,
           publisher=EXCLUDED.publisher,
           canonical_url=EXCLUDED.canonical_url
         RETURNING id, source_key AS "sourceKey", name,
                   source_class AS "sourceClass", publisher, canonical_url AS "canonicalUrl"`,
        [source.id, source.sourceKey, source.name, source.sourceClass, source.publisher ?? null, source.canonicalUrl]
      );
      return result.rows[0];
    },

    async startRun(input) {
      const result = await pool.query(
        `INSERT INTO ingestion_runs (id, adapter_id, source_id, source_version, source_snapshot)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         RETURNING id, adapter_id AS "adapterId", source_id AS "sourceId",
                   source_version AS "sourceVersion", source_snapshot AS "sourceSnapshot", status,
                   records_seen AS "recordsSeen", records_inserted AS "recordsInserted",
                   records_updated AS "recordsUpdated", records_skipped AS "recordsSkipped", errors`,
        [
          input.id,
          input.adapterId,
          input.sourceId,
          input.sourceVersion ?? null,
          JSON.stringify(input.sourceSnapshot ?? {})
        ]
      );
      return result.rows[0];
    },

    async completeRun(id, patch) {
      const result = await pool.query(
        `UPDATE ingestion_runs
         SET completed_at=NOW(),
             status='completed',
             records_seen=$2,
             records_inserted=$3,
             records_updated=$4,
             records_skipped=$5,
             errors=$6::jsonb
         WHERE id=$1
         RETURNING id, adapter_id AS "adapterId", source_id AS "sourceId",
                   source_version AS "sourceVersion", source_snapshot AS "sourceSnapshot", status,
                   records_seen AS "recordsSeen", records_inserted AS "recordsInserted",
                   records_updated AS "recordsUpdated", records_skipped AS "recordsSkipped", errors`,
        [
          id,
          patch.recordsSeen,
          patch.recordsInserted,
          patch.recordsUpdated,
          patch.recordsSkipped,
          JSON.stringify(patch.errors ?? [])
        ]
      );
      return result.rows[0];
    },

    async failRun(id, error, errors = null) {
      const value = errors ?? [{
        stage: "run",
        message: String(error?.message ?? error),
        at: new Date().toISOString()
      }];
      const result = await pool.query(
        `UPDATE ingestion_runs
         SET completed_at=NOW(),
             status='failed',
             errors=$2::jsonb
         WHERE id=$1
         RETURNING id, adapter_id AS "adapterId", source_id AS "sourceId",
                   source_version AS "sourceVersion", source_snapshot AS "sourceSnapshot", status,
                   records_seen AS "recordsSeen", records_inserted AS "recordsInserted",
                   records_updated AS "recordsUpdated", records_skipped AS "recordsSkipped", errors`,
        [id, JSON.stringify(value)]
      );
      return result.rows[0];
    },

    async insertRawDocument(doc) {
      const result = await pool.query(
        `INSERT INTO raw_documents
          (id, ingestion_run_id, source_id, canonical_url, retrieval_url, request_method,
           response_headers, retrieved_at, http_status, mime_type, payload_encoding,
           hash_algorithm, hash_scope, content_hash, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
         RETURNING id, ingestion_run_id, source_id, canonical_url, retrieval_url, request_method,
                   response_headers, retrieved_at, http_status, mime_type, payload_encoding,
                   hash_algorithm, hash_scope, content_hash, payload`,
        [
          doc.id,
          doc.ingestionRunId,
          doc.sourceId,
          doc.canonicalUrl ?? null,
          doc.retrievalUrl ?? doc.canonicalUrl ?? null,
          doc.requestMethod ?? "GET",
          JSON.stringify(doc.responseHeaders ?? {}),
          doc.retrievedAt,
          doc.httpStatus,
          doc.mimeType,
          doc.payloadEncoding ?? "jsonb",
          doc.hashAlgorithm ?? "sha256",
          doc.hashScope ?? "canonical_payload",
          doc.contentHash,
          JSON.stringify(doc.payload)
        ]
      );
      return mapRawDocument(result.rows[0]);
    },

    async upsertEntity(entity) {
      const result = await pool.query(
        `INSERT INTO entities (id,entity_type,canonical_key,label,data)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (entity_type,canonical_key) DO UPDATE SET
           label=COALESCE(EXCLUDED.label,entities.label),
           data=entities.data || EXCLUDED.data,
           last_seen_at=NOW()
         RETURNING id, entity_type AS "entityType", canonical_key AS "canonicalKey", label, data`,
        [
          entity.id,
          entity.entityType,
          entity.canonicalKey,
          entity.label ?? null,
          JSON.stringify(entity.data ?? {})
        ]
      );
      const row = result.rows[0];
      return { entity: row, created: row.id === entity.id };
    },

    async insertObservation(observation) {
      const inserted = await pool.query(
        `INSERT INTO observations
          (id,entity_id,source_id,ingestion_run_id,raw_document_id,record_type,
           source_record_id,observed_at,content_hash,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (source_id,source_record_id,content_hash) DO NOTHING
         RETURNING id, entity_id AS "entityId", source_id AS "sourceId",
                   ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                   record_type AS "recordType", source_record_id AS "sourceRecordId",
                   observed_at AS "observedAt", content_hash AS "contentHash", data`,
        [
          observation.id,
          observation.entityId,
          observation.sourceId,
          observation.ingestionRunId,
          observation.rawDocumentId,
          observation.recordType,
          observation.sourceRecordId,
          observation.observedAt,
          observation.contentHash,
          JSON.stringify(observation.data ?? {})
        ]
      );

      if (inserted.rowCount === 1) {
        return { inserted: true, observation: inserted.rows[0] };
      }

      const existing = await pool.query(
        `SELECT id, entity_id AS "entityId", source_id AS "sourceId",
                ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                record_type AS "recordType", source_record_id AS "sourceRecordId",
                observed_at AS "observedAt", content_hash AS "contentHash", data
         FROM observations
         WHERE source_id=$1 AND source_record_id=$2 AND content_hash=$3`,
        [observation.sourceId, observation.sourceRecordId, observation.contentHash]
      );
      if (!existing.rowCount) {
        throw new Error("Observation conflict occurred but the existing observation could not be retrieved.");
      }
      return { inserted: false, observation: existing.rows[0] };
    },

    async linkObservationOccurrence(link) {
      await pool.query(
        `INSERT INTO observation_occurrences
          (observation_id, ingestion_run_id, raw_document_id, seen_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (observation_id, ingestion_run_id, raw_document_id) DO NOTHING`,
        [link.observationId, link.ingestionRunId, link.rawDocumentId, link.seenAt]
      );
    },

    async insertEdge(edge) {
      const inserted = await pool.query(
        `INSERT INTO edges
          (id,from_entity_id,to_entity_id,edge_type,source_id,ingestion_run_id,
           raw_document_id,source_record_id,observed_at,content_hash,data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (source_id,source_record_id,content_hash) DO NOTHING
         RETURNING id, from_entity_id AS "fromEntityId", to_entity_id AS "toEntityId",
                   edge_type AS "edgeType", source_id AS "sourceId",
                   ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                   source_record_id AS "sourceRecordId", observed_at AS "observedAt",
                   content_hash AS "contentHash", data`,
        [
          edge.id,
          edge.fromEntityId,
          edge.toEntityId,
          edge.edgeType,
          edge.sourceId,
          edge.ingestionRunId,
          edge.rawDocumentId,
          edge.sourceRecordId,
          edge.observedAt,
          edge.contentHash,
          JSON.stringify(edge.data ?? {})
        ]
      );

      if (inserted.rowCount === 1) {
        return { inserted: true, edge: inserted.rows[0] };
      }

      const existing = await pool.query(
        `SELECT id, from_entity_id AS "fromEntityId", to_entity_id AS "toEntityId",
                edge_type AS "edgeType", source_id AS "sourceId",
                ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                source_record_id AS "sourceRecordId", observed_at AS "observedAt",
                content_hash AS "contentHash", data
         FROM edges
         WHERE source_id=$1 AND source_record_id=$2 AND content_hash=$3`,
        [edge.sourceId, edge.sourceRecordId, edge.contentHash]
      );
      if (!existing.rowCount) {
        throw new Error("Edge conflict occurred but the existing edge could not be retrieved.");
      }
      return { inserted: false, edge: existing.rows[0] };
    },

    async linkEdgeOccurrence(link) {
      await pool.query(
        `INSERT INTO edge_occurrences
          (edge_id, ingestion_run_id, raw_document_id, seen_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (edge_id, ingestion_run_id, raw_document_id) DO NOTHING`,
        [link.edgeId, link.ingestionRunId, link.rawDocumentId, link.seenAt]
      );
    },

    async getEntityResolutionSnapshot() {
      const entities = await pool.query(
        `SELECT id, entity_type AS "entityType", canonical_key AS "canonicalKey",
                label, data, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
         FROM entities
         WHERE entity_type IN ('project','contractor','person','organization','procurement_event','source')
            OR (entity_type='election_result'
                AND (data->>'dataset' = 'NLE_Winners_2004-2025'
                     OR data->>'dataset' IS NULL))`
      );

      const entityIds = entities.rows.map(row => row.id);
      const [observations, edges] = await Promise.all([
        entityIds.length
          ? pool.query(
              `SELECT id, entity_id AS "entityId", source_id AS "sourceId",
                      ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                      record_type AS "recordType", source_record_id AS "sourceRecordId",
                      observed_at AS "observedAt", content_hash AS "contentHash", data
               FROM observations
               WHERE entity_id = ANY($1::text[])`,
              [entityIds]
            )
          : { rows: [] },
        entityIds.length
          ? pool.query(
              `SELECT id, from_entity_id AS "fromEntityId", to_entity_id AS "toEntityId",
                      edge_type AS "edgeType", source_id AS "sourceId",
                      ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                      source_record_id AS "sourceRecordId", observed_at AS "observedAt",
                      content_hash AS "contentHash", data
               FROM edges
               WHERE from_entity_id = ANY($1::text[])
                  OR to_entity_id = ANY($1::text[])`,
              [entityIds]
            )
          : { rows: [] }
      ]);

      return { entities: entities.rows, observations: observations.rows, edges: edges.rows };
    },

    async startEntityResolutionRun(input) {
      const result = await pool.query(
        `INSERT INTO entity_resolution_runs (id, engine_version, status)
         VALUES ($1,$2,'running')
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", candidate_count AS "candidateCount",
                   auto_confirmed_count AS "autoConfirmedCount",
                   review_required_count AS "reviewRequiredCount",
                   conflict_count AS "conflictCount",
                   cluster_count AS "clusterCount", errors`,
        [input.id, input.engineVersion]
      );
      return result.rows[0];
    },

    async insertEntityResolutionCandidate(runId, candidate) {
      const id = candidate.id || `${runId}:${candidate.fingerprint}`;
      const result = await pool.query(
        `INSERT INTO entity_resolution_candidates
          (id, entity_resolution_run_id, source_entity_id, candidate_entity_id,
           entity_type, match_method, status, fingerprint, rationale,
           evidence_observation_ids, evidence_edge_ids, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (entity_resolution_run_id, fingerprint) DO UPDATE
           SET status=EXCLUDED.status, rationale=EXCLUDED.rationale,
               evidence_observation_ids=EXCLUDED.evidence_observation_ids,
               evidence_edge_ids=EXCLUDED.evidence_edge_ids,
               payload=EXCLUDED.payload
         RETURNING id, entity_resolution_run_id AS "entityResolutionRunId",
                   source_entity_id AS "sourceEntityId",
                   candidate_entity_id AS "candidateEntityId",
                   entity_type AS "entityType", match_method AS "matchMethod",
                   status, fingerprint, rationale,
                   evidence_observation_ids AS "evidenceObservationIds",
                   evidence_edge_ids AS "evidenceEdgeIds", payload`,
        [
          id, runId, candidate.sourceEntityId, candidate.candidateEntityId,
          candidate.entityType, candidate.matchMethod, candidate.status,
          candidate.fingerprint, candidate.rationale,
          candidate.evidenceObservationIds, candidate.evidenceEdgeIds,
          JSON.stringify(candidate.payload ?? {})
        ]
      );
      return result.rows[0];
    },

    async completeEntityResolutionRun(id, patch) {
      const result = await pool.query(
        `UPDATE entity_resolution_runs
         SET status='completed', completed_at=NOW(),
             entity_count=$2, candidate_count=$3,
             auto_confirmed_count=$4, review_required_count=$5,
             conflict_count=$6, cluster_count=$7, errors=$8::jsonb
         WHERE id=$1
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", candidate_count AS "candidateCount",
                   auto_confirmed_count AS "autoConfirmedCount",
                   review_required_count AS "reviewRequiredCount",
                   conflict_count AS "conflictCount", errors`,
        [
          id, patch.entityCount, patch.candidateCount,
          patch.autoConfirmedCount, patch.reviewRequiredCount,
          patch.conflictCount, patch.clusterCount ?? 0, JSON.stringify(patch.errors ?? [])
        ]
      );
      return result.rows[0];
    },

    async failEntityResolutionRun(id, error) {
      const result = await pool.query(
        `UPDATE entity_resolution_runs
         SET status='failed', completed_at=NOW(),
             errors=$2::jsonb
         WHERE id=$1
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", candidate_count AS "candidateCount",
                   auto_confirmed_count AS "autoConfirmedCount",
                   review_required_count AS "reviewRequiredCount",
                   conflict_count AS "conflictCount", errors`,
        [id, JSON.stringify([{ stage: "run", message: String(error?.message ?? error), at: new Date().toISOString() }])]
      );
      return result.rows[0];
    },

    async insertEntityResolutionAssertion(assertion) {
      const result = await pool.query(
        `INSERT INTO entity_resolution_assertions
          (id, source_entity_id, canonical_entity_id, assertion_type, resolution_run_id,
           evidence_observation_ids, evidence_edge_ids, basis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         RETURNING id, source_entity_id AS "sourceEntityId",
                   canonical_entity_id AS "canonicalEntityId",
                   assertion_type AS "assertionType",
                   resolution_run_id AS "resolutionRunId",
                   evidence_observation_ids AS "evidenceObservationIds",
                   evidence_edge_ids AS "evidenceEdgeIds",
                   basis, created_at AS "createdAt"`,
        [
          assertion.id,
          assertion.sourceEntityId,
          assertion.canonicalEntityId,
          assertion.assertionType,
          assertion.resolutionRunId ?? null,
          assertion.evidenceObservationIds ?? [],
          assertion.evidenceEdgeIds ?? [],
          JSON.stringify(assertion.basis ?? {})
        ]
      );
      return result.rows[0];
    },

    async getEvidenceBundle({ observationIds = [], edgeIds = [] } = {}) {
      const obs = [...new Set(observationIds)].filter(Boolean).slice(0, 500);
      const edgeList = [...new Set(edgeIds)].filter(Boolean).slice(0, 500);

      const [observations, edges] = await Promise.all([
        obs.length ? pool.query(
          `SELECT o.id, o.entity_id AS "entityId", o.source_id AS "sourceId",
                  o.ingestion_run_id AS "ingestionRunId", o.raw_document_id AS "rawDocumentId",
                  o.record_type AS "recordType", o.source_record_id AS "sourceRecordId",
                  o.observed_at AS "observedAt", o.content_hash AS "contentHash", o.data,
                  s.name AS "sourceName", s.source_class AS "sourceClass",
                  s.publisher, s.canonical_url AS "canonicalUrl",
                  r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
                  r.http_status AS "httpStatus", r.mime_type AS "mimeType",
                  r.payload_encoding AS "payloadEncoding", r.hash_algorithm AS "hashAlgorithm",
                  r.hash_scope AS "hashScope", r.content_hash AS "rawContentHash",
                  r.payload
           FROM observations o
           JOIN sources s ON s.id=o.source_id
           LEFT JOIN raw_documents r ON r.id=o.raw_document_id
           WHERE o.id = ANY($1::text[])
           ORDER BY o.observed_at DESC`,
          [obs]
        ) : { rows: [] },
        edgeList.length ? pool.query(
          `SELECT e.id, e.from_entity_id AS "fromEntityId", e.to_entity_id AS "toEntityId",
                  e.edge_type AS "edgeType", e.source_id AS "sourceId",
                  e.ingestion_run_id AS "ingestionRunId", e.raw_document_id AS "rawDocumentId",
                  e.source_record_id AS "sourceRecordId", e.observed_at AS "observedAt",
                  e.content_hash AS "contentHash", e.data,
                  s.name AS "sourceName", s.source_class AS "sourceClass",
                  s.publisher, s.canonical_url AS "canonicalUrl",
                  r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
                  r.http_status AS "httpStatus", r.mime_type AS "mimeType",
                  r.payload_encoding AS "payloadEncoding", r.hash_algorithm AS "hashAlgorithm",
                  r.hash_scope AS "hashScope", r.content_hash AS "rawContentHash"
           FROM edges e
           JOIN sources s ON s.id=e.source_id
           LEFT JOIN raw_documents r ON r.id=e.raw_document_id
           WHERE e.id = ANY($1::text[])
           ORDER BY e.observed_at DESC`,
          [edgeList]
        ) : { rows: [] }
      ]);

      const ids = observations.rows.map(row => row.id);
      const eids = edges.rows.map(row => row.id);
      const [observationOccurrences, edgeOccurrences] = await Promise.all([
        ids.length ? pool.query(
          `SELECT observation_id AS "observationId", ingestion_run_id AS "ingestionRunId",
                  raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
           FROM observation_occurrences
           WHERE observation_id = ANY($1::text[])
           ORDER BY seen_at DESC`,
          [ids]
        ) : { rows: [] },
        eids.length ? pool.query(
          `SELECT edge_id AS "edgeId", ingestion_run_id AS "ingestionRunId",
                  raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
           FROM edge_occurrences
           WHERE edge_id = ANY($1::text[])
           ORDER BY seen_at DESC`,
          [eids]
        ) : { rows: [] }
      ]);

      return {
        observations: observations.rows,
        edges: edges.rows,
        observationOccurrences: observationOccurrences.rows,
        edgeOccurrences: edgeOccurrences.rows
      };
    },

    async getCorrelationSnapshot() {
      const entities = await pool.query(
        `SELECT id, entity_type AS "entityType", canonical_key AS "canonicalKey",
                label, data, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
         FROM entities
         WHERE entity_type='project'
            OR (entity_type='election_result'
                AND (data->>'dataset' = 'NLE_Winners_2004-2025'
                     OR data->>'dataset' IS NULL))`
      );

      const entityIds = entities.rows.map(row => row.id);
      const [observations, edges] = await Promise.all([
        entityIds.length
          ? pool.query(
              `SELECT id, entity_id AS "entityId", source_id AS "sourceId",
                      ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                      record_type AS "recordType", source_record_id AS "sourceRecordId",
                      observed_at AS "observedAt", content_hash AS "contentHash", data
               FROM observations
               WHERE entity_id = ANY($1::text[])`,
              [entityIds]
            )
          : { rows: [] },
        entityIds.length
          ? pool.query(
              `SELECT id, from_entity_id AS "fromEntityId", to_entity_id AS "toEntityId",
                      edge_type AS "edgeType", source_id AS "sourceId",
                      ingestion_run_id AS "ingestionRunId", raw_document_id AS "rawDocumentId",
                      source_record_id AS "sourceRecordId", observed_at AS "observedAt",
                      content_hash AS "contentHash", data
               FROM edges
               WHERE from_entity_id = ANY($1::text[])
                  OR to_entity_id = ANY($1::text[])`,
              [entityIds]
            )
          : { rows: [] }
      ]);

      return {
        entities: entities.rows,
        observations: observations.rows,
        edges: edges.rows
      };
    },

    async startCorrelationRun(input) {
      const result = await pool.query(
        `INSERT INTO correlation_runs (id, engine_version, status)
         VALUES ($1,$2,'running')
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", observation_count AS "observationCount",
                   edge_count AS "edgeCount", finding_count AS "findingCount", errors`,
        [input.id, input.engineVersion]
      );
      return result.rows[0];
    },

    async insertCorrelationFinding(runId, finding) {
      const findingId = finding.id || `${runId}:${finding.fingerprint}`;
      const result = await pool.query(
        `INSERT INTO correlation_findings
          (id, correlation_run_id, rule_id, finding_type, status, fingerprint,
           subject_entity_id, related_entity_ids, evidence_observation_ids,
           evidence_edge_ids, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (correlation_run_id, fingerprint) DO UPDATE
           SET payload=EXCLUDED.payload,
               status=EXCLUDED.status,
               related_entity_ids=EXCLUDED.related_entity_ids,
               evidence_observation_ids=EXCLUDED.evidence_observation_ids,
               evidence_edge_ids=EXCLUDED.evidence_edge_ids
         RETURNING id, correlation_run_id AS "correlationRunId", rule_id AS "ruleId",
                   finding_type AS "findingType", status, fingerprint,
                   subject_entity_id AS "subjectEntityId",
                   related_entity_ids AS "relatedEntityIds",
                   evidence_observation_ids AS "evidenceObservationIds",
                   evidence_edge_ids AS "evidenceEdgeIds", payload`,
        [
          findingId,
          runId,
          finding.ruleId,
          finding.findingType,
          finding.status,
          finding.fingerprint,
          finding.subjectEntityId,
          finding.relatedEntityIds,
          finding.evidenceObservationIds,
          finding.evidenceEdgeIds,
          JSON.stringify(finding.payload)
        ]
      );
      return result.rows[0];
    },

    async completeCorrelationRun(id, patch) {
      const result = await pool.query(
        `UPDATE correlation_runs
         SET status='completed',
             completed_at=NOW(),
             entity_count=$2,
             observation_count=$3,
             edge_count=$4,
             finding_count=$5,
             errors=$6::jsonb
         WHERE id=$1
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", observation_count AS "observationCount",
                   edge_count AS "edgeCount", finding_count AS "findingCount", errors`,
        [
          id,
          patch.entityCount,
          patch.observationCount,
          patch.edgeCount,
          patch.findingCount,
          JSON.stringify(patch.errors ?? [])
        ]
      );
      return result.rows[0];
    },

    async failCorrelationRun(id, error) {
      const result = await pool.query(
        `UPDATE correlation_runs
         SET status='failed',
             completed_at=NOW(),
             errors=errors || $2::jsonb
         WHERE id=$1
         RETURNING id, engine_version AS "engineVersion", status,
                   started_at AS "startedAt", completed_at AS "completedAt",
                   entity_count AS "entityCount", observation_count AS "observationCount",
                   edge_count AS "edgeCount", finding_count AS "findingCount", errors`,
        [id, JSON.stringify([String(error?.message ?? error)])]
      );
      return result.rows[0];
    }
  };
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initSchema(pool, schemaSql) {
  await pool.query(schemaSql);
}
