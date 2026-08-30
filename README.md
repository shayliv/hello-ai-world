# hello-ai-world

**One public website, evolving forever from prompts.** Humans submit ideas as pull requests. Maintainers select candidates. AI agents build isolated versions, a second agent classifies them, people vote, and one version advances. The source, prompts, authors, previews, decisions, and release history stay visible on GitHub.

[Open production](https://hello-ai-world-mhbydmqmqq-ew.a.run.app/) · [Open staging](https://hello-ai-world-staging-mhbydmqmqq-ew.a.run.app/) · [Submit a prompt](https://github.com/shayliv/hello-ai-world/blob/production/CONTRIBUTING.md#submit-a-prompt) · [Full history](HISTORY.md)

<!-- BEGIN GENERATED LEDGER -->
## Live state

| Environment | What is live | Source |
| --- | --- | --- |
| [Production](https://hello-ai-world-mhbydmqmqq-ew.a.run.app/) | epoch-1 · languages | `production` [`1385e9a`](https://github.com/shayliv/hello-ai-world/commit/1385e9af4fbfc4b7ba7d8a56f36f5c092e6edf8d) |
| [Staging](https://hello-ai-world-staging-mhbydmqmqq-ew.a.run.app/) | Cycle 1 · promoted · languages | `staging` [`78e662a`](https://github.com/shayliv/hello-ai-world/commit/78e662ae6e544e8b56c9e38fd6a3dca63fdc5e50) |

### What's on staging now

![Cycle 1 winner: languages](docs/previews/cycle-1-languages.jpg)

**languages** — A quiet, hash-linkable language portal with twenty native-script greetings. Built by Codex session `01a0531e-c865-7750-8055-a11358570355` from a prompt by [@shayliv](https://github.com/shayliv). [Open staging](https://hello-ai-world-staging-mhbydmqmqq-ew.a.run.app/) · [candidate PR](https://github.com/shayliv/hello-ai-world/pull/3) · [prompt](https://github.com/shayliv/hello-ai-world/blob/candidate/cycle-1-languages/proposals/languages/prompt.md)

### Cycle 1 candidates

| Candidate | Design | Prompt author | Builder | Votes | Evidence |
| --- | --- | --- | --- | ---: | --- |
| [orbit](https://hello-ai-world-c1-orbit-mhbydmqmqq-ew.a.run.app/) | A restrained pointer-reactive orbit around the original greeting. | [@shayliv](https://github.com/shayliv) | Codex [`01a0531e`] | 1 | [PR #2](https://github.com/shayliv/hello-ai-world/pull/2) · [`f2078ce`](https://github.com/shayliv/hello-ai-world/commit/f2078ce61f57b7bb0d41edcb4b2480f8f185178c) · [prompt](https://github.com/shayliv/hello-ai-world/blob/candidate/cycle-1-orbit/proposals/orbit/prompt.md) |
| [languages](https://hello-ai-world-c1-languages-mhbydmqmqq-ew.a.run.app/) 🏆 | A quiet, hash-linkable language portal with twenty native-script greetings. | [@shayliv](https://github.com/shayliv) | Codex [`01a0531e`] | 2 | [PR #3](https://github.com/shayliv/hello-ai-world/pull/3) · [`0202452`](https://github.com/shayliv/hello-ai-world/commit/0202452c112a86d4f8f8e875dadef7e14045c82a) · [prompt](https://github.com/shayliv/hello-ai-world/blob/candidate/cycle-1-languages/proposals/languages/prompt.md) |
| [echo](https://hello-ai-world-c1-echo-mhbydmqmqq-ew.a.run.app/) | Calm central type with capped, fading typographic echoes created by interaction. | [@shayliv](https://github.com/shayliv) | Codex [`01a0531e`] | 0 | [PR #1](https://github.com/shayliv/hello-ai-world/pull/1) · [`97f1e22`](https://github.com/shayliv/hello-ai-world/commit/97f1e22eaf61b411eaa7f4b2925b4efca380887d) · [prompt](https://github.com/shayliv/hello-ai-world/blob/candidate/cycle-1-echo/proposals/echo/prompt.md) |

Classifier: Codex session `01a05324-748d-78f1-98c2-4c2e411865c5` — **approved**. Ballot: 3 votes via synthetic-end-to-end-test.

### The public loop

`prompt PR → maintainer selects → builder agent → deterministic guard → independent classifier → candidate PR → Cloud Run preview → vote → staging → reviewed production PR → immutable release`

Everything above is reconstructed from [`state/current.json`](https://github.com/shayliv/hello-ai-world/blob/production/state/current.json), [`cycles/`](https://github.com/shayliv/hello-ai-world/tree/production/cycles), [`releases/`](https://github.com/shayliv/hello-ai-world/tree/production/releases), pull requests, commits, and workflow runs.
<!-- END GENERATED LEDGER -->

## Repository is the database

The deployed root contains only the selected `world/index.html`. There is no prompt form, tournament wrapper, or control dashboard in the product UI; those surfaces live here on GitHub.

- `proposals/<slug>/prompt.md` is the raw user request and enters through a pull request.
- `cycles/<cycle-id>.json` is the append-only public tournament record: design, author, agent, classifier, preview, votes, and winner.
- `releases/<epoch-id>.json` is an immutable production record.
- `state/current.json` points at the currently deployed staging and production sources.
- `HISTORY.md` and this dashboard are deterministic renderings. CI fails if they drift.

Cloud Run executes commits; it is not the system of record. Credentials remain in GitHub Environments, GitHub Secrets, Secret Manager, and short-lived GCP workload identity—not in public files.

## Manual control room

Use the repository's [Actions tab](https://github.com/shayliv/hello-ai-world/actions):

1. **Agent · Build candidate from proposal PR** — takes a prompt-only PR and cycle ID, runs the builder and independent classifier, then opens a candidate PR. Requires the `OPENAI_API_KEY` repository secret.
2. **Deploy · Candidate preview** — takes a candidate PR and deploys its exact head commit to an isolated Cloud Run service.
3. **Deploy · Staging** — deploys the current `staging` branch with the selected world at its root.
4. **Deploy · Production** — verifies an immutable release and deploys the protected `production` branch after an explicit confirmation.

GCP deploys authenticate with GitHub OIDC through Workload Identity Federation; there is no service-account key in GitHub. See [OPERATIONS.md](OPERATIONS.md) for inputs and recovery checks.

## Local verification

Node 24 or newer is required.

```sh
npm ci
npm test
npm run ledger:check
APP_MODE=platform DATABASE_BACKEND=repository npm start
```

Candidate agents may edit only `world/index.html`; the selected prompt remains in `proposals/<slug>/prompt.md`. See [AGENTS.md](AGENTS.md) for the enforced boundary and [CONTRIBUTING.md](CONTRIBUTING.md) for prompt submissions.
