import assert from "node:assert/strict";
import { parseCsv } from "../src/ingestion/csv.js";
import { normalizeWinner, normalizeVote } from "../src/adapters/openhalalan.js";
import { normalizeDpwhProject } from "../src/adapters/dpwh.js";

const csv = 'Last Name,First Name,Full Name,Position,Year\nDOE,JOHN,"DOE, JOHN",MAYOR,2025\n';
const parsed = parseCsv(csv);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]["Full Name"], "DOE, JOHN");

const winner = normalizeWinner({
  "Last Name": "DOE",
  "First Name": "JOHN",
  "Middle Name": "SMITH",
  "Full Name": "DOE, JOHN SMITH",
  Position: "MAYOR",
  Party: "IND",
  Year: "2025",
  Province: "TEST",
  City: "TEST",
  Region: "TEST",
  Sex: "M",
  "Middle Name Source": "original",
  "Sex Source": "prior"
}, "hash-winner");
assert.equal(winner.entities[0].entityType, "election_result");
assert.equal(winner.entities[0].observations[0].sourceRecordId, winner.entities[0].canonicalKey);
assert.equal(winner.entities[0].data.year, 2025);

const vote = normalizeVote({
  year: "2025",
  region: "TEST",
  province: "TEST",
  city: "TEST",
  position: "MAYOR",
  candidate_name: "DOE, JOHN",
  party: "IND",
  votes: "1234",
  percentage: "61.2",
  rank: "2",
  is_national_race: "false",
  is_geographic: "true"
}, "hash-vote");
assert.equal(vote.entities[0].data.votes, 1234);

const project = normalizeDpwhProject({
  contractId: "25AA0001",
  description: "TEST PROJECT",
  category: "Roads",
  status: "Suspended",
  infraType: "Roads",
  budget: 1000,
  progress: 25,
  location: { region: "Region I" },
  contractor: "TEST BUILDER",
  completionDate: "2026-01-01"
}, "hash-project");
assert.equal(project.entities[0].entityType, "project");
assert.equal(project.entities[0].canonicalKey, "dpwh-contract:25AA0001");
assert.deepEqual(project.entities[0].data.signals, ["suspended"]);
assert.equal(project.entities[0].data.infraType, "Roads");

console.log("Adapter normalization checks passed.");
