import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const releaseId = process.argv[2];
if (!releaseId || !/^[a-z0-9][a-z0-9-]*$/.test(releaseId)) {
  throw new Error("usage: node scripts/verify-release.mjs <release-id>");
}

const release = JSON.parse(readFileSync(`releases/${releaseId}.json`, "utf8"));
if (release.id !== releaseId) throw new Error("release id does not match its filename");
const actual = createHash("sha256").update(readFileSync("world/index.html")).digest("hex");
if (actual !== release.worldSha256) {
  throw new Error(`world/index.html is ${actual}; ${releaseId} requires ${release.worldSha256}`);
}
console.log(`${releaseId} matches world/index.html (${actual})`);
