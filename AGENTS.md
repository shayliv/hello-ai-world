# Agent boundaries

Candidate agents may modify **only** `world/index.html`. Their output must remain a self-contained world page and must not read credentials or call control-plane APIs.

Every evolution also carries its original, prompt-only request at `proposals/<slug>/prompt.md`. The deterministic guard in `scripts/validate-evolution.mjs` rejects network-capable pages and changes to protected paths before an agent review is allowed to approve deployment.

All other paths are protected platform infrastructure, including `server.mjs`, `storage/`, `platform/`, `server.test.mjs`, `Dockerfile`, `.dockerignore`, `package.json`, and this file. Only trusted platform work may change them.

Do not commit, push, deploy, change repository settings, weaken authentication or security headers, or expose `ADMIN_TOKEN` to browser code.
