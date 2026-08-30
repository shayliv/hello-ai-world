# Manual operations

All operator actions start from GitHub's **Actions** tab. Select the named workflow, choose **Run workflow**, and run it from the `production` branch once these workflow files have reached production.

## One-time configuration

- Repository secret: `OPENAI_API_KEY` for `openai/codex-action@v1`.
- GitHub environments: `staging` and `production`. Add a required reviewer to `production` when the repository plan supports it.
- Repository variables: `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_CONTROL_SERVICE_ACCOUNT`, and `GCP_CANDIDATE_SERVICE_ACCOUNT`.
- GCP: the GitHub OIDC provider must be restricted to this repository's immutable numeric ID, and the deployer service account must have Cloud Run Source Developer, Service Usage Consumer, and Service Account User on the two runtime identities.

No Google service-account JSON key is used.

## 1. Build a candidate

Run **Agent · Build candidate from proposal PR** with:

- `proposal_pr`: an open prompt-only PR targeting `staging`;
- `cycle_id`: `cycle-N`;
- `model`: blank for the Codex action default, or an intentional override.

The workflow rejects extra proposal files, runs the builder in workspace-only mode, applies the deterministic no-network guard, reconstructs the patch in a fresh job, runs an independent read-only classifier, and only then creates `candidate/<cycle>-<slug>` plus a candidate PR.

## 2. Deploy a candidate preview

Run **Deploy · Candidate preview** with its candidate PR and cycle ID. It deploys the exact PR head to `hello-ai-world-cN-<slug>`, uses the credential-free candidate runtime account, smokes `/healthz`, and comments the URL and workflow evidence back onto the PR.

## 3. Record and choose a winner

Update `cycles/<cycle-id>.json` through a reviewed platform PR with preview URLs, prompt authors, agent workflow links or sessions, classifier result, vote source/totals, and winner. Run `npm run ledger:render`; CI rejects stale README/HISTORY output.

The first experiment used signed-cookie test voting. The durable public voting design is a GitHub ballot issue where one account has one effective `/vote <slug>` command inside the stated window; the tally workflow is intentionally not enabled until GitHub login and anti-sybil rules are settled.

## 4. Deploy staging

Merge the selected world and updated ledger into `staging`, then run **Deploy · Staging** with `STAGING`. The job tests, checks deterministic docs, deploys the repository-backed wrapper, and proves `/api/state` reports `source: repository`.

## 5. Promote production

Create `releases/epoch-N.json`, update `state/current.json`, render the docs, and open a reviewed PR from `staging` to protected `production`. After merge, run **Deploy · Production** with the exact epoch and `DEPLOY`. It verifies the SHA-256 of `world/index.html` against the immutable release record before deployment.

## Recovery checks

```sh
gh run list --workflow deploy-staging.yml
gh run list --workflow deploy-production.yml
gcloud run services list --project bonez-490920 --region europe-west1
curl -fsS https://hello-ai-world-mhbydmqmqq-ew.a.run.app/healthz
curl -fsS https://hello-ai-world-mhbydmqmqq-ew.a.run.app/api/state
```
