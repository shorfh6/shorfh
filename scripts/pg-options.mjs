// Shared pg connection options — mirrors lib/db.ts pgConnectionOptions() (plain JS for scripts).
export function pgConnectionOptions() {
  const url = new URL(process.env.DATABASE_URL);
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
