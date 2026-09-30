import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
if (matches.length !== 1) throw new Error(`Expected exactly one inline app script, found ${matches.length}.`);
new vm.Script(matches[0][1], { filename: "index.html" });

for (const legacy of ["/api/resolution", "./api/resolution.js", "./api/entities.js", "./api/entity.js", "./api/evidence.js"]) {
  if (html.includes(legacy)) throw new Error(`Legacy/extension API reference remains in UI: ${legacy}`);
}

for (const required of ["./api/health","./api/entities","./api/entity","./api/evidence","./api/entity-resolution"]) {
  if (!html.includes(required)) throw new Error(`Missing expected API route reference: ${required}`);
}

console.log("BantayLink evidence UI syntax checks passed.");
