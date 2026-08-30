import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { productHash } from "./product-hash.mjs";

const releaseId = process.argv[2];
if (!releaseId || !/^[a-z0-9][a-z0-9-]*$/.test(releaseId)) {
  throw new Error("usage: node scripts/verify-release.mjs <release-id>");
}

const release = JSON.parse(readFileSync(`releases/${releaseId}.json`, "utf8"));
if (release.id !== releaseId) throw new Error("release id does not match its filename");
if (release.productSha256) {
  const actual = productHash();
  if (actual !== release.productSha256) {
    throw new Error(`product tree is ${actual}; ${releaseId} requires ${release.productSha256}`);
  }
  console.log(`${releaseId} matches the complete product tree (${actual})`);
} else {
  const actual = createHash("sha256").update(readFileSync("world/index.html")).digest("hex");
  if (actual !== release.worldSha256) {
    throw new Error(`world/index.html is ${actual}; ${releaseId} requires ${release.worldSha256}`);
  }
  console.log(`${releaseId} matches legacy world/index.html (${actual})`);
}
