import { sha256 } from "../ingestion/hash.js";

export const CORRELATION_ENGINE_VERSION = "0.5.0";

const MUNICIPAL_POSITIONS = new Set(["MAYOR", "VICE MAYOR", "COUNCILOR"]);
const PROVINCIAL_POSITIONS = new Set([
  "GOVERNOR",
  "VICE GOVERNOR",
  "PROVINCIAL BOARD MEMBER"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePlace(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[()]/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/PROVINCE/g, "")
    .replace(/s+/g, " ")
    .trim();
}

function normalizePersonName(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/s+/g, " ").trim();
}

function normalizeContractor(value) {
  return clean(value).toUpperCase().replace(/\([^)]*\)/g, " ").replace(/[^A-Z0-9]+/g, " ").replace(/s+/g, " ").trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function yearFromDate(value) {
  const match = clean(value).match(/(?:19|20)d{2}/);
  return match ? Number(match[0]) : null;
}

function collectProjectYears(project) {
  const data = project.data ?? {};
  const years = new Set();

  for (const value of [
    data.infraYear,
    yearFromDate(data.startDate),
    yearFromDate(data.contractEffectivityDate),
    yearFromDate(data.expiryDate),
    yearFromDate(data.completionDate)
  ]) {
    if (Number.isInteger(value)) years.add(value);
  }

  return [...years].sort((a, b) => a - b);
}

function getProjectLocation(project) {
  const location = project.data?.location ?? {};

  return {
    city: normalizePlace(location.city ?? location.municipality ?? location.town),
    municipality: normalizePlace(location.municipality ?? location.city ?? location.town),
    province: normalizePlace(location.province),
    region: normalizePlace(location.region)
  };
}

function getElectionLocation(entity) {
  const data = entity.data ?? {};

  return {
    city: normalizePlace(data.city),
    province: normalizePlace(data.province),
    region: normalizePlace(data.region)
  };
}

function projectObservationRows(snapshot, entityId) {
  return snapshot.observations
    .filter(row => row.entityId === entityId)
    .sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
}

function projectEntities(snapshot) {
  return snapshot.entities.filter(entity => entity.entityType === "project");
}

function electionEntities(snapshot) {
  return snapshot.entities.filter(entity => entity.entityType === "election_result");
}

function findingFingerprint(input) {
  return sha256(input);
}

function baseFinding({
  ruleId,
  findingType,
  status,
  subjectEntityId = null,
  relatedEntityIds = [],
  evidenceObservationIds = [],
  evidenceEdgeIds = [],
  payload
}) {
  const stable = {
    ruleId,
    findingType,
    subjectEntityId,
    relatedEntityIds: [...relatedEntityIds].sort(),
    evidenceObservationIds: [...evidenceObservationIds].sort(),
    evidenceEdgeIds: [...evidenceEdgeIds].sort(),
    payload
  };

  return {
    id: null,
    ruleId,
    findingType,
    status,
    fingerprint: findingFingerprint({
      ruleId,
      findingType,
      subjectEntityId,
      relatedEntityIds: stable.relatedEntityIds,
      payload
    }),
    subjectEntityId,
    relatedEntityIds: stable.relatedEntityIds,
    evidenceObservationIds: stable.evidenceObservationIds,
    evidenceEdgeIds: stable.evidenceEdgeIds,
    payload
  };
}

export function findProjectStatusHistories(snapshot) {
  const findings = [];

  for (const project of projectEntities(snapshot)) {
    const observations = projectObservationRows(snapshot, project.id);
    if (observations.length < 2) continue;

    const states = observations.map(obs => ({
      observationId: obs.id,
      sourceId: obs.sourceId,
      sourceRecordId: obs.sourceRecordId,
      observedAt: obs.observedAt,
      status: clean(obs.data?.status),
      progress: toNumber(obs.data?.progress),
      contentHash: obs.contentHash
    }));

    const distinctStatuses = new Set(states.map(item => item.status).filter(Boolean));
    const distinctProgress = new Set(
      states.filter(item => item.progress != null).map(item => item.progress)
    );

    if (distinctStatuses.size <= 1 && distinctProgress.size <= 1) continue;

    const evidenceObservationIds = states.map(item => item.observationId);
    findings.push(baseFinding({
      ruleId: "project-status-history",
      findingType: "STATUS_HISTORY",
      status: "VERIFIED_FACT",
      subjectEntityId: project.id,
      evidenceObservationIds,
      payload: {
        statement: "This project has multiple source observations with differing published status and/or progress values.",
        projectCanonicalKey: project.canonicalKey,
        projectLabel: project.label,
        observations: states
      }
    }));
  }

  return findings;
}

