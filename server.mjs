import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTournamentStore } from "./storage/index.mjs";
import { StoreError } from "./storage/sqlite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const files = {
  world: readFileSync(join(here, "world", "index.html")),
};

const limits = { prompt: 2_000, label: 120, metadata: 1_000, body: 16_384 };

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType });
  response.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

function sendError(response, status, message) {
  send(response, status, { error: message });
}

function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function boundedString(value, name, maximum) {
  if (typeof value !== "string") throw new RequestError(400, `${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new RequestError(400, `${name} is required`);
  if ([...normalized].length > maximum) {
    throw new RequestError(400, `${name} must be at most ${maximum} characters`);
  }
  return normalized;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RequestError(400, `${name} must be a positive integer`);
  }
  return value;
}

function previewUrl(value, requestOrigin) {
  const normalized = boundedString(value, "previewUrl", 2_048);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new RequestError(400, "previewUrl must be an absolute URL");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new RequestError(400, "previewUrl must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username || url.password || url.origin === requestOrigin) {
    throw new RequestError(400, "previewUrl must be a credential-free cross-origin URL");
  }
  return url.href;
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "content-type must be application/json");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limits.body) throw new RequestError(413, "request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "request body must be valid JSON");
  }
}

function cookieValue(request, name) {
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function readVoter(request, secret) {
  const encoded = cookieValue(request, "voter");
  if (!encoded) return null;
  const separator = encoded.lastIndexOf(".");
  if (separator < 1) return null;
  const voterId = encoded.slice(0, separator);
  const supplied = Buffer.from(encoded.slice(separator + 1));
  const expected = Buffer.from(signature(voterId, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return voterId;
}

function voterForVote(request, response, secret) {
  const existing = readVoter(request, secret);
  if (existing) return existing;
  const voterId = randomUUID();
  const secure = process.env.NODE_ENV === "production"
    || request.headers["x-forwarded-proto"] === "https";
  response.setHeader(
    "set-cookie",
    `voter=${voterId}.${signature(voterId, secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? "; Secure" : ""}`,
  );
  return voterId;
}

function authorized(request, adminToken) {
  if (!adminToken) return false;
  const supplied = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const actualBuffer = Buffer.from(adminToken);
  const suppliedBuffer = Buffer.from(supplied);
  return actualBuffer.length === suppliedBuffer.length
    && timingSafeEqual(actualBuffer, suppliedBuffer);
}

function baseHeaders(response, { embeddable = false } = {}) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("content-security-policy", embeddable
    ? "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors http: https:"
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function originFor(request) {
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${request.headers.host}`;
}

export function createApp({
  mode = process.env.APP_MODE ?? "platform",
  databasePath,
  databaseBackend,
  storageFactory = createTournamentStore,
  adminToken = process.env.ADMIN_TOKEN ?? "",
  voterCookieSecret = process.env.VOTER_COOKIE_SECRET
    ?? (process.env.NODE_ENV === "production" ? "" : "local-development-only"),
} = {}) {
  if (!new Set(["platform", "candidate"]).has(mode)) {
    throw new Error("APP_MODE must be platform or candidate");
  }
  const selectedBackend = databaseBackend ?? process.env.DATABASE_BACKEND ?? "sqlite";
  if (mode === "platform" && selectedBackend !== "repository" && process.env.NODE_ENV === "production") {
    if (!adminToken) throw new Error("ADMIN_TOKEN is required in production platform mode");
    if (!voterCookieSecret) {
      throw new Error("VOTER_COOKIE_SECRET is required in production platform mode");
    }
  }

  // Candidate mode branches before storage construction by design.
  const store = mode === "platform"
    ? storageFactory({ backend: selectedBackend, databasePath })
    : null;

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof RequestError) {
        sendError(response, error.status, error.message);
        return;
      }
      if (error instanceof StoreError) {
        sendError(response, error.code === "not_found" ? 404 : 409, error.message);
        return;
      }
      console.error(error);
      sendError(response, 500, "internal server error");
    });
  });

  async function handle(request, response) {
    const path = new URL(request.url, "http://request.invalid").pathname;
    const worldRequest = path === "/" || path === "/index.html" || path === "/world/index.html";
    baseHeaders(response, { embeddable: worldRequest });

    if (request.method === "GET" && (path === "/healthz" || path === "/api/health")) {
      send(response, 200, { ok: true, mode });
      return;
    }
    if (worldRequest && request.method === "GET") {
      send(response, 200, files.world, "text/html; charset=utf-8");
      return;
    }
    if (mode === "candidate") {
      sendError(response, 404, "not found");
      return;
    }

    if (request.method === "GET" && path === "/api/state") {
      response.setHeader("cache-control", "no-store");
      send(response, 200, await store.dashboard(readVoter(request, voterCookieSecret)));
      return;
    }
    if (request.method === "POST" && path === "/api/proposals") {
      const body = await readJson(request);
      if (!exactObject(body, ["prompt"]) || Object.keys(body).length !== 1) {
        throw new RequestError(400, "proposal body must contain only prompt");
      }
      const proposal = await store.createProposal(boundedString(body.prompt, "prompt", limits.prompt));
      send(response, 201, { proposal });
      return;
    }

    const voteMatch = path.match(/^\/api\/cycles\/(\d+)\/votes$/);
    if (request.method === "POST" && voteMatch) {
      const body = await readJson(request);
      if (!exactObject(body, ["candidateId"]) || Object.keys(body).length !== 1) {
        throw new RequestError(400, "vote body must contain only candidateId");
      }
      const voterId = voterForVote(request, response, voterCookieSecret);
      await store.castVote(Number(voteMatch[1]), positiveInteger(body.candidateId, "candidateId"), voterId);
      send(response, 201, { accepted: true });
      return;
    }

    if (path.startsWith("/api/admin/")) {
      if (!adminToken) {
        sendError(response, 503, "admin API is not configured");
        return;
      }
      if (!authorized(request, adminToken)) {
        response.setHeader("www-authenticate", "Bearer");
        sendError(response, 401, "unauthorized");
        return;
      }
    }

    if (request.method === "POST" && path === "/api/admin/cycles") {
      const body = await readJson(request);
      if (!exactObject(body, ["label"]) || Object.keys(body).length !== 1) {
        throw new RequestError(400, "cycle body must contain only label");
      }
      send(response, 201, { cycle: await store.createCycle(boundedString(body.label, "label", limits.label)) });
      return;
    }

    const candidateMatch = path.match(/^\/api\/admin\/cycles\/(\d+)\/candidates$/);
    if (request.method === "POST" && candidateMatch) {
      const body = await readJson(request);
      if (!exactObject(body, ["proposalId", "previewUrl", "metadata"])) {
        throw new RequestError(400, "candidate body may contain only proposalId, previewUrl, and metadata");
      }
      const metadata = body.metadata == null ? "" : boundedString(body.metadata, "metadata", limits.metadata);
      const candidate = await store.registerCandidate(
        Number(candidateMatch[1]),
        positiveInteger(body.proposalId, "proposalId"),
        previewUrl(body.previewUrl, originFor(request)),
        metadata,
      );
      send(response, 201, { candidate });
      return;
    }

    const closeMatch = path.match(/^\/api\/admin\/cycles\/(\d+)\/close$/);
    if (request.method === "POST" && closeMatch) {
      send(response, 200, { cycle: await store.closeCycle(Number(closeMatch[1])) });
      return;
    }
    const promoteMatch = path.match(/^\/api\/admin\/cycles\/(\d+)\/promote$/);
    if (request.method === "POST" && promoteMatch) {
      send(response, 200, { release: await store.promoteCycle(Number(promoteMatch[1])) });
      return;
    }

    sendError(response, 404, "not found");
  }

  if (store) server.on("close", () => void store.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`hello, ai world ${process.env.APP_MODE ?? "platform"} mode on port ${port}`);
  });
}
