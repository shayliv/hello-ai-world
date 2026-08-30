import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "classifier.json";
const verdict = JSON.parse(readFileSync(path, "utf8"));
if (typeof verdict.approved !== "boolean" || typeof verdict.summary !== "string"
  || !Array.isArray(verdict.security_findings)) {
  throw new Error("classifier output does not match the required shape");
}
if (!verdict.approved || verdict.security_findings.length) {
  console.error(JSON.stringify(verdict, null, 2));
  throw new Error("independent classifier rejected the candidate");
}
console.log(`classifier approved: ${verdict.summary}`);