export function findProjectSourceDivergence(snapshot) {
  const findings = [];

  for (const project of projectEntities(snapshot)) {
    const observations = projectObservationRows(snapshot, project.id);
    const sourceIds = new Set(observations.map(obs => obs.sourceId));

    if (sourceIds.size < 2) continue;

    const observationsBySource = new Map();
    for (const obs of observations) {
      const sourceList = observationsBySource.get(obs.sourceId) ?? [];
      sourceList.push(obs);
      observationsBySource.set(obs.sourceId, sourceList);
    }

    const statusValues = new Set(
      observations.map(obs => clean(obs.data?.status)).filter(Boolean)
    );

    findings.push(baseFinding({
      ruleId: "project-multi-source-observation",
      findingType: "MULTI_SOURCE_PROJECT",
      status: "CORROBORATED_FACT",
      subjectEntityId: project.id,
      evidenceObservationIds: observations.map(obs => obs.id),
      payload: {
        statement: "The canonical project entity has observations from multiple source records.",
        projectCanonicalKey: project.canonicalKey,
        sourceIds: [...sourceIds].sort(),
        distinctPublishedStatuses: [...statusValues].sort(),
        observations: [...observationsBySource.entries()].map(([sourceId, rows]) => ({
          sourceId,
          observationIds: rows.map(row => row.id),
          statuses: [...new Set(rows.map(row => clean(row.data?.status)).filter(Boolean))].sort()
        })).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
      }
    }));
  }

  return findings;
}

export function findContractorPortfolios(snapshot) {
  const groups = new Map();

  for (const project of projectEntities(snapshot)) {
    const contractor = normalizeContractor(project.data?.contractor);
    if (!contractor) continue;

    const item = groups.get(contractor) ?? [];
    item.push(project);
    groups.set(contractor, item);
  }

  const findings = [];

  for (const [contractor, projects] of groups) {
    const uniqueProjects = [...new Map(projects.map(project => [project.canonicalKey, project])).values()];
    if (uniqueProjects.length < 2) continue;

    findings.push(baseFinding({
      ruleId: "contractor-project-portfolio",
      findingType: "CONTRACTOR_PORTFOLIO",
      status: "VERIFIED_FACT",
      relatedEntityIds: uniqueProjects.map(project => project.id),
      evidenceObservationIds: uniqueProjects.flatMap(project =>
        projectObservationRows(snapshot, project.id).map(obs => obs.id)
      ),
      payload: {
        statement: "The same normalized contractor name appears in multiple canonical project records.",
        contractorDisplayName: uniqueProjects[0].data?.contractor,
        contractorNormalizedKey: contractor,
        projects: uniqueProjects.map(project => ({
          entityId: project.id,
          canonicalKey: project.canonicalKey,
          label: project.label,
          contractId: project.data?.contractId ?? null,
          province: project.data?.location?.province ?? null,
          city: project.data?.location?.city ?? project.data?.location?.municipality ?? null
        })).sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
      }
    }));
  }

  return findings;
}

function electionCanApplyAtPosition(data, projectLocation) {
  const position = clean(data.position).toUpperCase();

  if (MUNICIPAL_POSITIONS.has(position)) {
    return Boolean(projectLocation.city && normalizePlace(data.city) === projectLocation.city);
  }

  if (PROVINCIAL_POSITIONS.has(position)) {
    return Boolean(projectLocation.province && normalizePlace(data.province) === projectLocation.province);
  }

  return false;
}

function electionProjectJoinBasis(data, projectLocation) {
  const position = clean(data.position).toUpperCase();

  if (MUNICIPAL_POSITIONS.has(position) && projectLocation.city && normalizePlace(data.city) === projectLocation.city) {
    return "city+election_year";
  }

  if (PROVINCIAL_POSITIONS.has(position) && projectLocation.province && normalizePlace(data.province) === projectLocation.province) {
    return "province+election_year";
  }

  return null;
}

