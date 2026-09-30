import { createPool } from "../src/db/postgres.js";

function cleanId(value) {
  return String(value ?? "").trim().slice(0, 200);
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

  const id = cleanId(req.query?.id);
  if (!id) return res.status(400).json({ error: "id is required." });

  const pool = createPool();

  try {
    const entityResult = await pool.query(
      \`SELECT id, entity_type AS "entityType", canonical_key AS "canonicalKey",
              label, data, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
       FROM entities WHERE id=$1\`,
      [id]
    );

    if (!entityResult.rows[0]) {
      return res.status(404).json({ service: "bantaylink", status: "not_found" });
    }

    const [observations, edges, candidates, assertions, identities, clusters] = await Promise.all([
      pool.query(
        \`SELECT o.id, o.entity_id AS "entityId", o.source_id AS "sourceId",
                o.ingestion_run_id AS "ingestionRunId", o.raw_document_id AS "rawDocumentId",
                o.record_type AS "recordType", o.source_record_id AS "sourceRecordId",
                o.observed_at AS "observedAt", o.content_hash AS "contentHash", o.data,
                s.name AS "sourceName", s.source_class AS "sourceClass",
                s.publisher, s.canonical_url AS "canonicalUrl",
                r.retrieval_url AS "retrievalUrl", r.retrieved_at AS "retrievedAt",
                r.http_status AS "httpStatus", r.mime_type AS "mimeType",
                r.payload_encoding AS "payloadEncoding", r.hash_algorithm AS "hashAlgorithm",
                r.hash_scope AS "hashScope", r.content_hash AS "rawContentHash"
         FROM observations o
         JOIN sources s ON s.id=o.source_id
         LEFT JOIN raw_documents r ON r.id=o.raw_document_id
         WHERE o.entity_id=$1
         ORDER BY o.observed_at DESC, o.id DESC
         LIMIT 250\`,
        [id]
      ),
      pool.query(
        \`SELECT e.id, e.from_entity_id AS "fromEntityId", e.to_entity_id AS "toEntityId",
                e.edge_type AS "edgeType", e.source_id AS "sourceId",
                e.ingestion_run_id AS "ingestionRunId", e.raw_document_id AS "rawDocumentId",
                e.source_record_id AS "sourceRecordId", e.observed_at AS "observedAt",
                e.content_hash AS "contentHash", e.data,
                s.name AS "sourceName", s.source_class AS "sourceClass",
                s.publisher, s.canonical_url AS "canonicalUrl"
         FROM edges e
         JOIN sources s ON s.id=e.source_id
         WHERE e.from_entity_id=$1 OR e.to_entity_id=$1
         ORDER BY e.observed_at DESC, e.id DESC
         LIMIT 250\`,
        [id]
      ),
      pool.query(
        \`SELECT c.id, c.source_entity_id AS "sourceEntityId",
                c.candidate_entity_id AS "candidateEntityId",
                c.entity_type AS "entityType",
                c.identity_group_key AS "identityGroupKey",
                c.match_method AS "matchMethod",
                c.status, c.fingerprint, c.rationale,
                c.evidence_observation_ids AS "evidenceObservationIds",
                c.evidence_edge_ids AS "evidenceEdgeIds",
                c.payload, c.created_at AS "createdAt",
                se.entity_type AS "sourceEntityType",
                ce.entity_type AS "candidateEntityType",
                se.label AS "sourceLabel", ce.label AS "candidateLabel",
                se.canonical_key AS "sourceCanonicalKey",
                ce.canonical_key AS "candidateCanonicalKey"
         FROM entity_resolution_candidates c
         JOIN entities se ON se.id=c.source_entity_id
         JOIN entities ce ON ce.id=c.candidate_entity_id
         WHERE c.source_entity_id=$1 OR c.candidate_entity_id=$1
         ORDER BY c.status, c.created_at DESC
         LIMIT 200\`,
        [id]
      ),
      pool.query(
        \`SELECT a.id, a.source_entity_id AS "sourceEntityId",
                a.canonical_entity_id AS "canonicalEntityId",
                a.assertion_type AS "assertionType",
                a.resolution_run_id AS "resolutionRunId",
                a.identity_group_key AS "identityGroupKey",
                a.evidence_observation_ids AS "evidenceObservationIds",
                a.evidence_edge_ids AS "evidenceEdgeIds",
                a.basis, a.created_at AS "createdAt"
         FROM entity_resolution_assertions a
         WHERE a.source_entity_id=$1 OR a.canonical_entity_id=$1
         ORDER BY a.created_at DESC
         LIMIT 100\`,
        [id]
      ),
      pool.query(
        \`SELECT i.id, i.entity_resolution_run_id AS "entityResolutionRunId",
                i.identity_type AS "identityType", i.entity_id AS "entityId",
                i.source_id AS "sourceId", i.source_record_id AS "sourceRecordId",
                i.identity_key AS "identityKey", i.normalized_name AS "normalizedName",
                i.locality_key AS "localityKey", i.external_id AS "externalId",
                i.data, i.created_at AS "createdAt"
         FROM entity_resolution_identity_records i
         JOIN entity_resolution_runs r ON r.id=i.entity_resolution_run_id
         WHERE i.entity_id=$1 AND r.status='completed'
         ORDER BY r.completed_at DESC, i.created_at DESC
         LIMIT 5\`,
        [id]
      ),
      pool.query(
        \`SELECT c.id, c.entity_resolution_run_id AS "entityResolutionRunId",
                c.entity_type AS "entityType", c.cluster_key AS "clusterKey",
                c.representative_entity_id AS "representativeEntityId",
                c.member_entity_ids AS "memberEntityIds", c.status, c.basis,
                c.created_at AS "createdAt"
         FROM entity_resolution_clusters c
         WHERE c.member_entity_ids @> ARRAY[$1]::text[]
         ORDER BY c.created_at DESC
         LIMIT 20\`,
        [id]
      )
    ]);

    const observationIds = observations.rows.map(row => row.id);
    const observationOccurrences = observationIds.length
      ? await pool.query(
          \`SELECT observation_id AS "observationId", ingestion_run_id AS "ingestionRunId",
                  raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
           FROM observation_occurrences
           WHERE observation_id = ANY($1::text[])
           ORDER BY seen_at DESC
           LIMIT 1000\`,
          [observationIds]
        )
      : { rows: [] };

    const edgeIds = edges.rows.map(row => row.id);
    const edgeOccurrences = edgeIds.length
      ? await pool.query(
          \`SELECT edge_id AS "edgeId", ingestion_run_id AS "ingestionRunId",
                  raw_document_id AS "rawDocumentId", seen_at AS "seenAt"
           FROM edge_occurrences
           WHERE edge_id = ANY($1::text[])
           ORDER BY seen_at DESC
           LIMIT 1000\`,
          [edgeIds]
        )
      : { rows: [] };

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      entity: entityResult.rows[0],
      observations: observations.rows,
      edges: edges.rows,
      observationOccurrences: observationOccurrences.rows,
      edgeOccurrences: edgeOccurrences.rows,
      resolutionCandidates: candidates.rows,
      resolutionAssertions: assertions.rows,
      identityRecords: identities.rows,
      resolutionClusters: clusters.rows
    });
  } catch {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Entity evidence could not be read."
    });
  } finally {
    await pool.end();
  }
}
