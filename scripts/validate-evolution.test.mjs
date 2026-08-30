import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const validator = join(dirname(fileURLToPath(import.meta.url)), "validate-evolution.mjs");

function write(root, path, contents) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hello-ai-world-evolution-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  write(root, "world/index.html", "<!doctype html><title>seed</title>\n");
  write(root, "AGENTS.md", "trusted policy\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  return root;
}

function validate(root) {
  git(root, "add", "-A");
  return spawnSync(process.execPath, [validator, "--base", "HEAD", "--include-worktree"], {
    cwd: root,
    encoding: "utf8",
  });
}

test("accepts a prompt plus multi-file monorepo evolution", () => {
  const root = fixture();
  try {
    write(root, "proposals/visitors/prompt.md", "Add a visitor book.\n");
    write(root, "apps/web/index.js", "export const greeting = 'hello';\n");
    write(root, "apps/api/index.js", "export const visitors = [];\n");
    write(root, "packages/shared/index.js", "export const version = 1;\n");
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /monorepo candidate evolution accepted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects control-plane changes", () => {
  const root = fixture();
  try {
    write(root, "proposals/visitors/prompt.md", "Add a visitor book.\n");
    write(root, "apps/web/index.js", "export const greeting = 'hello';\n");
    write(root, ".github/workflows/backdoor.yml", "on: push\n");
    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /protected paths changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
