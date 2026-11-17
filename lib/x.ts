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

/** Builds the canonical announcement text: title + excerpt padding (>=200 chars) + URL + topical hashtags. */
export function composeArticleTweet(a: { title: string; excerpt?: string | null; hashtags?: string[]; url: string }) {
  const tags = [...new Set((a.hashtags ?? []).map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean))]
    .slice(0, 3)
    .map((t) => `#${t}`)
    .join(" ");
  const tagBlock = tags ? `\n${tags}` : "";
  const linkLen = 23; // X wraps every URL at ~23 chars regardless of length.
  const room = 280 - linkLen - 2 - tagBlock.length; // blank line before the URL
  let text = a.title.replace(/\s+/g, " ").trim();
  if (text.length > room) text = `${text.slice(0, room - 1)}…`;
  else if (a.excerpt) {
    const ex = a.excerpt.replace(/\s+/g, " ").trim();
    const remaining = room - text.length - 1;
    if (ex && remaining > 40) text += `\n${ex.length > remaining ? `${ex.slice(0, remaining - 1)}…` : ex}`;
  }
  return `${text}\n\n${a.url}${tagBlock}`;
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
    const a = await one<{ id: number; title: string; excerpt: string; category: string; tags: string }>(
      `SELECT a.id,a.title,a.excerpt,c.name AS category,
         COALESCE((SELECT string_agg(t.name,' ') FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id),'') AS tags
       FROM articles a JOIN categories c ON c.id=a.category_id WHERE a.id=$1`,
      [articleId],
    );
    if (!a) return;
    const hashtags = [...a.tags.split(/\s+/).filter(Boolean), a.category];
    const text = composeArticleTweet({ title: a.title, excerpt: a.excerpt, hashtags, url: absoluteUrl(`/article/${a.id}`) });
    const tweetId = await postTweet(text);
    if (tweetId) await exec("INSERT INTO article_x_posts(article_id,tweet_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [a.id, tweetId]);
  } catch {
    // Announcement failures must never block or fail publishing.
  }
}
