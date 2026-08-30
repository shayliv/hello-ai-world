import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "index.html"));

export function createApp({ databasePath = join(here, "data", "hello-ai-world.sqlite") } = {}) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);
  database.prepare("INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)")
    .run("message", "hello, ai world");

  const readMessage = database.prepare(
    "SELECT value, created_at FROM app_state WHERE key = 'message'",
  );

  const server = createServer((request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("content-security-policy", "default-src 'self'; script-src 'unsafe-inline'");

    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain" });
      response.end("method not allowed\n");
      return;
    }

    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("alive\n");
      return;
    }

    if (request.url === "/api/state") {
      const row = readMessage.get();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: row.value, bornAt: row.created_at }));
      return;
    }

    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found\n");
  });

  server.on("close", () => database.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`hello, ai world is alive on http://localhost:${port}`);
  });
}
