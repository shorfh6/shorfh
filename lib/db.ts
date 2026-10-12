import { Pool, types } from "pg";

types.setTypeParser(1184, (v: string) => new Date(v).toISOString()); // timestamptz -> ISO string (keeps formatDate etc. working)
types.setTypeParser(1114, (v: string) => new Date(v + "Z").toISOString());
types.setTypeParser(20, (v: string) => Number(v)); // int8
types.setTypeParser(1700, (v: string) => Number(v)); // numeric

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

export function pgConnectionOptions() {
  const url = new URL(process.env.DATABASE_URL!);
  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  const disabled = process.env.DATABASE_SSL === "false" || mode === "disable";
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: disabled ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

const g = globalThis as unknown as { __shurfaPool?: Pool };

const pool = (g.__shurfaPool ??= new Pool({ ...pgConnectionOptions(), max: 5, idleTimeoutMillis: 30_000 }));

export type SqlValue = string | number | boolean | null;

export async function query<T = unknown>(text: string, params?: SqlValue[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = unknown>(text: string, params?: SqlValue[]): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function exec(text: string, params?: SqlValue[]): Promise<number> {
  const res = await pool.query(text, params);
  return res.rowCount ?? 0;
}

export type Q = { query: typeof query; one: typeof one; exec: typeof exec };

export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const q: Q = {
    query: async <R = unknown>(text: string, params?: SqlValue[]) => (await client.query(text, params)).rows as R[],
    one: async <R = unknown>(text: string, params?: SqlValue[]) => (await client.query(text, params)).rows[0] as R | undefined,
    exec: async (text: string, params?: SqlValue[]) => (await client.query(text, params)).rowCount ?? 0,
  };
  try {
    await client.query("BEGIN");
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
