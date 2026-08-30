import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "./server.mjs";

const adminToken = "test-admin-token";
const voterCookieSecret = "deterministic-test-cookie-secret";

async function start(options = {}) {
  const server = createApp({ adminToken, voterCookieSecret, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function json(baseUrl, path, { method = "GET", body, admin = false, cookie } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (admin) headers.authorization = `Bearer ${adminToken}`;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0],
  };
}

test("candidate mode serves only the world and health without touching storage", async () => {
  let storageTouched = false;
  const app = await start({
    mode: "candidate",
    storageFactory() {
      storageTouched = true;
      throw new Error("candidate mode touched storage");
    },
  });

  try {
    const world = await fetch(`${app.baseUrl}/`);
    assert.equal(world.status, 200);
    assert.match(await world.text(), /hello, ai world/);
    assert.match(world.headers.get("content-security-policy"), /frame-ancestors http: https:/);
    const health = await json(app.baseUrl, "/healthz");
    assert.deepEqual(health.body, { ok: true, mode: "candidate" });
    assert.equal((await fetch(`${app.baseUrl}/api/state`)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/app.js`)).status, 404);
    assert.equal(storageTouched, false);
  } finally {
    await app.close();
  }
});

test("candidate mode does not create a database file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-candidate-"));
  const databasePath = join(directory, "must-not-exist.sqlite");
  const app = await start({ mode: "candidate", databasePath });
  try {
    await fetch(`${app.baseUrl}/healthz`);
    assert.equal(existsSync(databasePath), false);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("proposal validation is prompt-only and bounded", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-validation-"));
  const app = await start({ databasePath: join(directory, "test.sqlite") });
  try {
    for (const body of [
      { prompt: "" },
      { prompt: "x".repeat(2_001) },
      { prompt: "valid", html: "<b>not allowed</b>" },
    ]) {
      const result = await json(app.baseUrl, "/api/proposals", { method: "POST", body });
      assert.equal(result.response.status, 400);
    }
    const accepted = await json(app.baseUrl, "/api/proposals", {
      method: "POST",
      body: { prompt: "<img src=x onerror=alert(1)>" },
    });
    assert.equal(accepted.response.status, 201);
    assert.equal(accepted.body.proposal.prompt, "<img src=x onerror=alert(1)>");
    const script = await (await fetch(`${app.baseUrl}/app.js`)).text();
    assert.match(script, /\.textContent = text/);
    assert.doesNotMatch(script, /innerHTML/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lifecycle rejects duplicate votes, selects a winner, and writes immutable history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-lifecycle-"));
  const databasePath = join(directory, "test.sqlite");
  const app = await start({ databasePath });
  const adminPost = (path, body = {}) => json(app.baseUrl, path, { method: "POST", body, admin: true });

  try {
    const unauthorized = await json(app.baseUrl, "/api/admin/cycles", {
      method: "POST",
      body: { label: "Cycle 1" },
    });
    assert.equal(unauthorized.response.status, 401);

    const proposalOne = await json(app.baseUrl, "/api/proposals", {
      method: "POST", body: { prompt: "make the greeting blue" },
    });
    const proposalTwo = await json(app.baseUrl, "/api/proposals", {
      method: "POST", body: { prompt: "add a small orbit" },
    });
    const cycle = await adminPost("/api/admin/cycles", { label: "Cycle 1" });
    const cycleId = cycle.body.cycle.id;

    const candidateOne = await adminPost(`/api/admin/cycles/${cycleId}/candidates`, {
      proposalId: proposalOne.body.proposal.id,
      previewUrl: "https://candidate-one.example/world/index.html",
      metadata: "first build <not markup>",
    });
    const candidateTwo = await adminPost(`/api/admin/cycles/${cycleId}/candidates`, {
      proposalId: proposalTwo.body.proposal.id,
      previewUrl: "https://candidate-two.example/world/index.html",
      metadata: "second build",
    });
    assert.equal(candidateOne.response.status, 201);
    assert.equal(candidateTwo.response.status, 201);

    const firstVote = await json(app.baseUrl, `/api/cycles/${cycleId}/votes`, {
      method: "POST", body: { candidateId: candidateOne.body.candidate.id },
    });
    assert.equal(firstVote.response.status, 201);
    assert.match(firstVote.response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(firstVote.response.headers.get("set-cookie"), /SameSite=Strict/);

    const duplicate = await json(app.baseUrl, `/api/cycles/${cycleId}/votes`, {
      method: "POST",
      body: { candidateId: candidateTwo.body.candidate.id },
      cookie: firstVote.cookie,
    });
    assert.equal(duplicate.response.status, 409);
    assert.match(duplicate.body.error, /already voted/);

    for (let index = 0; index < 2; index += 1) {
      const vote = await json(app.baseUrl, `/api/cycles/${cycleId}/votes`, {
        method: "POST", body: { candidateId: candidateTwo.body.candidate.id },
      });
      assert.equal(vote.response.status, 201);
    }

    const closed = await adminPost(`/api/admin/cycles/${cycleId}/close`);
    assert.equal(closed.body.cycle.status, "closed");
    assert.equal(closed.body.cycle.winnerCandidateId, candidateTwo.body.candidate.id);
    assert.deepEqual(closed.body.cycle.candidates.map((candidate) => candidate.votes), [1, 2]);
    const lateVote = await json(app.baseUrl, `/api/cycles/${cycleId}/votes`, {
      method: "POST", body: { candidateId: candidateOne.body.candidate.id },
    });
    assert.equal(lateVote.response.status, 409);

    const promoted = await adminPost(`/api/admin/cycles/${cycleId}/promote`);
    const promotedAgain = await adminPost(`/api/admin/cycles/${cycleId}/promote`);
    assert.equal(promoted.body.release.candidateId, candidateTwo.body.candidate.id);
    assert.deepEqual(promotedAgain.body.release, promoted.body.release);

    const state = await json(app.baseUrl, "/api/state");
    assert.equal(state.body.history.length, 1);
    assert.equal(state.body.history[0].prompt, "add a small orbit");
    assert.equal(state.body.currentProduction.previewUrl, "https://candidate-two.example/world/index.html");
    assert.equal(state.body.cycle.status, "promoted");

    const database = new DatabaseSync(databasePath);
    assert.throws(() => database.prepare("UPDATE releases SET prompt = 'changed' WHERE id = 1").run(), /releases are immutable/);
    assert.throws(() => database.prepare("DELETE FROM releases WHERE id = 1").run(), /releases are immutable/);
    database.close();
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("zero-vote ties select the earliest candidate and history is linear", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-tie-"));
  const app = await start({ databasePath: join(directory, "test.sqlite") });
  const post = (path, body = {}, admin = false) => json(app.baseUrl, path, { method: "POST", body, admin });
  try {
    const p1 = await post("/api/proposals", { prompt: "one" });
    const p2 = await post("/api/proposals", { prompt: "two" });
    const cycle = await post("/api/admin/cycles", { label: "Tie" }, true);
    const c1 = await post(`/api/admin/cycles/${cycle.body.cycle.id}/candidates`, {
      proposalId: p1.body.proposal.id, previewUrl: "https://first.example/",
    }, true);
    await post(`/api/admin/cycles/${cycle.body.cycle.id}/candidates`, {
      proposalId: p2.body.proposal.id, previewUrl: "https://second.example/",
    }, true);
    const close = await post(`/api/admin/cycles/${cycle.body.cycle.id}/close`, {}, true);
    assert.equal(close.body.cycle.winnerCandidateId, c1.body.candidate.id);
    await post(`/api/admin/cycles/${cycle.body.cycle.id}/promote`, {}, true);

    const secondCycle = await post("/api/admin/cycles", { label: "Next" }, true);
    const secondCandidate = await post(`/api/admin/cycles/${secondCycle.body.cycle.id}/candidates`, {
      proposalId: p2.body.proposal.id, previewUrl: "https://third.example/",
    }, true);
    await post(`/api/admin/cycles/${secondCycle.body.cycle.id}/close`, {}, true);
    await post(`/api/admin/cycles/${secondCycle.body.cycle.id}/promote`, {}, true);
    const state = await json(app.baseUrl, "/api/state");
    assert.deepEqual(state.body.history.map((release) => release.id), [1, 2]);
    assert.equal(state.body.currentProduction.previewUrl, secondCandidate.body.candidate.previewUrl);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("health and platform responses carry security headers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hello-ai-world-headers-"));
  const app = await start({ databasePath: join(directory, "test.sqlite") });
  try {
    const health = await fetch(`${app.baseUrl}/healthz`);
    assert.deepEqual(await health.json(), { ok: true, mode: "platform" });
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("referrer-policy"), "no-referrer");
    assert.match(health.headers.get("permissions-policy"), /camera=\(\)/);
    const wrapper = await fetch(`${app.baseUrl}/`);
    assert.match(wrapper.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(await wrapper.text(), /sandbox="allow-scripts"/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
