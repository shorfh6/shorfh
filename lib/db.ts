import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const g = globalThis as unknown as { __shurfaDb?: Database.Database };

function open() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const conn = new Database(path.join(DATA_DIR, "shurfa.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8"));
  return conn;
}

export const db = (g.__shurfaDb ??= open());