export function findElectionProjectOverlaps(snapshot) {
  const findings = [];
  const projects = projectEntities(snapshot);
  const elections = electionEntities(snapshot);

  for (const project of projects) {
    const years = collectProjectYears(project);
    if (!years.length) continue;

    const projectLocation = getProjectLocation(project);
    if (!projectLocation.city && !projectLocation.province) continue;

    for (const election of elections) {
      const electionYear = toNumber(election.data?.year);
      if (!electionYear || !years.includes(electionYear)) continue;
      if (!electionCanApplyAtPosition(election.data, projectLocation)) continue;

      const joinBasis = electionProjectJoinBasis(election.data, projectLocation);
      if (!joinBasis) continue;

      const contractor = clean(project.data?.contractor) || null;
      findings.push(baseFinding({
        ruleId: "election-project-jurisdiction-overlap",
        findingType: "ELECTION_PROJECT_OVERLAP",
        status: "INFERENCE_LEAD",
        subjectEntityId: election.id,
        relatedEntityIds: [project.id],
        evidenceObservationIds: [
          ...projectObservationRows(snapshot, project.id).map(obs => obs.id),
          ...projectObservationRows(snapshot, election.id).map(obs => obs.id)
        ],
        payload: {
          statement: "An election record and a project share a jurisdiction at the applicable office level and have an overlapping recorded year.",
          electionEntityId: election.id,
          electionCanonicalKey: election.canonicalKey,
          electionRecord: {
            fullName: election.data?.fullName ?? election.data?.candidateName ?? null,
            position: election.data?.position ?? null,
            year: electionYear,
            city: election.data?.city ?? null,
            province: election.data?.province ?? null
          },
          projectEntityId: project.id,
          projectCanonicalKey: project.canonicalKey,
          projectRecord: {
            contractId: project.data?.contractId ?? null,
            description: project.data?.description ?? null,
            contractor
          },
          projectYears: years,
          joinBasis,
          interpretationLimit: "Jurisdiction and time overlap do not establish a role in the project, influence, favoritism, conflict of interest, or causation."
        }
      }));
    }
  }

  return findings;
}

export function findElectionProjectContractorOverlaps(snapshot) {
  const findings = [];
  const projects = projectEntities(snapshot);
  const elections = electionEntities(snapshot);

  for (const project of projects) {
    const contractor = clean(project.data?.contractor);
    if (!contractor) continue;

    const years = collectProjectYears(project);
    if (!years.length) continue;

    const projectLocation = getProjectLocation(project);

    for (const election of elections) {
      const electionYear = toNumber(election.data?.year);
      if (!electionYear || !years.includes(electionYear)) continue;
      if (!electionCanApplyAtPosition(election.data, projectLocation)) continue;

      const joinBasis = electionProjectJoinBasis(election.data, projectLocation);
      if (!joinBasis) continue;

      findings.push(baseFinding({
        ruleId: "election-project-contractor-intersection",
        findingType: "ELECTION_PROJECT_CONTRACTOR_INTERSECTION",
        status: "INFERENCE_LEAD",
        subjectEntityId: election.id,
        relatedEntityIds: [project.id],
        evidenceObservationIds: [
          ...projectObservationRows(snapshot, project.id).map(obs => obs.id),
          ...projectObservationRows(snapshot, election.id).map(obs => obs.id)
        ],
        payload: {
          statement: "An election record, project and named contractor intersect on documented jurisdiction and year.",
          joinBasis,
          election: {
            canonicalKey: election.canonicalKey,
            fullName: election.data?.fullName ?? election.data?.candidateName ?? null,
            position: election.data?.position ?? null,
            year: electionYear
          },
          project: {
            canonicalKey: project.canonicalKey,
            contractId: project.data?.contractId ?? null,
            description: project.data?.description ?? null,
            contractor
          },
          interpretationLimit: "This is an intersection lead only. It does not establish any relationship between the office-holder and contractor beyond the shared project context."
        }
      }));
    }
  }

  return findings;
}

export function runCorrelationRules(snapshot) {
  return [
    ...findProjectStatusHistories(snapshot),
    ...findProjectSourceDivergence(snapshot),
    ...findContractorPortfolios(snapshot),
    ...findElectionProjectOverlaps(snapshot),
    ...findElectionProjectContractorOverlaps(snapshot)
  ];
}
