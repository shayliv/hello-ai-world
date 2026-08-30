import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "./sqlite.mjs";

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function readonly() {
  throw new StoreError("conflict", "the public ledger is read-only; submit and vote on GitHub");
}

export class RepositoryTournamentStore {
  constructor({ root = process.cwd() } = {}) {
    this.root = root;
  }

  async dashboard() {
    const state = readJson(this.root, "state/current.json");
    const cycle = readJson(this.root, `cycles/${state.staging.cycle}.json`);
    const releases = readdirSync(join(this.root, "releases"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readJson(this.root, join("releases", name)));

    const candidates = cycle.candidates.map((candidate) => ({
      id: candidate.id,
      slug: candidate.slug,
      prompt: candidate.prompt,
      promptAuthor: candidate.promptAuthor,
      promptPullRequest: candidate.promptPullRequest,
      previewUrl: candidate.previewUrl,
      votes: candidate.votes,
      design: candidate.design,
      voteUrl: cycle.ballot.issue
        ? `https://github.com/${state.repository}/issues/${cycle.ballot.issue}#vote-${candidate.slug}`
        : null,
      metadata: JSON.stringify({
        name: candidate.slug,
        author: candidate.promptAuthor,
        commit: candidate.commit.slice(0, 7),
        agentSession: candidate.builder.sessionId,
        pullRequest: candidate.candidatePullRequest,
        design: candidate.design,
      }),
    }));

    return {
      source: "repository",
      submissionUrl: state.submissionUrl,
      currentProduction: {
        source: "release",
        previewUrl: "/world/index.html",
        releaseId: state.production.release,
        publicUrl: state.production.url,
      },
      cycle: {
        id: cycle.id,
        label: cycle.label,
        status: cycle.status,
        winnerCandidateId: candidates.find((candidate) => candidate.slug === cycle.winner)?.id ?? null,
        hasVoted: false,
        ballotUrl: cycle.ballot.issue
          ? `https://github.com/${state.repository}/issues/${cycle.ballot.issue}`
          : null,
        candidates,
      },
      proposals: candidates.map((candidate) => ({
        id: candidate.id,
        prompt: candidate.prompt,
        author: candidate.promptAuthor,
        pullRequest: candidate.promptPullRequest,
      })),
      history: releases.map((release, index) => ({
        id: index + 1,
        releaseId: release.id,
        label: release.title,
        prompt: release.prompt,
        previewUrl: release.previewUrl,
        releasedAt: release.releasedAt,
      })),
    };
  }

  createProposal = readonly;
  createCycle = readonly;
  registerCandidate = readonly;
  castVote = readonly;
  closeCycle = readonly;
  promoteCycle = readonly;

  async close() {}
}
