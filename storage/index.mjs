import { join } from "node:path";
import { FirestoreTournamentStore } from "./firestore.mjs";
import { SQLiteTournamentStore } from "./sqlite.mjs";

export function createTournamentStore({
  backend = process.env.DATABASE_BACKEND ?? "sqlite",
  databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "tournament.sqlite"),
} = {}) {
  if (backend === "sqlite") {
    return new SQLiteTournamentStore(databasePath);
  }

  if (backend === "firestore") {
    return new FirestoreTournamentStore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      databaseId: process.env.FIRESTORE_DATABASE_ID,
      namespace: process.env.FIRESTORE_NAMESPACE ?? "hello-ai-world",
    });
  }

  throw new Error(`unsupported DATABASE_BACKEND: ${backend}`);
}
