# Contributing a world prompt

## Submit a prompt

Every public contribution starts as a prompt-only pull request against `staging`.

1. Fork the repository and create a branch named `proposal/<slug>`.
2. Add exactly one file: `proposals/<slug>/prompt.md`.
3. Keep the prompt between 1 and 2,000 characters. Describe the product outcome, not implementation instructions or requests for credentials and external side effects.
4. Open a pull request to `staging` using the proposal template.

Do not submit generated code in a proposal. A maintainer manually runs the candidate-agent workflow against selected proposal PRs. An OpenCode agent using a selected OpenRouter model may evolve product code across the monorepo, while deterministic protected-path and size guards keep the GitHub/deployment control plane out of reach. A separate read-only OpenRouter model classifies the complete diff before the workflow opens a candidate PR.

## Voting and promotion

Candidate preview URLs, authors, agent runs, security verdicts, and vote totals are recorded in `cycles/<cycle-id>.json`. The winner is replayed onto `staging`, then promoted through a reviewed PR to the protected `production` branch. Each production epoch is immutable in `releases/<epoch-id>.json` and rendered into `HISTORY.md`.

The repository is the public source of truth. Cloud Run is only the execution surface. API keys, signed-cookie secrets, and Google credentials are never repository data.
