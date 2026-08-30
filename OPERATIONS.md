# Manual operations

All operator actions start from GitHub's **Actions** tab. Select the named workflow, choose **Run workflow**, and run it from the `production` branch once these workflow files have reached production.

## One-time configuration

- Repository secret: `OPENROUTER_API_KEY`. Use a dedicated, low-credit key because the coding harness necessarily receives it while running tools.
- GitHub environments: `staging` and `production`. Add a required reviewer to `production` when the repository plan supports it.
- Repository variables: `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_CONTROL_SERVICE_ACCOUNT`, and `GCP_CANDIDATE_SERVICE_ACCOUNT`.
- GCP: the GitHub OIDC provider must be restricted to this repository's immutable numeric ID, and the deployer service account must have Cloud Run Source Developer, Service Usage Consumer, and Service Account User on the two runtime identities.

No Google service-account JSON key is used.

## 1. Build a candidate

Run **Agent · Build candidate from proposal PR** with:

- `proposal_pr`: an open prompt-only PR targeting `staging`;
- `cycle_id`: `cycle-N`;
- `builder_model`: defaults to `qwen/qwen3-coder-next`, a coding-focused OpenRouter model;
- `classifier_model`: defaults to `qwen/qwen3.8-flash`, a separate structured-output model.

The workflow rejects extra proposal files, runs a pinned OpenCode harness without GitHub write credentials, and lets it evolve agent-owned product code throughout the monorepo. A trusted guard rejects changes to workflows, deployment machinery, governance, ledgers, other proposals, credential-like files, symlinks, or oversized diffs. A fresh job reconstructs the complete patch and sends it to an independent read-only classifier. Only then can the workflow create `candidate/<cycle>-<slug>` and its candidate PR.

## 2. Deploy a candidate preview

Run **Deploy · Candidate preview** with its candidate PR and cycle ID. It deploys the exact PR head to `hello-ai-world-cN-<slug>`, uses the credential-free candidate runtime account, smokes `/healthz`, and comments the URL and workflow evidence back onto the PR.

## 3. Record and choose a winner

Update `cycles/<cycle-id>.json` through a reviewed platform PR with preview URLs, prompt authors, agent workflow links or sessions, classifier result, vote source/totals, and winner. Run `npm run ledger:render`; CI rejects stale README/HISTORY output.

The first experiment used signed-cookie test voting. The durable public voting design is a GitHub ballot issue where one account has one effective `/vote <slug>` command inside the stated window; the tally workflow is intentionally not enabled until GitHub login and anti-sybil rules are settled.

## 4. Deploy staging

Merge the selected product evolution and updated ledger into `staging`, then run **Deploy · Staging** with `STAGING`. The job tests, checks deterministic docs, deploys the repository commit, and proves `/api/state` reports `source: repository`.

## 5. Promote production

Create `releases/epoch-N.json`, set its `productSha256` to the output of `node scripts/product-hash.mjs`, update `state/current.json`, render the docs, and open a reviewed PR from `staging` to protected `production`. After merge, run **Deploy · Production** with the exact epoch and `DEPLOY`. It verifies the hash of every agent-owned product file against the immutable release record before deployment. Schema-v1 releases retain their legacy `worldSha256` verification.

## Recovery checks

```sh
gh run list --workflow deploy-staging.yml
gh run list --workflow deploy-production.yml
gcloud run services list --project bonez-490920 --region europe-west1
curl -fsS https://hello-ai-world-mhbydmqmqq-ew.a.run.app/api/health
curl -fsS https://hello-ai-world-mhbydmqmqq-ew.a.run.app/api/state
```
