import { createPool } from "../src/db/postgres.js";

export default async function handler(req, res) {
  const query = new URL(req.url || "/", "https://bantaylink.invalid").searchParams;
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

  const parsedLimit = Number(query.get("limit"));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), 250)
    : 50;
  const ruleId = query.get("rule") ? String(req.query.rule) : null;
  const status = query.get("status") ? String(req.query.status) : null;

  const pool = createPool();

  try {
    const runResult = await pool.query(
      `SELECT id, engine_version AS "engineVersion", status,
              started_at AS "startedAt", completed_at AS "completedAt",
              entity_count AS "entityCount", observation_count AS "observationCount",
              edge_count AS "edgeCount", finding_count AS "findingCount",
              truncated, errors
       FROM correlation_runs
       WHERE status='completed'
       ORDER BY completed_at DESC
       LIMIT 1`
    );

    if (!runResult.rows[0]) {
      return res.status(200).json({
        service: "bantaylink",
        status: "ok",
        run: null,
        findings: []
      });
    }

    const run = runResult.rows[0];
    const findings = await pool.query(
      `SELECT id, rule_id AS "ruleId", finding_type AS "findingType",
              status, fingerprint,
              subject_entity_id AS "subjectEntityId",
              related_entity_ids AS "relatedEntityIds",
              evidence_observation_ids AS "evidenceObservationIds",
              evidence_edge_ids AS "evidenceEdgeIds",
              payload, created_at AS "createdAt"
       FROM correlation_findings
       WHERE correlation_run_id=$1
         AND ($2::text IS NULL OR rule_id=$2)
         AND ($3::text IS NULL OR status=$3)
       ORDER BY finding_type, fingerprint
       LIMIT $4`,
      [run.id, ruleId, status, limit]
    );

    return res.status(200).json({
      service: "bantaylink",
      status: "ok",
      run,
      findings: findings.rows
    });
  } catch (error) {
    return res.status(503).json({
      service: "bantaylink",
      status: "degraded",
      error: "Correlation data could not be read."
    });
  } finally {
    await pool.end();
  }
}
