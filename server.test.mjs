import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "./server.mjs";

test("serves state from sqlite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-"));
  const server = createApp({ databasePath: join(directory, "test.sqlite") });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state = await response.json();

    assert.equal(response.status, 200);
    assert.equal(state.message, "hello, ai world");
    assert.ok(state.bornAt);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
