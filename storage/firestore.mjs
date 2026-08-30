import { createHash } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { StoreError } from "./sqlite.mjs";

function now() {
  return new Date().toISOString();
}

function byId(left, right) {
  return Number(left.id) - Number(right.id);
}

function voterKey(cycleId, voterId) {
  const digest = createHash("sha256").update(voterId).digest("hex");
  return `${cycleId}-${digest}`;
}

export class FirestoreTournamentStore {
  constructor({ projectId, databaseId, namespace = "hello-ai-world", firestore } = {}) {
    this.firestore = firestore ?? new Firestore({
      ...(projectId ? { projectId } : {}),
      ...(databaseId ? { databaseId } : {}),
    });
    this.root = this.firestore.collection(namespace);
    this.state = this.root.doc("state");
  }

  collection(name) {
    return this.state.collection(name);
  }

  async nextId(transaction, name) {
    const ref = this.collection("counters").doc(name);
    const snapshot = await transaction.get(ref);
    const value = Number(snapshot.data()?.value ?? 0) + 1;
    transaction.set(ref, { value });
    return value;
  }

  async createProposal(prompt) {
    return this.firestore.runTransaction(async (transaction) => {
      const id = await this.nextId(transaction, "proposals");
      const proposal = { id, prompt, createdAt: now() };
      transaction.create(this.collection("proposals").doc(String(id)), proposal);
      return proposal;
    });
  }

  async createCycle(label) {
    return this.firestore.runTransaction(async (transaction) => {
      const control = await transaction.get(this.state);
      const openCycleId = control.data()?.openCycleId ?? null;
      if (openCycleId != null) {
        const open = await transaction.get(this.collection("cycles").doc(String(openCycleId)));
        if (open.exists && open.data().status === "open") {
          throw new StoreError("conflict", "an open cycle already exists");
        }
      }
      const id = await this.nextId(transaction, "cycles");
      const cycle = {
        id,
        label,
        status: "open",
        winnerCandidateId: null,
        createdAt: now(),
        closedAt: null,
        promotedAt: null,
      };
      transaction.create(this.collection("cycles").doc(String(id)), cycle);
      transaction.set(this.state, { openCycleId: id, latestCycleId: id }, { merge: true });
      return { ...cycle, hasVoted: false, candidates: [] };
    });
  }

  async registerCandidate(cycleId, proposalId, previewUrl, metadata) {
    return this.firestore.runTransaction(async (transaction) => {
      const cycleRef = this.collection("cycles").doc(String(cycleId));
      const proposalRef = this.collection("proposals").doc(String(proposalId));
      const uniqueRef = this.collection("cycleProposals").doc(`${cycleId}-${proposalId}`);
      const [cycle, proposal, unique] = await Promise.all([
        transaction.get(cycleRef),
        transaction.get(proposalRef),
        transaction.get(uniqueRef),
      ]);
      if (!cycle.exists) throw new StoreError("not_found", "cycle not found");
      if (cycle.data().status !== "open") throw new StoreError("conflict", "cycle is not open");
      if (!proposal.exists) throw new StoreError("not_found", "proposal not found");
      if (unique.exists) throw new StoreError("conflict", "candidate is already registered in this cycle");

      const id = await this.nextId(transaction, "candidates");
      const candidate = {
        id,
        cycleId,
        proposalId,
        previewUrl,
        prompt: proposal.data().prompt,
        metadata,
        votes: 0,
        createdAt: now(),
      };
      transaction.create(this.collection("candidates").doc(String(id)), candidate);
      transaction.create(uniqueRef, { cycleId, proposalId, candidateId: id });
      return candidate;
    });
  }

  async castVote(cycleId, candidateId, voterId) {
    return this.firestore.runTransaction(async (transaction) => {
      const cycleRef = this.collection("cycles").doc(String(cycleId));
      const candidateRef = this.collection("candidates").doc(String(candidateId));
      const voteRef = this.collection("votes").doc(voterKey(cycleId, voterId));
      const [cycle, candidate, vote] = await Promise.all([
        transaction.get(cycleRef),
        transaction.get(candidateRef),
        transaction.get(voteRef),
      ]);
      if (!cycle.exists) throw new StoreError("not_found", "cycle not found");
      if (cycle.data().status !== "open") throw new StoreError("conflict", "voting is closed");
      if (!candidate.exists || candidate.data().cycleId !== cycleId) {
        throw new StoreError("not_found", "candidate not found in this cycle");
      }
      if (vote.exists) throw new StoreError("conflict", "this voter already voted in this cycle");

      transaction.create(voteRef, { cycleId, candidateId, createdAt: now() });
      transaction.update(candidateRef, { votes: Number(candidate.data().votes ?? 0) + 1 });
      return { accepted: true };
    });
  }

