import { randomUUID } from "node:crypto";
import { sha256 } from "../ingestion/hash.js";
import {
  normalizeName,
  normalizePlace,
  normalizePosition,
  organizationIdentityKey,
  personLocalityKey
} from "./normalize.js";

export const ENTITY_RESOLUTION_ENGINE_VERSION = "1.0.0";

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function observationsFor(observationIndex, entityId, type) {
  return (observationIndex.get(entityId) ?? []).filter(row => !type || row.recordType === type);
}

function createObservationIndex(snapshot) {
  const index = new Map();
  for (const row of snapshot.observations) {
    const list = index.get(row.entityId) ?? [];
    list.push(row);
    index.set(row.entityId, list);
  }
  return index;
}

function makePersonIdentity(entity, observationIndex) {
  const data = entity.data ?? {};
  const name = data.fullName ?? data.candidateName;
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;

  return {
    id: "election:" + entity.id,
    identityType: "person",
    entityId: entity.id,
    sourceId: observationsFor(observationIndex, entity.id, "election_result")[0]?.sourceId ?? null,
    sourceRecordId: entity.canonicalKey,
    identityKey: "person-name:" + normalizedName,
    normalizedName,
    city: normalizePlace(data.city),
    province: normalizePlace(data.province),
    localityKey: personLocalityKey({ city: data.city, province: data.province }),
    position: normalizePosition(data.position),
    year: toNumber(data.year),
    externalId: clean(data.personId ?? data.candidateId ?? data.externalId) || null,
    basis: "source_election_record",
    data: {
      fullName: name,
      firstName: data.firstName ?? null,
      middleName: data.middleName ?? null,
      lastName: data.lastName ?? null,
      party: data.party ?? null,
      sex: data.sex ?? null,
      city: data.city ?? null,
      province: data.province ?? null,
      position: data.position ?? null,
      year: toNumber(data.year)
    }
  };
}

function makeProjectOrganizationIdentity(entity, observationIndex) {
  const data = entity.data ?? {};
  const identity = organizationIdentityKey({ name: data.contractor, pcabId: data.pcabId });
  if (!identity) return null;

  return {
    id: "project-contractor:" + entity.id,
    identityType: "organization",
    entityId: entity.id,
    sourceId: observationsFor(observationIndex, entity.id, "project")[0]?.sourceId ?? null,
    sourceRecordId: data.contractId ?? entity.canonicalKey,
    identityKey: identity.key,
    normalizedName: normalizeName(data.contractor),
    organizationName: data.contractor,
    externalId: clean(data.pcabId) || null,
    basis: identity.basis,
    data: {
      role: "contractor",
      contractId: data.contractId ?? null,
      contractor: data.contractor ?? null,
      pcabId: data.pcabId ?? null
    }
  };
}

function makeProcurementOrganizationIdentities(entity, observationIndex) {
  const data = entity.data ?? {};
  const out = [];

  for (const item of [
    ["awardee", data.awardee],
    ["procuring_entity", data.procuringEntity]
  ]) {
    const role = item[0];
    const value = item[1];
    const identity = organizationIdentityKey({ name: value });
    if (!identity) continue;

    out.push({
      id: "procurement-" + role + ":" + entity.id,
      identityType: "organization",
      entityId: entity.id,
      sourceId: observationsFor(observationIndex, entity.id, "procurement_event")[0]?.sourceId ?? null,
      sourceRecordId: data.referenceNumber ?? entity.canonicalKey,
      identityKey: identity.key,
      normalizedName: normalizeName(value),
      organizationName: value,
      externalId: null,
      basis: identity.basis,
      data: {
        role,
        referenceNumber: data.referenceNumber ?? null,
        title: data.title ?? null
      }
    });
  }

  return out;
}

