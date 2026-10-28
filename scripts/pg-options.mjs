import { securePgConnectionOptions } from "../lib/pg-connection-options.mjs";

export function pgConnectionOptions() {
  return securePgConnectionOptions(process.env.DATABASE_URL, {
    disableSsl: process.env.DATABASE_SSL === "false",
    ca: process.env.DATABASE_CA_CERT,
  });
}
