# Agent boundaries

Candidate agents may modify **only** `world/index.html`. Their output must remain a self-contained world page and must not read credentials or call control-plane APIs.

Every evolution also carries its original, prompt-only request at `proposals/<slug>/prompt.md`, sourced from a public proposal pull request. The deterministic guard in `scripts/validate-evolution.mjs` rejects network-capable pages and changes to protected paths before an independent, read-only agent review is allowed to approve deployment.

Repository ledger files under `state/`, `cycles/`, and `releases/` are trusted workflow output. Candidate agents must never edit them. They are the public source of truth; deployed services consume them read-only.

All other paths are protected platform infrastructure, including `server.mjs`, `storage/`, `platform/`, `server.test.mjs`, `Dockerfile`, `.dockerignore`, `package.json`, and this file. Only trusted platform work may change them.

Do not commit, push, deploy, change repository settings, weaken authentication or security headers, or expose `ADMIN_TOKEN` to browser code.
