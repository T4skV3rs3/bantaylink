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
    .replace(/\bPROVINCE\b/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContractor(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contractorIdentity(project) {
  const explicitPcab = clean(project.data?.pcabId);
  if (explicitPcab) return { key: "pcab:" + explicitPcab, basis: "pcab_id" };

  const bidders = Array.isArray(project.data?.bidders) ? project.data.bidders : [];
  const winner = bidders.find(
    item => item?.isWinner === true || String(item?.isWinner).toLowerCase() === "true"
  );
  const winnerPcab = clean(winner?.pcabId);
  if (winnerPcab) return { key: "pcab:" + winnerPcab, basis: "winning_bidder_pcab_id" };

  const name = normalizeContractor(project.data?.contractor);
  if (!name) return null;
  return { key: "name:" + name, basis: "normalized_contractor_name" };
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function yearFromDate(value) {
  const match = clean(value).match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function collectProjectYears(project) {
  const data = project.data ?? {};
  const years = new Set();

  for (const value of [
    data.infraYear,
    toNumber(data.year),
    toNumber(data.projectYear),
    yearFromDate(data.startDate),
    yearFromDate(data.contractEffectivityDate),
    yearFromDate(data.expiryDate),
    yearFromDate(data.completionDate),
    yearFromDate(data.procurement?.advertisementDate),
    yearFromDate(data.procurement?.dateOfAward),
    yearFromDate(data.procurement?.bidSubmissionDeadline)
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
    province: normalizePlace(location.province)
  };
}

function createObservationIndex(snapshot) {
  const byEntity = new Map();
  for (const observation of snapshot.observations) {
    const list = byEntity.get(observation.entityId) ?? [];
    list.push(observation);
    byEntity.set(observation.entityId, list);
  }

  for (const list of byEntity.values()) {
    list.sort(
      (a, b) =>
        String(a.observedAt).localeCompare(String(b.observedAt)) ||
        String(a.id).localeCompare(String(b.id))
    );
  }

  return byEntity;
}

function projectEntities(snapshot) {
  return snapshot.entities.filter(entity => entity.entityType === "project");
}

function electionEntities(snapshot) {
  return snapshot.entities.filter(
    entity =>
      entity.entityType === "election_result" &&
      (entity.data?.dataset === "NLE_Winners_2004-2025" ||
       entity.data?.dataset == null)
  );
}

function baseFinding({
  ruleId,
  findingType,
  status,
  dedupeKey,
  subjectEntityId = null,
  relatedEntityIds = [],
  evidenceObservationIds = [],
  evidenceEdgeIds = [],
  payload
}) {
  const fingerprint = sha256({
    engineVersion: CORRELATION_ENGINE_VERSION,
    ruleId,
    findingType,
    dedupeKey
  });

  return {
    id: null,
    ruleId,
    findingType,
    status,
    fingerprint,
    subjectEntityId,
    relatedEntityIds: [...relatedEntityIds].sort(),
    evidenceObservationIds: [...new Set(evidenceObservationIds)].sort(),
    evidenceEdgeIds: [...new Set(evidenceEdgeIds)].sort(),
    payload
  };
}

export function findProjectStatusHistories(snapshot, observationIndex = createObservationIndex(snapshot)) {
  const findings = [];

  for (const project of projectEntities(snapshot)) {
    const observations = observationIndex.get(project.id) ?? [];
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

    const stableStates = states.map(item => ({
      sourceId: item.sourceId,
      sourceRecordId: item.sourceRecordId,
      observedAt: item.observedAt,
      status: item.status,
      progress: item.progress,
      contentHash: item.contentHash
    }));

    findings.push(baseFinding({
      ruleId: "project-status-history",
      findingType: "STATUS_HISTORY",
      status: "VERIFIED_FACT",
      dedupeKey: {
        projectCanonicalKey: project.canonicalKey,
        states: stableStates
      },
      subjectEntityId: project.id,
      evidenceObservationIds: states.map(item => item.observationId),
      payload: {
        statement: "This project has multiple source observations with differing published status and/or progress values; this records source-state differences without asserting why they differ.",
        projectCanonicalKey: project.canonicalKey,
        projectLabel: project.label,
        observations: states
      }
    }));
  }

  return findings;
}

export function findProjectSourceDivergence(snapshot, observationIndex = createObservationIndex(snapshot)) {
  const findings = [];

  for (const project of projectEntities(snapshot)) {
    const observations = observationIndex.get(project.id) ?? [];
    const sourceIds = [...new Set(observations.map(obs => obs.sourceId))].sort();
    if (sourceIds.length < 2) continue;

    const observationsBySource = new Map();
    for (const obs of observations) {
      const sourceList = observationsBySource.get(obs.sourceId) ?? [];
      sourceList.push(obs);
      observationsBySource.set(obs.sourceId, sourceList);
    }

    const statusValues = [...new Set(
      observations.map(obs => clean(obs.data?.status)).filter(Boolean)
    )].sort();

    findings.push(baseFinding({
      ruleId: "project-multi-source-observation",
      findingType: "MULTI_SOURCE_PROJECT",
      status: "VERIFIED_FACT",
      dedupeKey: {
        projectCanonicalKey: project.canonicalKey,
        sourceIds,
        contentHashes: [...new Set(observations.map(obs => obs.contentHash))].sort()
      },
      subjectEntityId: project.id,
      evidenceObservationIds: observations.map(obs => obs.id),
      payload: {
        statement: "The canonical project entity has observations from multiple source records. Source independence has not been established by this rule.",
        projectCanonicalKey: project.canonicalKey,
        sourceIds,
        distinctPublishedStatuses: statusValues,
        observations: [...observationsBySource.entries()]
          .map(([sourceId, rows]) => ({
            sourceId,
            observationIds: rows.map(row => row.id),
            statuses: [...new Set(rows.map(row => clean(row.data?.status)).filter(Boolean))].sort()
          }))
          .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
      }
    }));
  }

  return findings;
}

export function findContractorPortfolios(snapshot, observationIndex = createObservationIndex(snapshot)) {
  const groups = new Map();

  for (const project of projectEntities(snapshot)) {
    const contractor = contractorIdentity(project);
    if (!contractor) continue;

    const entries = groups.get(contractor.key) ?? [];
    entries.push({ project, contractor });
    groups.set(contractor.key, entries);
  }

  const findings = [];

  for (const [contractorKey, entries] of groups) {
    const uniqueEntries = [...new Map(
      entries.map(entry => [entry.project.canonicalKey, entry])
    ).values()];

    if (uniqueEntries.length < 2) continue;

    const projectRows = uniqueEntries
      .map(entry => entry.project)
      .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

    findings.push(baseFinding({
      ruleId: "contractor-project-portfolio",
      findingType: "CONTRACTOR_PORTFOLIO",
      status: contractorBasis === "normalized_contractor_name" ? "INFERENCE_LEAD" : "VERIFIED_FACT",
      dedupeKey: {
        contractorIdentityKey: contractorKey,
        projectCanonicalKeys: projectRows.map(project => project.canonicalKey)
      },
      relatedEntityIds: projectRows.map(project => project.id),
      evidenceObservationIds: projectRows.flatMap(project =>
        (observationIndex.get(project.id) ?? []).map(obs => obs.id)
      ),
      payload: {
        statement: "The same contractor identity key appears in multiple canonical project records.",
        contractorIdentityKey: contractorKey,
        contractorIdentityBasis: uniqueEntries[0].contractor.basis,
        contractorDisplayNames: [...new Set(
          projectRows.map(project => clean(project.data?.contractor)).filter(Boolean)
        )].sort(),
        projects: projectRows.map(project => ({
          entityId: project.id,
          canonicalKey: project.canonicalKey,
          label: project.label,
          contractId: project.data?.contractId ?? null,
          province: project.data?.location?.province ?? null,
          city: project.data?.location?.city ?? project.data?.location?.municipality ?? null
        }))
      }
    }));
  }

  return findings;
}

function createElectionIndexes(elections) {
  const byCityYear = new Map();
  const byProvinceYear = new Map();

  for (const election of elections) {
    const year = toNumber(election.data?.year);
    if (!year) continue;

    const position = clean(election.data?.position).toUpperCase();

    if (MUNICIPAL_POSITIONS.has(position)) {
      const city = normalizePlace(election.data?.city);
      if (city) {
        const key = year + "::" + city;
        const list = byCityYear.get(key) ?? [];
        list.push(election);
        byCityYear.set(key, list);
      }
    }

    if (PROVINCIAL_POSITIONS.has(position)) {
      const province = normalizePlace(election.data?.province);
      if (province) {
        const key = year + "::" + province;
        const list = byProvinceYear.get(key) ?? [];
        list.push(election);
        byProvinceYear.set(key, list);
      }
    }
  }

  return { byCityYear, byProvinceYear };
}

function findElectionProjectPairs(snapshot) {
  const elections = electionEntities(snapshot);
  const projects = projectEntities(snapshot);
  const indexes = createElectionIndexes(elections);
  const pairs = [];

  for (const project of projects) {
    const years = collectProjectYears(project);
    if (!years.length) continue;

    const location = getProjectLocation(project);
    const matched = new Map();

    if (location.city) {
      for (const year of years) {
        const key = year + "::" + location.city;
        for (const election of indexes.byCityYear.get(key) ?? []) {
          const prior = matched.get(election.id) ?? [];
          prior.push(year);
          matched.set(election.id, prior);
        }
      }
    }

    if (location.province) {
      for (const year of years) {
        const key = year + "::" + location.province;
        for (const election of indexes.byProvinceYear.get(key) ?? []) {
          const prior = matched.get(election.id) ?? [];
          prior.push(year);
          matched.set(election.id, prior);
        }
      }
    }

    for (const [electionId, matchedYears] of matched) {
      const election = snapshot.entities.find(entity => entity.id === electionId);
      if (!election) continue;

      const position = clean(election.data?.position).toUpperCase();
      const electionCity = normalizePlace(election.data?.city);
      const electionProvince = normalizePlace(election.data?.province);

      const validCity =
        MUNICIPAL_POSITIONS.has(position) &&
        Boolean(location.city) &&
        electionCity === location.city;

      const validProvince =
        PROVINCIAL_POSITIONS.has(position) &&
        Boolean(location.province) &&
        electionProvince === location.province;

      if (!validCity && !validProvince) continue;

      const joinBasis = validCity ? "city+election_year" : "province+election_year";
      const uniqueYears = [...new Set(matchedYears)].sort((a, b) => a - b);
      pairs.push({
        election,
        project,
        matchedYears: uniqueYears,
        joinBasis
      });
    }
  }

  return pairs.sort(
    (a, b) =>
      a.project.canonicalKey.localeCompare(b.project.canonicalKey) ||
      a.election.canonicalKey.localeCompare(b.election.canonicalKey)
  );
}

export function findElectionProjectOverlaps(snapshot, observationIndex = createObservationIndex(snapshot)) {
  return findElectionProjectPairs(snapshot).map(({ election, project, matchedYears, joinBasis }) =>
    baseFinding({
      ruleId: "election-project-jurisdiction-overlap",
      findingType: "ELECTION_PROJECT_OVERLAP",
      status: "INFERENCE_LEAD",
      dedupeKey: {
        electionCanonicalKey: election.canonicalKey,
        projectCanonicalKey: project.canonicalKey,
        matchedYears,
        joinBasis
      },
      subjectEntityId: election.id,
      relatedEntityIds: [project.id],
      evidenceObservationIds: [
        ...(observationIndex.get(project.id) ?? []).map(obs => obs.id),
        ...(observationIndex.get(election.id) ?? []).map(obs => obs.id)
      ],
      payload: {
        statement: "An election record and a project share a jurisdiction at the applicable office level and have an overlapping recorded year.",
        election: {
          canonicalKey: election.canonicalKey,
          entityId: election.id,
          fullName: election.data?.fullName ?? election.data?.candidateName ?? null,
          position: election.data?.position ?? null,
          year: toNumber(election.data?.year),
          city: election.data?.city ?? null,
          province: election.data?.province ?? null
        },
        project: {
          canonicalKey: project.canonicalKey,
          entityId: project.id,
          contractId: project.data?.contractId ?? null,
          description: project.data?.description ?? null
        },
        matchedYears,
        joinBasis,
        interpretationLimit: "Jurisdiction and time overlap do not establish a role in the project, influence, favoritism, conflict of interest, or causation."
      }
    })
  );
}

export function findElectionProjectContractorOverlaps(snapshot, observationIndex = createObservationIndex(snapshot)) {
  return findElectionProjectPairs(snapshot)
    .filter(({ project }) => clean(project.data?.contractor))
    .map(({ election, project, matchedYears, joinBasis }) => {
      const contractor = contractorIdentity(project);

      return baseFinding({
        ruleId: "election-project-contractor-intersection",
        findingType: "ELECTION_PROJECT_CONTRACTOR_INTERSECTION",
        status: "INFERENCE_LEAD",
        dedupeKey: {
          electionCanonicalKey: election.canonicalKey,
          projectCanonicalKey: project.canonicalKey,
          contractorIdentityKey: contractor?.key ?? null,
          matchedYears,
          joinBasis
        },
        subjectEntityId: election.id,
        relatedEntityIds: [project.id],
        evidenceObservationIds: [
          ...(observationIndex.get(project.id) ?? []).map(obs => obs.id),
          ...(observationIndex.get(election.id) ?? []).map(obs => obs.id)
        ],
        payload: {
          statement: "An election record, project and named contractor intersect on documented jurisdiction and year.",
          election: {
            canonicalKey: election.canonicalKey,
            entityId: election.id,
            fullName: election.data?.fullName ?? election.data?.candidateName ?? null,
            position: election.data?.position ?? null,
            year: toNumber(election.data?.year)
          },
          project: {
            canonicalKey: project.canonicalKey,
            entityId: project.id,
            contractId: project.data?.contractId ?? null,
            description: project.data?.description ?? null,
            contractor: project.data?.contractor ?? null,
            contractorIdentityKey: contractor?.key ?? null,
            contractorIdentityBasis: contractor?.basis ?? null
          },
          matchedYears,
          joinBasis,
          interpretationLimit: "This is an intersection lead only. It does not establish any relationship between the office-holder and contractor beyond the shared project context."
        }
      });
    });
}

export function runCorrelationRules(snapshot) {
  const observationIndex = createObservationIndex(snapshot);

  return [
    ...findProjectStatusHistories(snapshot, observationIndex),
    ...findProjectSourceDivergence(snapshot, observationIndex),
    ...findContractorPortfolios(snapshot, observationIndex),
    ...findElectionProjectOverlaps(snapshot, observationIndex),
    ...findElectionProjectContractorOverlaps(snapshot, observationIndex)
  ];
}
