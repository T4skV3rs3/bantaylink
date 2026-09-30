import { createPool } from "../src/db/postgres.js";

const MAX_IDS = 200;

function parseIds(value) {
  return [...new Set(
    String(value ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  )].slice(0, MAX_IDS);
}

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

async function loadEntities(pool, entityIds) {
  if (!entityIds.length) return { rows: [] };
  return pool.query(
    \`SELECT id, entity_type AS "entityType", canonical_key AS "canonicalKey",
            label, data, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
     FROM entities
     WHERE id = ANY($1::text[])
     ORDER BY entity_type, canonical_key\`,
    [entityIds]
  );
}

async function loadObservations(pool, observationIds) {
  if (!observationIds.length) return { rows: [] };
  return pool.query(
    \`SELECT o.id, o.entity_id AS "entityId", o.source_id AS "sourceId",
            o.ingestion_run_id AS "ingestionRunId", o.raw_document_id AS "rawDocumentId",
            o.record_type AS "recordType", o.source_record_id AS "sourceRecordId",
            o.observed_at AS "observedAt", o.content_hash AS "contentHash", o.data,
            s.name AS "sourceName", s.source_class AS "sourceClass",
            s.publisher, s.canonical_url AS "canonicalUrl",
            r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
            r.request_method AS "requestMethod", r.http_status AS "httpStatus",
            r.mime_type AS "mimeType", r.payload_encoding AS "payloadEncoding",
            r.hash_algorithm AS "hashAlgorithm", r.hash_scope AS "hashScope",
            r.content_hash AS "rawContentHash"
     FROM observations o
     JOIN sources s ON s.id=o.source_id
     LEFT JOIN raw_documents r ON r.id=o.raw_document_id
     WHERE o.id = ANY($1::text[])
     ORDER BY o.observed_at DESC, o.id DESC\`,
    [observationIds]
  );
}

async function loadEdges(pool, edgeIds) {
  if (!edgeIds.length) return { rows: [] };
  return pool.query(
    \`SELECT e.id, e.from_entity_id AS "fromEntityId", e.to_entity_id AS "toEntityId",
            e.edge_type AS "edgeType", e.source_id AS "sourceId",
            e.ingestion_run_id AS "ingestionRunId", e.raw_document_id AS "rawDocumentId",
            e.source_record_id AS "sourceRecordId", e.observed_at AS "observedAt",
            e.content_hash AS "contentHash", e.data,
            s.name AS "sourceName", s.source_class AS "sourceClass",
            s.publisher, s.canonical_url AS "canonicalUrl",
            r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
            r.request_method AS "requestMethod", r.http_status AS "httpStatus",
            r.mime_type AS "mimeType", r.payload_encoding AS "payloadEncoding",
            r.hash_algorithm AS "hashAlgorithm", r.hash_scope AS "hashScope",
            r.content_hash AS "rawContentHash"
     FROM edges e
     JOIN sources s ON s.id=e.source_id
     LEFT JOIN raw_documents r ON r.id=e.raw_document_id
     WHERE e.id = ANY($1::text[])
     ORDER BY e.observed_at DESC, e.id DESC\`,
    [edgeIds]
  );
}

async function loadOccurrenceHistory(pool, observationIds, edgeIds) {
  const [observationOccurrences, edgeOccurrences] = await Promise.all([
    observationIds.length ? pool.query(
      \`SELECT observation_id AS "observationId", ingestion_run_id AS "ingestionRunId",
              raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
       FROM observation_occurrences
       WHERE observation_id = ANY($1::text[])
       ORDER BY seen_at DESC
       LIMIT 1000\`,
      [observationIds]
    ) : { rows: [] },
    edgeIds.length ? pool.query(
      \`SELECT edge_id AS "edgeId", ingestion_run_id AS "ingestionRunId",
              raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
       FROM edge_occurrences
       WHERE edge_id = ANY($1::text[])
       ORDER BY seen_at DESC
       LIMIT 1000\`,
      [edgeIds]
    ) : { rows: [] }
  ]);
  return {
    observationOccurrences: observationOccurrences.rows,
    edgeOccurrences: edgeOccurrences.rows
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      service: "bantaylink",
      status: "unavailable",
      reason: "DATABASE_URL is not configured."
    });
  }

  const entityId = clean(req.query?.entityId, 200);
  const candidateId = clean(req.query?.candidateId, 250);
  const findingId = clean(req.query?.findingId, 250);
  let observationIds = parseIds(req.query?.observationIds || req.query?.observations);
  let edgeIds = parseIds(req.query?.edgeIds || req.query?.edges);

  const pool = createPool();

  try {
    let candidate = null;
    let finding = null;
    const entityIds = entityId ? [entityId] : [];

    if (candidateId) {
      const result = await pool.query(
        \`SELECT c.id, c.source_entity_id AS "sourceEntityId",
                c.candidate_entity_id AS "candidateEntityId",
                c.entity_type AS "entityType",
                c.identity_group_key AS "identityGroupKey",
                c.match_method AS "matchMethod", c.status,
                c.fingerprint, c.rationale,
                c.evidence_observation_ids AS "evidenceObservationIds",
                c.evidence_edge_ids AS "evidenceEdgeIds", c.payload,
                se.label AS "sourceLabel", ce.label AS "candidateLabel",
                se.canonical_key AS "sourceCanonicalKey",
                ce.canonical_key AS "candidateCanonicalKey"
         FROM entity_resolution_candidates c
         JOIN entities se ON se.id=c.source_entity_id
         JOIN entities ce ON ce.id=c.candidate_entity_id
         WHERE c.id=$1\`,
        [candidateId]
      );
      candidate = result.rows[0] ?? null;
      if (candidate) {
        entityIds.push(candidate.sourceEntityId, candidate.candidateEntityId);
        observationIds = [...new Set([...observationIds, ...(candidate.evidenceObservationIds || [])])].slice(0, MAX_IDS);
        edgeIds = [...new Set([...edgeIds, ...(candidate.evidenceEdgeIds || [])])].slice(0, MAX_IDS);
      }
    }

    if (findingId) {
      const result = await pool.query(
        \`SELECT f.id, f.rule_id AS "ruleId", f.finding_type AS "findingType",
                f.status, f.fingerprint, f.subject_entity_id AS "subjectEntityId",
                f.related_entity_ids AS "relatedEntityIds",
                f.evidence_observation_ids AS "evidenceObservationIds",
                f.evidence_edge_ids AS "evidenceEdgeIds", f.payload,
                f.correlation_run_id AS "correlationRunId", r.engine_version AS "engineVersion"
         FROM correlation_findings f
         JOIN correlation_runs r ON r.id=f.correlation_run_id
         WHERE f.id=$1\`,
        [findingId]
      );
      finding = result.rows[0] ?? null;
      if (finding) {
        entityIds.push(finding.subjectEntityId, ...(finding.relatedEntityIds || []));
        observationIds = [...new Set([...observationIds, ...(finding.evidenceObservationIds || [])])].slice(0, MAX_IDS);
        edgeIds = [...new Set([...edgeIds, ...(finding.evidenceEdgeIds || [])])].slice(0, MAX_IDS);
      }
    }

    if (entityId) {
      const entityEdges = await pool.query(
        \`SELECT e.id
         FROM edges e
         WHERE e.from_entity_id=$1 OR e.to_entity_id=$1
         ORDER BY e.observed_at DESC
         LIMIT 200\`,
        [entityId]
      );
      const entityObservations = await pool.query(
        \`SELECT o.id
         FROM observations o
         WHERE o.entity_id=$1
         ORDER BY o.observed_at DESC
         LIMIT 200\`,
        [entityId]
      );
      edgeIds = [...new Set([...edgeIds, ...entityEdges.rows.map(row => row.id)])].slice(0, MAX_IDS);
      observationIds = [...new Set([...observationIds, ...entityObservations.rows.map(row => row.id)])].slice(0, MAX_IDS);
    }

    if (!entityIds.length && !observationIds.length && !edgeIds.length && !candidate && !finding) {
      return res.status(400).json({
        error: "Provide entityId, candidateId, findingId, observationIds, or edgeIds."
      });
    }

    const entities = await loadEntities(pool, [...new Set(entityIds)].filter(Boolean).slice(0, MAX_IDS));
    const [observations, edges, occurrenceHistory] = await Promise.all([
      loadObservations(pool, observationIds),
      loadEdges(pool, edgeIds),
      loadOccurrenceHistory(pool, observationIds, edgeIds)
    ]);

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      focus: {
        entityId: entityId || null,
        candidateId: candidateId || null,
        findingId: findingId || null
      },
      candidate,
      finding,
      entities: entities.rows,
      observations: observations.rows.map(row => ({
        ...row,
        evidenceUrl: row.canonicalUrl,
        hashTrace: {
          algorithm: row.hashAlgorithm,
          scope: row.hashScope,
          normalizedContentHash: row.contentHash,
          rawDocumentHash: row.rawContentHash || null
        }
      })),
      edges: edges.rows,
      ...occurrenceHistory
    });
  } catch {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Evidence bundle could not be read."
    });
  } finally {
    await pool.end();
  }
}
