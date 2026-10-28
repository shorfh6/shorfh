// No environment loading, connection, or I/O. Shared by the web app and operators.
export function securePgConnectionOptions(connectionString, { disableSsl = false, ca } = {}) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error("PG_CONNECTION_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("PG_CONNECTION_URL_INVALID");

  // pg replaces the explicit ssl object when these URL parameters are present.
  // Certificates are supplied through the dedicated CA option, never file URLs.
  for (const parameter of ["ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation"]) {
    if (url.searchParams.has(parameter)) throw new Error("PG_TLS_OPTIONS_MUST_BE_EXPLICIT");
  }
  const disabled = disableSsl || url.searchParams.get("sslmode") === "disable";
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (disabled && !loopback) throw new Error("PG_TLS_REQUIRED");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  const certificate = ca?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: disabled ? false : { rejectUnauthorized: true, ...(certificate ? { ca: certificate } : {}) },
  };
}