  async closeCycle(cycleId) {
    return this.firestore.runTransaction(async (transaction) => {
      const cycleRef = this.collection("cycles").doc(String(cycleId));
      const cycle = await transaction.get(cycleRef);
      if (!cycle.exists) throw new StoreError("not_found", "cycle not found");
      if (cycle.data().status !== "open") return this.cycle(cycleId);

      const candidates = (await transaction.get(
        this.collection("candidates").where("cycleId", "==", cycleId),
      )).docs.map((document) => document.data()).sort(byId);
      if (!candidates.length) throw new StoreError("conflict", "cannot close a cycle without candidates");
      candidates.sort((left, right) => Number(right.votes) - Number(left.votes) || byId(left, right));
      const winnerCandidateId = candidates[0].id;
      const closedAt = now();
      transaction.update(cycleRef, { status: "closed", winnerCandidateId, closedAt });
      transaction.set(this.state, { openCycleId: null }, { merge: true });
      return {
        ...cycle.data(), status: "closed", winnerCandidateId, closedAt,
        hasVoted: false, candidates: candidates.sort(byId),
      };
    });
  }

  async promoteCycle(cycleId) {
    return this.firestore.runTransaction(async (transaction) => {
      const cycleRef = this.collection("cycles").doc(String(cycleId));
      const cycle = await transaction.get(cycleRef);
      if (!cycle.exists) throw new StoreError("not_found", "cycle not found");
      if (cycle.data().status === "open") {
        throw new StoreError("conflict", "close the cycle before promotion");
      }
      if (cycle.data().status === "promoted") {
        const existing = await transaction.get(this.collection("releases").doc(String(cycle.data().releaseId)));
        return existing.data();
      }

      const candidate = await transaction.get(
        this.collection("candidates").doc(String(cycle.data().winnerCandidateId)),
      );
      if (!candidate.exists) throw new StoreError("conflict", "cycle has no winner");
      const id = await this.nextId(transaction, "releases");
      const release = {
        id,
        cycleId,
        candidateId: candidate.data().id,
        label: cycle.data().label,
        prompt: candidate.data().prompt,
        previewUrl: candidate.data().previewUrl,
        metadata: candidate.data().metadata,
        releasedAt: now(),
      };
      transaction.create(this.collection("releases").doc(String(id)), release);
      transaction.update(cycleRef, {
        status: "promoted", promotedAt: release.releasedAt, releaseId: id,
      });
      transaction.set(this.state, { currentReleaseId: id, latestCycleId: cycleId }, { merge: true });
      return release;
    });
  }

  async cycle(cycleId, voterId = null) {
    const [cycle, candidates, vote] = await Promise.all([
      this.collection("cycles").doc(String(cycleId)).get(),
      this.collection("candidates").where("cycleId", "==", cycleId).get(),
      voterId ? this.collection("votes").doc(voterKey(cycleId, voterId)).get() : null,
    ]);
    if (!cycle.exists) return null;
    return {
      ...cycle.data(),
      hasVoted: Boolean(vote?.exists),
      candidates: candidates.docs.map((document) => document.data()).sort(byId),
    };
  }

  async dashboard(voterId = null) {
    const control = await this.state.get();
    const { latestCycleId = null, currentReleaseId = null } = control.data() ?? {};
    const [proposalDocs, releases, cycle, currentRelease] = await Promise.all([
      this.collection("proposals").get(),
      this.collection("releases").get(),
      latestCycleId == null ? null : this.cycle(latestCycleId, voterId),
      currentReleaseId == null
        ? null
        : this.collection("releases").doc(String(currentReleaseId)).get(),
    ]);
    const release = currentRelease?.data() ?? null;
    return {
      currentProduction: release
        ? { source: "release", previewUrl: release.previewUrl, releaseId: release.id }
        : { source: "bundled", previewUrl: "/world/index.html", releaseId: null },
      cycle,
      proposals: proposalDocs.docs.map((document) => document.data()).sort((a, b) => byId(b, a)),
      history: releases.docs.map((document) => document.data()).sort(byId),
    };
  }

  async close() {
    await this.firestore.terminate();
  }
}
