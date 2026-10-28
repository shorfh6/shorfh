export function securePgConnectionOptions(
  connectionString: string,
  options?: { disableSsl?: boolean; ca?: string },
): { connectionString: string; ssl: false | { rejectUnauthorized: true; ca?: string } };
