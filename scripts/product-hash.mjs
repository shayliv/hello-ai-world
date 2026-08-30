import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const controlPlane = [
  /^\.github\//,
  /^opencode\.json$/,
  /^\.gitmodules$/,
  /^Dockerfile$/,
  /^\.dockerignore$/,
  /^(?:AGENTS|CONTRIBUTING|OPERATIONS|README|HISTORY)\.md$/,
  /^scripts\/(?:validate-evolution|validate-evolution\.test|check-classifier|classify-candidate|product-hash|render-ledger|verify-release)\.mjs$/,
  /^(?:proposals|state|cycles|releases)\//,
  /^docs\/previews\//,
];

export function isProductPath(path) {
  return !controlPlane.some((pattern) => pattern.test(path));
}

export function productHash(paths = null) {
  const tracked = paths ?? execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const hash = createHash("sha256");
  for (const path of tracked.filter(isProductPath).sort()) {
    const contents = readFileSync(path);
    const pathBytes = Buffer.from(path);
    const header = Buffer.alloc(16);
    header.writeBigUInt64BE(BigInt(pathBytes.length), 0);
    header.writeBigUInt64BE(BigInt(contents.length), 8);
    hash.update(header).update(pathBytes).update(contents);
  }
  return hash.digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(productHash());
