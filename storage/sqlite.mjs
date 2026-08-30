import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

function number(value) {
  return value == null ? null : Number(value);
}

function proposalRow(row) {
  return row && {
    id: number(row.id),
    prompt: row.prompt,
    createdAt: row.created_at,
  };
}

function candidateRow(row) {
  return row && {
    id: number(row.id),
    proposalId: number(row.proposal_id),
    previewUrl: row.preview_url,
    prompt: row.prompt,
    metadata: row.metadata,
    votes: number(row.votes ?? 0),
    createdAt: row.created_at,
  };
}

function releaseRow(row) {
  return row && {
    id: number(row.id),
    cycleId: number(row.cycle_id),
    candidateId: number(row.candidate_id),
    label: row.label,
    prompt: row.prompt,
    previewUrl: row.preview_url,
    metadata: row.metadata,
    releasedAt: row.released_at,
  };
}

export class SQLiteTournamentStore {
  constructor(databasePath) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY,
        prompt TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS cycles (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'promoted')),
        winner_candidate_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        closed_at TEXT,
        promoted_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_open_cycle
        ON cycles ((1)) WHERE status = 'open';

      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL REFERENCES cycles(id),
        proposal_id INTEGER NOT NULL REFERENCES proposals(id),
        preview_url TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (cycle_id, preview_url),
        UNIQUE (cycle_id, proposal_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS votes (
        cycle_id INTEGER NOT NULL REFERENCES cycles(id),
        voter_id TEXT NOT NULL,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (cycle_id, voter_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS releases (
        id INTEGER PRIMARY KEY,
        cycle_id INTEGER NOT NULL UNIQUE REFERENCES cycles(id),
        candidate_id INTEGER NOT NULL REFERENCES candidates(id),
        label TEXT NOT NULL,
        prompt TEXT NOT NULL,
        preview_url TEXT NOT NULL,
        metadata TEXT NOT NULL,
        released_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;

      CREATE TRIGGER IF NOT EXISTS releases_no_update
      BEFORE UPDATE ON releases BEGIN
        SELECT RAISE(ABORT, 'releases are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS releases_no_delete
      BEFORE DELETE ON releases BEGIN
        SELECT RAISE(ABORT, 'releases are immutable');
      END;
    `);
  }

  async createProposal(prompt) {
    const result = this.database.prepare("INSERT INTO proposals (prompt) VALUES (?)").run(prompt);
    return proposalRow(this.database.prepare("SELECT * FROM proposals WHERE id = ?").get(result.lastInsertRowid));
  }

  async createCycle(label) {
    try {
      const result = this.database.prepare("INSERT INTO cycles (label) VALUES (?)").run(label);
      return this.#cycle(result.lastInsertRowid);
    } catch (error) {
      if (String(error.message).includes("one_open_cycle")) {
        throw new StoreError("conflict", "an open cycle already exists");
      }
      throw error;
    }
  }

  async registerCandidate(cycleId, proposalId, previewUrl, metadata) {
    const cycle = this.database.prepare("SELECT status FROM cycles WHERE id = ?").get(cycleId);
    if (!cycle) throw new StoreError("not_found", "cycle not found");
    if (cycle.status !== "open") throw new StoreError("conflict", "cycle is not open");
    if (!this.database.prepare("SELECT 1 FROM proposals WHERE id = ?").get(proposalId)) {
      throw new StoreError("not_found", "proposal not found");
    }

    try {
      const result = this.database.prepare(`
        INSERT INTO candidates (cycle_id, proposal_id, preview_url, metadata)
        VALUES (?, ?, ?, ?)
      `).run(cycleId, proposalId, previewUrl, metadata);
      return candidateRow(this.database.prepare(`
        SELECT c.*, p.prompt, 0 AS votes
        FROM candidates c JOIN proposals p ON p.id = c.proposal_id
        WHERE c.id = ?
      `).get(result.lastInsertRowid));
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw new StoreError("conflict", "candidate is already registered in this cycle");
      }
      throw error;
    }
  }

  async castVote(cycleId, candidateId, voterId) {
    const cycle = this.database.prepare("SELECT status FROM cycles WHERE id = ?").get(cycleId);
    if (!cycle) throw new StoreError("not_found", "cycle not found");
    if (cycle.status !== "open") throw new StoreError("conflict", "voting is closed");
    const candidate = this.database.prepare(
      "SELECT 1 FROM candidates WHERE id = ? AND cycle_id = ?",
    ).get(candidateId, cycleId);
    if (!candidate) throw new StoreError("not_found", "candidate not found in this cycle");

    try {
      this.database.prepare(`
        INSERT INTO votes (cycle_id, voter_id, candidate_id) VALUES (?, ?, ?)
      `).run(cycleId, voterId, candidateId);
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        throw new StoreError("conflict", "this voter already voted in this cycle");
      }
      throw error;
    }
    return { accepted: true };
  }

  async closeCycle(cycleId) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT status FROM cycles WHERE id = ?").get(cycleId);
      if (!row) throw new StoreError("not_found", "cycle not found");
      if (row.status !== "open") {
        this.database.exec("COMMIT");
        return this.#cycle(cycleId);
      }

      const winner = this.database.prepare(`
        SELECT c.id, COUNT(v.candidate_id) AS votes
        FROM candidates c
        LEFT JOIN votes v ON v.candidate_id = c.id AND v.cycle_id = c.cycle_id
        WHERE c.cycle_id = ?
        GROUP BY c.id
        ORDER BY votes DESC, c.id ASC
        LIMIT 1
      `).get(cycleId);
      if (!winner) throw new StoreError("conflict", "cannot close a cycle without candidates");

      this.database.prepare(`
        UPDATE cycles
        SET status = 'closed', winner_candidate_id = ?,
            closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(winner.id, cycleId);
      this.database.exec("COMMIT");
      return this.#cycle(cycleId);
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async promoteCycle(cycleId) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const cycle = this.database.prepare("SELECT * FROM cycles WHERE id = ?").get(cycleId);
      if (!cycle) throw new StoreError("not_found", "cycle not found");
      if (cycle.status === "open") throw new StoreError("conflict", "close the cycle before promotion");
      if (cycle.status === "promoted") {
        const existing = releaseRow(
          this.database.prepare("SELECT * FROM releases WHERE cycle_id = ?").get(cycleId),
        );
        this.database.exec("COMMIT");
        return existing;
      }

      const winner = this.database.prepare(`
        SELECT c.id, c.preview_url, c.metadata, p.prompt
        FROM candidates c JOIN proposals p ON p.id = c.proposal_id
        WHERE c.id = ? AND c.cycle_id = ?
      `).get(cycle.winner_candidate_id, cycleId);
      if (!winner) throw new StoreError("conflict", "cycle has no winner");

      const result = this.database.prepare(`
        INSERT INTO releases (cycle_id, candidate_id, label, prompt, preview_url, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(cycleId, winner.id, cycle.label, winner.prompt, winner.preview_url, winner.metadata);
      this.database.prepare(`
        UPDATE cycles SET status = 'promoted',
          promoted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(cycleId);
      this.database.exec("COMMIT");
      return releaseRow(this.database.prepare("SELECT * FROM releases WHERE id = ?").get(result.lastInsertRowid));
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async dashboard(voterId = null) {
    const proposals = this.database.prepare("SELECT * FROM proposals ORDER BY id DESC").all().map(proposalRow);
    const cycleSummary = this.database.prepare(`
      SELECT * FROM cycles
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC
      LIMIT 1
    `).get();
    const cycle = cycleSummary ? this.#cycle(cycleSummary.id, voterId) : null;
    const history = this.database.prepare("SELECT * FROM releases ORDER BY id ASC").all().map(releaseRow);
    const latest = history.at(-1) ?? null;

    return {
      currentProduction: latest
        ? { source: "release", previewUrl: latest.previewUrl, releaseId: latest.id }
        : { source: "bundled", previewUrl: "/world/index.html", releaseId: null },
      cycle,
      proposals,
      history,
    };
  }

  async close() {
    this.database.close();
  }

  #cycle(cycleId, voterId = null) {
    const row = this.database.prepare("SELECT * FROM cycles WHERE id = ?").get(cycleId);
    if (!row) return null;
    const candidates = this.database.prepare(`
      SELECT c.*, p.prompt, COUNT(v.candidate_id) AS votes
      FROM candidates c
      JOIN proposals p ON p.id = c.proposal_id
      LEFT JOIN votes v ON v.candidate_id = c.id AND v.cycle_id = c.cycle_id
      WHERE c.cycle_id = ?
      GROUP BY c.id
      ORDER BY c.id ASC
    `).all(cycleId).map(candidateRow);
    const hasVoted = voterId
      ? Boolean(this.database.prepare(
        "SELECT 1 FROM votes WHERE cycle_id = ? AND voter_id = ?",
      ).get(cycleId, voterId))
      : false;

    return {
      id: number(row.id),
      label: row.label,
      status: row.status,
      winnerCandidateId: number(row.winner_candidate_id),
      createdAt: row.created_at,
      closedAt: row.closed_at,
      promotedAt: row.promoted_at,
      hasVoted,
      candidates,
    };
  }
}