function buildIdentityRecords(snapshot, observationIndex) {
  const records = [];

  for (const entity of snapshot.entities) {
    if (entity.entityType === "election_result") {
      const record = makePersonIdentity(entity, observationIndex);
      if (record) records.push(record);
      continue;
    }

    if (entity.entityType === "project") {
      const record = makeProjectOrganizationIdentity(entity, observationIndex);
      if (record) records.push(record);
      continue;
    }

    if (entity.entityType === "procurement_event") {
      records.push(...makeProcurementOrganizationIdentities(entity, observationIndex));
    }
  }

  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function identityEvidence(record, observationIndex) {
  const type = record.identityType === "person" ? "election_result" : undefined;
  return observationsFor(observationIndex, record.entityId, type).map(row => row.id);
}

function candidateBasis(left, right) {
  if (left.identityType !== right.identityType) return null;

  if (left.identityType === "organization") {
    if (left.externalId && right.externalId && left.externalId === right.externalId) {
      return {
        status: "VERIFIED_FACT",
        basis: "shared_external_identifier",
        statement: "These organization identity records share the same explicit external identifier.",
        interpretationLimit: null
      };
    }

    if (!left.externalId && !right.externalId &&
        left.normalizedName && left.normalizedName === right.normalizedName) {
      return {
        status: "INFERENCE_LEAD",
        basis: "normalized_organization_name",
        statement: "These organization records have the same normalized name and require legal-entity review.",
        interpretationLimit: "Name normalization alone does not prove that two source records refer to the same legal organization."
      };
    }

    return null;
  }

  if (left.identityKey !== right.identityKey) return null;

  if (left.externalId && right.externalId && left.externalId === right.externalId) {
    return {
      status: "VERIFIED_FACT",
      basis: "shared_source_person_identifier",
      statement: "These person identity records share the same explicit source person identifier.",
      interpretationLimit: null
    };
  }

  if (left.localityKey && right.localityKey && left.localityKey === right.localityKey) {
    const samePosition = left.position && right.position && left.position === right.position;
    return {
      status: "INFERENCE_LEAD",
      basis: samePosition ? "exact_name_locality_position" : "exact_name_locality",
      statement: "These source person records match on documented identity keys and require identity review.",
      interpretationLimit: "Identical normalized names and locality context are not sufficient by themselves to establish that two source records represent the same real-world person."
    };
  }

  return null;
}

function pairKey(left, right) {
  return [left.id, right.id].sort().join("::");
}

function canonicalOrganizationEntities(identityRecords) {
  const byKey = new Map();

  for (const record of identityRecords) {
    if (record.identityType !== "organization" || !record.externalId) continue;
    if (byKey.has(record.identityKey)) continue;

    byKey.set(record.identityKey, {
      id: randomUUID(),
      entityType: "organization",
      canonicalKey: "resolved:" + record.identityKey,
      label: record.organizationName || record.identityKey,
      resolutionStatus: "VERIFIED_BY_IDENTIFIER",
      data: {
        identityKey: record.identityKey,
        identifierType: "pcab_id",
        identifier: record.externalId,
        displayName: record.organizationName || null,
        identityRule: "shared_external_identifier"
      }
    });
  }

  return [...byKey.values()];
}

export function runEntityResolution({ snapshot, maxCandidates } = {}) {
  if (!snapshot || !Array.isArray(snapshot.entities) ||
      !Array.isArray(snapshot.observations) || !Array.isArray(snapshot.edges)) {
    throw new Error("Entity resolution requires entities, observations, and edges arrays.");
  }

  const observationIndex = createObservationIndex(snapshot);
  const identityRecords = buildIdentityRecords(snapshot, observationIndex);
  const resolvedEntities = canonicalOrganizationEntities(identityRecords);
  const candidates = [];

  for (let i = 0; i < identityRecords.length; i += 1) {
    for (let j = i + 1; j < identityRecords.length; j += 1) {
      const left = identityRecords[i];
      const right = identityRecords[j];
      const basis = candidateBasis(left, right);
      if (!basis) continue;

      const ordered = left.id.localeCompare(right.id) <= 0
        ? [left, right]
        : [right, left];
      const fingerprint = sha256({
        engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
        pairKey: pairKey(ordered[0], ordered[1]),
        basis: basis.basis
      });

      candidates.push({
        id: null,
        fingerprint,
        identityRecordIds: ordered.map(item => item.id),
        status: basis.status,
        basis: basis.basis,
        evidenceObservationIds: [
          ...identityEvidence(ordered[0], observationIndex),
          ...identityEvidence(ordered[1], observationIndex)
        ],
        payload: {
          statement: basis.statement,
          identityType: ordered[0].identityType,
          basis: basis.basis,
          left: {
            id: ordered[0].id,
            entityId: ordered[0].entityId,
            sourceId: ordered[0].sourceId,
            sourceRecordId: ordered[0].sourceRecordId,
            name: ordered[0].data?.fullName ?? ordered[0].organizationName ?? null,
            normalizedName: ordered[0].normalizedName,
            localityKey: ordered[0].localityKey ?? null,
            position: ordered[0].position ?? null,
            year: ordered[0].year ?? null,
            externalId: ordered[0].externalId ?? null
          },
          right: {
            id: ordered[1].id,
            entityId: ordered[1].entityId,
            sourceId: ordered[1].sourceId,
            sourceRecordId: ordered[1].sourceRecordId,
            name: ordered[1].data?.fullName ?? ordered[1].organizationName ?? null,
            normalizedName: ordered[1].normalizedName,
            localityKey: ordered[1].localityKey ?? null,
            position: ordered[1].position ?? null,
            year: ordered[1].year ?? null,
            externalId: ordered[1].externalId ?? null
          },
          interpretationLimit: basis.interpretationLimit
        }
      });
    }
  }

  candidates.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  const limit = maxCandidates == null ? null : Math.max(Math.floor(Number(maxCandidates)), 0);
  const limitedCandidates = limit == null ? candidates : candidates.slice(0, limit);

  return {
    run: {
      id: randomUUID(),
      engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION,
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      identityRecordCount: identityRecords.length,
      candidateCount: limitedCandidates.length,
      verifiedIdentifierCount: resolvedEntities.length,
      errors: []
    },
    identityRecords,
    resolvedEntities,
    candidates: limitedCandidates
  };
}

export async function executeEntityResolutionRun({ store, maxCandidates } = {}) {
  const required = [
    "getResolutionSnapshot",
    "startResolutionRun",
    "upsertResolvedEntity",
    "insertResolutionIdentityRecord",
    "insertResolutionCandidate",
    "completeResolutionRun",
    "failResolutionRun"
  ];

  for (const method of required) {
    if (typeof store?.[method] !== "function") {
      throw new Error("Resolution store is missing required method: " + method);
    }
  }

  const snapshot = await store.getResolutionSnapshot();
  const runId = randomUUID();

  await store.startResolutionRun({
    id: runId,
    engineVersion: ENTITY_RESOLUTION_ENGINE_VERSION
  });

  try {
    const result = runEntityResolution({ snapshot, maxCandidates });
    const resolvedEntityIds = new Map();

    for (const entity of result.resolvedEntities) {
      const stored = await store.upsertResolvedEntity(entity);
      resolvedEntityIds.set(entity.canonicalKey, stored.id);
    }

    const identityIds = new Map();
    for (const identity of result.identityRecords) {
      const stored = await store.insertResolutionIdentityRecord(runId, identity);
      identityIds.set(identity.id, stored.id);
    }

    for (const candidate of result.candidates) {
      await store.insertResolutionCandidate(runId, {
        ...candidate,
        identityRecordIds: candidate.identityRecordIds
          .map(id => identityIds.get(id))
          .filter(Boolean),
        resolvedEntityIds: candidate.resolvedEntityIds
          ? candidate.resolvedEntityIds.map(id => resolvedEntityIds.get(id)).filter(Boolean)
          : []
      });
    }

    return await store.completeResolutionRun(runId, {
      identityRecordCount: result.run.identityRecordCount,
      candidateCount: result.run.candidateCount,
      verifiedIdentifierCount: result.run.verifiedIdentifierCount,
      errors: []
    });
  } catch (error) {
    await store.failResolutionRun(runId, error);
    throw error;
  }
}
