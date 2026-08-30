import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const check = process.argv.includes("--check");
const repoUrl = "https://github.com/shayliv/hello-ai-world";

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function jsonFiles(directory) {
  return readdirSync(join(root, directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readJson(join(directory, name)));
}

function requireValue(value, label) {
  if (value == null || value === "") throw new Error(`${label} is required`);
  return value;
}

function short(hash) {
  return requireValue(hash, "commit").slice(0, 7);
}

function commitLink(hash) {
  return `[\`${short(hash)}\`](${repoUrl}/commit/${hash})`;
}

function prLink(number, label = `PR #${number}`) {
  return number == null ? "historical direct input" : `[${label}](${repoUrl}/pull/${number})`;
}

function promptLink(candidate) {
  const ref = candidate.branch ?? "staging";
  return `[prompt](${repoUrl}/blob/${ref}/${candidate.promptPath})`;
}

function image(path, alt) {
  requireValue(path, `${alt} preview image`);
  if (!existsSync(join(root, path))) throw new Error(`missing preview image: ${path}`);
  return `![${alt}](${path})`;
}

function validate(state, cycles, releases) {
  if (state.schemaVersion !== 1) throw new Error("unsupported state schema");
  const cycleIds = new Set(cycles.map((cycle) => cycle.id));
  const releaseIds = new Set(releases.map((release) => release.id));
  if (!cycleIds.has(state.staging.cycle)) throw new Error("staging cycle does not exist");
  if (!releaseIds.has(state.production.release)) throw new Error("production release does not exist");
  for (const cycle of cycles) {
    const slugs = new Set();
    for (const candidate of cycle.candidates) {
      if (slugs.has(candidate.slug)) throw new Error(`duplicate candidate ${cycle.id}/${candidate.slug}`);
      slugs.add(candidate.slug);
      requireValue(candidate.prompt, `${candidate.slug} prompt`);
      new URL(candidate.previewUrl);
      image(candidate.previewImage, candidate.slug);
    }
    if (cycle.winner != null && !slugs.has(cycle.winner)) throw new Error(`${cycle.id} winner is not a candidate`);
  }
  for (const release of releases) {
    new URL(release.previewUrl);
    image(release.previewImage, release.id);
  }
}

const state = readJson("state/current.json");
const cycles = jsonFiles("cycles");
const releases = jsonFiles("releases");
validate(state, cycles, releases);

const currentCycle = cycles.find((cycle) => cycle.id === state.staging.cycle);
const winner = currentCycle.candidates.find((candidate) => candidate.slug === currentCycle.winner);

const candidateRows = currentCycle.candidates.map((candidate) => {
  const winnerMark = candidate.slug === currentCycle.winner ? " 🏆" : "";
  return `| [${candidate.slug}](${candidate.previewUrl})${winnerMark} | ${candidate.design} | [@${candidate.promptAuthor}](https://github.com/${candidate.promptAuthor}) | ${candidate.builder.agent} [\`${candidate.builder.sessionId.slice(0, 8)}\`] | ${candidate.votes} | ${prLink(candidate.candidatePullRequest)} · ${commitLink(candidate.commit)} · ${promptLink(candidate)} |`;
}).join("\n");

const dashboard = `## Live state\n\n| Environment | What is live | Source |\n| --- | --- | --- |\n| [Production](${state.production.url}) | ${state.production.release} · ${winner.slug} | \`${state.production.branch}\` ${commitLink(state.production.commit)} |\n| [Staging](${state.staging.url}) | ${currentCycle.label} · ${currentCycle.status} · ${winner.slug} | \`${state.staging.branch}\` ${commitLink(state.staging.commit)} |\n\n### What's on staging now\n\n${image(winner.previewImage, `${currentCycle.label} winner: ${winner.slug}`)}\n\n**${winner.slug}** — ${winner.design} Built by ${winner.builder.agent} session \`${winner.builder.sessionId}\` from a prompt by [@${winner.promptAuthor}](https://github.com/${winner.promptAuthor}). [Open staging](${state.staging.url}) · ${prLink(winner.candidatePullRequest, "candidate PR")} · ${promptLink(winner)}\n\n### ${currentCycle.label} candidates\n\n| Candidate | Design | Prompt author | Builder | Votes | Evidence |\n| --- | --- | --- | --- | ---: | --- |\n${candidateRows}\n\nClassifier: ${currentCycle.classifier.agent} session \`${currentCycle.classifier.sessionId}\` — **${currentCycle.classifier.verdict}**. Ballot: ${currentCycle.ballot.totalVotes} votes via ${currentCycle.ballot.source}.\n\n### The public loop\n\n\`prompt PR → maintainer selects → builder agent → deterministic guard → independent classifier → candidate PR → Cloud Run preview → vote → staging → reviewed production PR → immutable release\`\n\nEverything above is reconstructed from [\`state/current.json\`](${repoUrl}/blob/production/state/current.json), [\`cycles/\`](${repoUrl}/tree/production/cycles), [\`releases/\`](${repoUrl}/tree/production/releases), pull requests, commits, and workflow runs.`;

const readme = `# hello-ai-world\n\n**One public website, evolving forever from prompts.** Humans submit ideas as pull requests. Maintainers select candidates. AI agents build isolated versions, a second agent classifies them, people vote, and one version advances. The source, prompts, authors, previews, decisions, and release history stay visible on GitHub.\n\n[Open production](${state.production.url}) · [Open staging](${state.staging.url}) · [Submit a prompt](${state.submissionUrl}) · [Full history](HISTORY.md)\n\n<!-- BEGIN GENERATED LEDGER -->\n${dashboard}\n<!-- END GENERATED LEDGER -->\n\n## Repository is the database\n\n- \`proposals/<slug>/prompt.md\` is the raw user request and enters through a pull request.\n- \`cycles/<cycle-id>.json\` is the append-only public tournament record: design, author, agent, classifier, preview, votes, and winner.\n- \`releases/<epoch-id>.json\` is an immutable production record.\n- \`state/current.json\` points at the currently deployed staging and production sources.\n- \`HISTORY.md\` and this dashboard are deterministic renderings. CI fails if they drift.\n\nCloud Run executes commits; it is not the system of record. Credentials remain in GitHub Environments, GitHub Secrets, Secret Manager, and short-lived GCP workload identity—not in public files.\n\n## Manual control room\n\nUse the repository's [Actions tab](${repoUrl}/actions):\n\n1. **Agent · Build candidate from proposal PR** — takes a prompt-only PR and cycle ID, runs the builder and independent classifier, then opens a candidate PR. Requires the \`OPENAI_API_KEY\` repository secret.\n2. **Deploy · Candidate preview** — takes a candidate PR and deploys its exact head commit to an isolated Cloud Run service.\n3. **Deploy · Staging** — deploys the current \`staging\` branch as the public wrapper.\n4. **Deploy · Production** — verifies an immutable release and deploys the protected \`production\` branch after an explicit confirmation.\n\nGCP deploys authenticate with GitHub OIDC through Workload Identity Federation; there is no service-account key in GitHub. See [OPERATIONS.md](OPERATIONS.md) for inputs and recovery checks.\n\n## Local verification\n\nNode 24 or newer is required.\n\n\`\`\`sh\nnpm ci\nnpm test\nnpm run ledger:check\nAPP_MODE=platform DATABASE_BACKEND=repository npm start\n\`\`\`\n\nCandidate agents may edit only \`world/index.html\`; the selected prompt remains in \`proposals/<slug>/prompt.md\`. See [AGENTS.md](AGENTS.md) for the enforced boundary and [CONTRIBUTING.md](CONTRIBUTING.md) for prompt submissions.\n`;

const releaseSections = [...releases].reverse().map((release) => {
  const cycle = release.sourceCycle ? cycles.find((item) => item.id === release.sourceCycle) : null;
  const candidate = cycle?.candidates.find((item) => item.slug === release.winner);
  const provenance = candidate
    ? `Prompt by [@${candidate.promptAuthor}](https://github.com/${candidate.promptAuthor}); built by ${candidate.builder.agent} session \`${candidate.builder.sessionId}\`; classified by ${cycle.classifier.agent} session \`${cycle.classifier.sessionId}\`; promoted by [@${release.author}](https://github.com/${release.author}) in ${prLink(release.promotionPullRequest)}.`
    : `Created by [@${release.author}](https://github.com/${release.author}) as the one-dot genesis.`;
  return `## ${release.id} — ${release.title}\n\nReleased ${release.releasedAt}. ${commitLink(release.commit)} · [Open preserved version](${release.previewUrl})\n\n${image(release.previewImage, `${release.id}: ${release.title}`)}\n\n> ${release.prompt}\n\n${provenance}`;
}).join("\n\n");

const history = `# hello-ai-world history\n\nThis file is generated from the immutable records in \`releases/\` and the linked cycle provenance. Newest release first.\n\n${releaseSections}\n`;

function emit(path, contents) {
  const normalized = `${contents.trim()}\n`;
  if (check) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
    if (current !== normalized) throw new Error(`${path} is stale; run npm run ledger:render`);
  } else {
    writeFileSync(join(root, path), normalized);
  }
}

emit("README.md", readme);
emit("HISTORY.md", history);
console.log(check ? "public ledger is current" : "rendered README.md and HISTORY.md");
