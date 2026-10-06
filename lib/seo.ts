const configuredOrigin =
  process.env.SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3001");

export const siteOrigin = new URL(configuredOrigin).origin;
export const absoluteUrl = (path: string) => new URL(path, `${siteOrigin}/`).toString();
