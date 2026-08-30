import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex === -1 ? "origin/staging" : process.argv[baseIndex + 1];
if (!base) throw new Error("--base requires a git ref");

const changed = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
  { encoding: "utf8" },
).trim().split("\n").filter(Boolean);

const promptPaths = changed.filter((path) => /^proposals\/[a-z0-9][a-z0-9-]*\/prompt\.md$/.test(path));
const allowed = new Set([...promptPaths, "world/index.html"]);
const unexpected = changed.filter((path) => !allowed.has(path));

if (promptPaths.length !== 1) {
  throw new Error(`an evolution must contain exactly one proposals/<slug>/prompt.md; found ${promptPaths.length}`);
}
if (unexpected.length) throw new Error(`protected paths changed: ${unexpected.join(", ")}`);
if (!new Set([1, 2]).has(changed.length)) throw new Error("only the prompt, or prompt plus world/index.html, may change");

const prompt = readFileSync(promptPaths[0], "utf8").trim();
if (!prompt || [...prompt].length > 2_000) throw new Error("prompt must contain 1-2000 characters");

if (changed.includes("world/index.html")) {
  const html = readFileSync("world/index.html", "utf8");
  if (Buffer.byteLength(html) > 100_000) throw new Error("world/index.html exceeds 100 KB");
  if (!/^\s*<!doctype html>/i.test(html)) throw new Error("world/index.html must be a standalone HTML document");
  const forbidden = [
    /\bfetch\s*\(/i,
    /\bXMLHttpRequest\b/i,
    /\bWebSocket\b/i,
    /\bEventSource\b/i,
    /\bsendBeacon\b/i,
    /<\s*(?:iframe|object|embed|base|form)\b/i,
    /<\s*(?:script|link|img|audio|video|source)\b[^>]*(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i,
    /url\(\s*["']?\s*(?:https?:)?\/\//i,
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
  ];
  const violation = forbidden.find((pattern) => pattern.test(html));
  if (violation) throw new Error(`world/index.html violates the no-network sandbox policy: ${violation}`);
}

console.log(changed.includes("world/index.html") ? "candidate evolution accepted" : "prompt-only proposal accepted");
