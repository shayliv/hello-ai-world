# hello-ai-world tournament

A minimal tournament control plane with two modes in one Node 24 source tree:

- `platform` is the trusted wrapper and API. It stores prompt-only proposals, cycles, candidates, votes, winners, and immutable releases.
- `candidate` serves only `world/index.html` (at `/` and `/world/index.html`) plus `/healthz`. It does not construct or access a database.

Candidate agents may edit only `world/index.html`; see `AGENTS.md`.

## Run locally

Install dependencies on Node 24 or newer.

```sh
npm ci
```

```sh
ADMIN_TOKEN=local-admin \
VOTER_COOKIE_SECRET=replace-this-local-secret \
APP_MODE=platform \
npm start
```

The platform is at `http://localhost:3000`. SQLite data defaults to `data/tournament.sqlite`; set `DATABASE_PATH` to change it.

Run a credential-free candidate preview on another port:

```sh
APP_MODE=candidate PORT=3001 npm start
```

Validate the full lifecycle, isolation boundary, limits, voting uniqueness, history, headers, and health:

```sh
npm run validate
```

## Experiment state machine

1. Anyone submits `{ "prompt": "..." }` to `POST /api/proposals`. No other proposal fields are accepted; prompts are limited to 2,000 characters.
2. An admin opens one cycle with `POST /api/admin/cycles` and registers multiple proposal/preview pairs at `POST /api/admin/cycles/:id/candidates`.
3. The open cycle accepts one vote per signed anonymous voter cookie at `POST /api/cycles/:id/votes`. A SQLite primary key enforces one voter/cycle vote.
4. `POST /api/admin/cycles/:id/close` freezes voting. The highest vote count wins; ties resolve to the earliest registered candidate.
5. `POST /api/admin/cycles/:id/promote` appends one immutable release snapshot and makes its URL the current production world. Promotion is idempotent.

All `/api/admin/*` routes require `Authorization: Bearer $ADMIN_TOKEN`. The browser bundle has no admin workflow or token. Read-only wrapper state is at `GET /api/state`; health is at `GET /healthz`.

Preview URLs must be absolute, credential-free, HTTPS URLs (localhost HTTP is allowed for experiments), and cross-origin from the platform request. The wrapper uses sandboxed iframes, and all prompt/metadata DOM rendering uses text nodes.

## Container and Cloud Run preparation

The `Dockerfile` listens on `PORT` and is suitable as the build input for `gcloud run deploy --source`. This repository does **not** claim a GCP deployment exists.

For the durable Cloud Run platform deployment:

- set `DATABASE_BACKEND=firestore` and provision the database and service-account permissions;
- supply `ADMIN_TOKEN` and `VOTER_COOKIE_SECRET` from Secret Manager;
- deploy each candidate as a separate credential-free, cross-origin service with `APP_MODE=candidate`;
- choose Cloud Run ingress, IAM, custom-domain, and scaling settings appropriate to the experiment.

SQLite is intentionally the local experiment backend. A Cloud Run filesystem is ephemeral and must not be used as durable tournament storage.
