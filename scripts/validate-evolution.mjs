import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex === -1 ? "origin/staging" : process.argv[baseIndex + 1];
if (!base) throw new Error("--base requires a git ref");
const includeWorktree = process.argv.includes("--include-worktree");
const comparison = includeWorktree ? base : `${base}...HEAD`;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 10_000_000 });
const changed = git("diff", "--name-only", "--diff-filter=ACMRD", comparison)
  .trim().split("\n").filter(Boolean);
const promptPattern = /^proposals\/[a-z0-9][a-z0-9-]*\/prompt\.md$/;
const promptPaths = changed.filter((path) => promptPattern.test(path));

if (promptPaths.length !== 1) {
  throw new Error(`an evolution must contain exactly one proposals/<slug>/prompt.md; found ${promptPaths.length}`);
}
const promptPath = promptPaths[0];
if (!existsSync(promptPath)) throw new Error("the selected proposal prompt may not be deleted");

const protectedPaths = [
  /^\.github\//,
  /^opencode\.json$/,
  /^\.gitmodules$/,
  /^Dockerfile$/,
  /^\.dockerignore$/,
  /^(?:AGENTS|CONTRIBUTING|OPERATIONS|README|HISTORY)\.md$/,
  /^scripts\/(?:validate-evolution|validate-evolution\.test|check-classifier|classify-candidate|product-hash|render-ledger|verify-release)\.mjs$/,
  /^(?:state|cycles|releases)\//,
  /^docs\/previews\//,
];
const protectedChanges = changed.filter((path) => path !== promptPath && (
  path.startsWith("proposals/") || protectedPaths.some((pattern) => pattern.test(path))
));
if (protectedChanges.length) throw new Error(`protected paths changed: ${protectedChanges.join(", ")}`);

if (changed.length > 250) throw new Error("candidate changes more than 250 files");
const productPaths = changed.filter((path) => path !== promptPath);
const prompt = readFileSync(promptPath, "utf8").trim();
if (!prompt || [...prompt].length > 2_000) throw new Error("prompt must contain 1-2000 characters");

const credentialName = /(^|\/)(?:\.env(?:\..+)?|credentials?(?:\..+)?|[^/]+\.(?:pem|p12|pfx|key))$/i;
const forbiddenCredentials = productPaths.filter((path) => credentialName.test(path));
if (forbiddenCredentials.length) {
  throw new Error(`credential-like files are forbidden: ${forbiddenCredentials.join(", ")}`);
}

let totalBytes = 0;
for (const path of productPaths) {
  if (!existsSync(path)) continue;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`symbolic links are forbidden in candidates: ${path}`);
  if (stat.isFile()) totalBytes += stat.size;
  const indexEntry = git("ls-files", "-s", "--", path).trim();
  if (indexEntry && !/^(?:100644|100755)\s/.test(indexEntry)) {
    throw new Error(`unsupported git object mode in candidate: ${path}`);
  }
}
if (totalBytes > 5_000_000) throw new Error("candidate product files exceed the 5 MB per-evolution budget");

const numstat = git("diff", "--numstat", comparison).trim().split("\n").filter(Boolean);
let changedLines = 0;
for (const line of numstat) {
  const [added, deleted] = line.split("\t");
  if (added !== "-" && deleted !== "-") changedLines += Number(added) + Number(deleted);
}
if (changedLines > 50_000) throw new Error("candidate exceeds the 50,000 changed-line budget");
const textDiffBytes = Buffer.byteLength(git("diff", "--no-ext-diff", comparison));
if (textDiffBytes > 2_000_000) throw new Error("candidate text diff exceeds the 2 MB classifier budget");

console.log(productPaths.length ? "monorepo candidate evolution accepted" : "prompt-only proposal accepted");
