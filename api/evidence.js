import { createPool } from "../src/db/postgres.js";

function ids(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 500);
}

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
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

  const observationIdList = ids(req.query?.observationIds || req.query?.observations);
  const edgeIdList = ids(req.query?.edgeIds || req.query?.edges);
  const entityId = clean(req.query?.entityId);
  const canonicalKey = clean(req.query?.canonicalKey);
  const entityType = clean(req.query?.entityType, 50);
  const findingId = clean(req.query?.findingId);
  const candidateId = clean(req.query?.candidateId);
  const includeRaw = truthy(req.query?.includeRaw);

  if (!observationIdList.length && !edgeIdList.length && !entityId && !canonicalKey && !findingId && !candidateId) {
    return res.status(400).json({
      error: "Provide entityId, canonicalKey, findingId, candidateId, observationIds, or edgeIds."
    });
  }

  const pool = createPool();

  try {
    let targetEntityIds = entityId ? [entityId] : [];
    let finding = null;
    let resolutionCandidate = null;
    let findingObservationIds = [];
    let findingEdgeIds = [];

    if (canonicalKey) {
      const result = await pool.query(
        "SELECT id FROM entities WHERE canonical_key=$1 AND ($2::text='' OR entity_type=$2) " +
        "ORDER BY last_seen_at DESC",
        [canonicalKey, entityType]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Entity not found." });
      targetEntityIds.push(...result.rows.map(row => row.id));
    }

    if (findingId) {
      const result = await pool.query(
        "SELECT id, correlation_run_id AS \"correlationRunId\", rule_id AS \"ruleId\", " +
        "finding_type AS \"findingType\", status, fingerprint, " +
        "subject_entity_id AS \"subjectEntityId\", related_entity_ids AS \"relatedEntityIds\", " +
        "evidence_observation_ids AS \"evidenceObservationIds\", evidence_edge_ids AS \"evidenceEdgeIds\", " +
        "payload, created_at AS \"createdAt\" FROM correlation_findings WHERE id=$1",
        [findingId]
      );
      finding = result.rows[0] ?? null;
      if (!finding) return res.status(404).json({ error: "Finding not found." });
      targetEntityIds.push(finding.subjectEntityId, ...(finding.relatedEntityIds || []));
      findingObservationIds = finding.evidenceObservationIds || [];
      findingEdgeIds = finding.evidenceEdgeIds || [];
    }

    if (candidateId) {
      const result = await pool.query(
        "SELECT c.id, c.entity_resolution_run_id AS \"entityResolutionRunId\", " +
        "c.source_entity_id AS \"sourceEntityId\", c.candidate_entity_id AS \"candidateEntityId\", " +
        "c.entity_type AS \"entityType\", c.match_method AS \"matchMethod\", c.status, " +
        "c.fingerprint, c.rationale, c.evidence_observation_ids AS \"evidenceObservationIds\", " +
        "c.evidence_edge_ids AS \"evidenceEdgeIds\", c.payload, c.created_at AS \"createdAt\", " +
        "se.label AS \"sourceLabel\", ce.label AS \"candidateLabel\", " +
        "se.canonical_key AS \"sourceCanonicalKey\", ce.canonical_key AS \"candidateCanonicalKey\" " +
        "FROM entity_resolution_candidates c " +
        "JOIN entities se ON se.id=c.source_entity_id " +
        "JOIN entities ce ON ce.id=c.candidate_entity_id " +
        "WHERE c.id=$1",
        [candidateId]
      );
      resolutionCandidate = result.rows[0] ?? null;
      if (!resolutionCandidate) return res.status(404).json({ error: "Resolution candidate not found." });
      targetEntityIds.push(resolutionCandidate.sourceEntityId, resolutionCandidate.candidateEntityId);
    }

    targetEntityIds = [...new Set(targetEntityIds.filter(Boolean))];

    if (targetEntityIds.length && (!observationIdList.length || !edgeIdList.length)) {
      const [entityObservations, entityEdges] = await Promise.all([
        pool.query(
          "SELECT id FROM observations WHERE entity_id=ANY($1::text[]) ORDER BY observed_at DESC, id DESC LIMIT 500",
          [targetEntityIds]
        ),
        pool.query(
          "SELECT id FROM edges WHERE from_entity_id=ANY($1::text[]) OR to_entity_id=ANY($1::text[]) " +
          "ORDER BY observed_at DESC, id DESC LIMIT 500",
          [targetEntityIds]
        )
      ]);
      if (!observationIdList.length) observationIdList.push(...entityObservations.rows.map(row => row.id));
      if (!edgeIdList.length) edgeIdList.push(...entityEdges.rows.map(row => row.id));
    }

    observationIdList.push(...findingObservationIds);
    edgeIdList.push(...findingEdgeIds);

    const observationIdsFinal = [...new Set(observationIdList)].filter(Boolean).slice(0, 500);
    const edgeIdsFinal = [...new Set(edgeIdList)].filter(Boolean).slice(0, 500);

    const entityQuery = targetEntityIds.length
      ? pool.query(
          "SELECT id, entity_type AS \"entityType\", canonical_key AS \"canonicalKey\", label, data, " +
          "first_seen_at AS \"firstSeenAt\", last_seen_at AS \"lastSeenAt\" " +
          "FROM entities WHERE id=ANY($1::text[]) ORDER BY entity_type, canonical_key",
          [targetEntityIds]
        )
      : { rows: [] };

    const observationQuery = observationIdsFinal.length
      ? pool.query(
          "SELECT o.id, o.entity_id AS \"entityId\", o.source_id AS \"sourceId\", " +
          "o.ingestion_run_id AS \"ingestionRunId\", o.raw_document_id AS \"rawDocumentId\", " +
          "o.record_type AS \"recordType\", o.source_record_id AS \"sourceRecordId\", " +
          "o.observed_at AS \"observedAt\", o.content_hash AS \"contentHash\", o.data, " +
          "s.name AS \"sourceName\", s.source_class AS \"sourceClass\", s.publisher, " +
          "s.canonical_url AS \"canonicalUrl\", r.retrieval_url AS \"retrievalUrl\", " +
          "r.retrieved_at AS \"retrievedAt\", r.http_status AS \"httpStatus\", r.mime_type AS \"mimeType\", " +
          "r.payload_encoding AS \"payloadEncoding\", r.hash_algorithm AS \"hashAlgorithm\", " +
          "r.hash_scope AS \"hashScope\", r.content_hash AS \"rawContentHash\" " +
          "FROM observations o JOIN sources s ON s.id=o.source_id " +
          "LEFT JOIN raw_documents r ON r.id=o.raw_document_id " +
          "WHERE o.id=ANY($1::text[]) ORDER BY o.observed_at DESC, o.id DESC",
          [observationIdsFinal]
        )
      : { rows: [] };

    const edgeQuery = edgeIdsFinal.length
      ? pool.query(
          "SELECT e.id, e.from_entity_id AS \"fromEntityId\", e.to_entity_id AS \"toEntityId\", " +
          "e.edge_type AS \"edgeType\", e.source_id AS \"sourceId\", e.ingestion_run_id AS \"ingestionRunId\", " +
          "e.raw_document_id AS \"rawDocumentId\", e.source_record_id AS \"sourceRecordId\", " +
          "e.observed_at AS \"observedAt\", e.content_hash AS \"contentHash\", e.data, " +
          "s.name AS \"sourceName\", s.source_class AS \"sourceClass\", s.publisher, " +
          "s.canonical_url AS \"canonicalUrl\", r.retrieval_url AS \"retrievalUrl\", " +
          "r.retrieved_at AS \"retrievedAt\", r.http_status AS \"httpStatus\", r.mime_type AS \"mimeType\", " +
          "r.hash_algorithm AS \"hashAlgorithm\", r.hash_scope AS \"hashScope\", r.content_hash AS \"rawContentHash\" " +
          "FROM edges e JOIN sources s ON s.id=e.source_id " +
          "LEFT JOIN raw_documents r ON r.id=e.raw_document_id " +
          "WHERE e.id=ANY($1::text[]) ORDER BY e.observed_at DESC, e.id DESC",
          [edgeIdsFinal]
        )
      : { rows: [] };

    let [entities, observations, edges] = await Promise.all([
      entityQuery,
      observationQuery,
      edgeQuery
    ]);

    if (observationIdList.length || edgeIdList.length) {
      const derivedEntityIds = [
        ...observations.rows.map(row => row.entityId),
        ...edges.rows.flatMap(row => [row.fromEntityId, row.toEntityId])
      ].filter(Boolean);

      const missing = derivedEntityIds.filter(id => !targetEntityIds.includes(id));
      if (missing.length) {
        targetEntityIds = [...new Set([...targetEntityIds, ...missing])];
        entities = await pool.query(
          "SELECT id, entity_type AS \"entityType\", canonical_key AS \"canonicalKey\", label, data, " +
          "first_seen_at AS \"firstSeenAt\", last_seen_at AS \"lastSeenAt\" " +
          "FROM entities WHERE id=ANY($1::text[]) ORDER BY entity_type, canonical_key",
          [targetEntityIds]
        );
      }
    }

    const rawDocumentIds = [...new Set([
      ...observations.rows.map(row => row.rawDocumentId),
      ...edges.rows.map(row => row.rawDocumentId)
    ].filter(Boolean))].slice(0, 500);

    const rawDocuments = rawDocumentIds.length
      ? await pool.query(
          "SELECT id, ingestion_run_id AS \"ingestionRunId\", source_id AS \"sourceId\", " +
          "canonical_url AS \"canonicalUrl\", retrieval_url AS \"retrievalUrl\", request_method AS \"requestMethod\", " +
          "response_headers AS \"responseHeaders\", retrieved_at AS \"retrievedAt\", http_status AS \"httpStatus\", " +
          "mime_type AS \"mimeType\", payload_encoding AS \"payloadEncoding\", hash_algorithm AS \"hashAlgorithm\", " +
          "hash_scope AS \"hashScope\", content_hash AS \"contentHash\"" +
          (includeRaw ? ", payload" : "") +
          " FROM raw_documents WHERE id=ANY($1::text[]) ORDER BY retrieved_at DESC",
          [rawDocumentIds]
        )
      : { rows: [] };

    const obsOccurrences = observationIdsFinal.length
      ? await pool.query(
          "SELECT observation_id AS \"observationId\", ingestion_run_id AS \"ingestionRunId\", " +
          "raw_document_id AS \"rawDocumentId\", seen_at AS \"seenAt\" " +
          "FROM observation_occurrences WHERE observation_id=ANY($1::text[]) ORDER BY seen_at DESC",
          [observationIdsFinal]
        )
      : { rows: [] };

    const edgeOccurrences = edgeIdsFinal.length
      ? await pool.query(
          "SELECT edge_id AS \"edgeId\", ingestion_run_id AS \"ingestionRunId\", " +
          "raw_document_id AS \"rawDocumentId\", seen_at AS \"seenAt\" " +
          "FROM edge_occurrences WHERE edge_id=ANY($1::text[]) ORDER BY seen_at DESC",
          [edgeIdsFinal]
        )
      : { rows: [] };

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      includeRaw,
      entityIds: targetEntityIds,
      finding,
      resolutionCandidate,
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
      rawDocuments: rawDocuments.rows,
      observationOccurrences: obsOccurrences.rows,
      edgeOccurrences: edgeOccurrences.rows
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
