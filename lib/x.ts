import { createHmac, randomBytes } from "node:crypto";
import { exec, one } from "./db";
import { absoluteUrl } from "./seo";

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function xCredentials() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) return undefined;
  return { key: X_API_KEY, secret: X_API_SECRET, token: X_ACCESS_TOKEN, tokenSecret: X_ACCESS_TOKEN_SECRET };
}

function oauthHeader(method: string, url: string) {
  const creds = xCredentials();
  if (!creds) return undefined;
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}=${pct(oauth[k])}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  oauth.oauth_signature = createHmac("sha1", `${pct(creds.secret)}&${pct(creds.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}

async function postTweet(text: string) {
  const url = "https://api.x.com/2/tweets";
  const authorization = oauthHeader("POST", url);
  if (!authorization) return undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`x_api_${res.status}`);
  const body = await res.json();
  return String(body?.data?.id ?? "");
}

/** Posts a link to a freshly published article on X. Never throws into the publish path. */
export async function announceArticleOnX(articleId: number) {
  if (!xCredentials()) return;
  try {
    if (await one("SELECT 1 FROM article_x_posts WHERE article_id=$1", [articleId])) return;
    const a = await one<{ id: number; title: string }>("SELECT id,title FROM articles WHERE id=$1", [articleId]);
    if (!a) return;
    const url = absoluteUrl(`/article/${a.id}`);
    const room = 280 - 24 - 2; // t.co wraps links at ~23 chars, plus the blank line.
    const title = a.title.length > room ? `${a.title.slice(0, room - 1)}…` : a.title;
    const tweetId = await postTweet(`${title}\n\n${url}`);
    if (tweetId) await exec("INSERT INTO article_x_posts(article_id,tweet_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [a.id, tweetId]);
  } catch {
    // Announcement failures must never block or fail publishing.
  }
}
