// Dev-only: fetches full articles from news50.sa into data/seed-news.json and downloads cover images to data/uploads.
import { mkdirSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const L = "https://news50.sa/%d8%a7%d9%84%d9%85%d8%ad%d9%84%d9%8a%d8%a9/";
const site = (p) => `https://news50.sa/${p}/`;
const sources = {
  local: [
    L + "saudi-import-licenses-new-regulations/",
    L + "prince-of-al-qassim-decorates-prisons-director-rank-of-major-general/",
    L + "jazan-governor-reviews-human-resources-branch-report-2026/",
    L + "saudi-new-mechanism-for-lawyers-accountability/",
  ],
  politics: [
    "politics/saudi-deputy-foreign-minister-meets-denmark-japan-ambassadors",
    "politics/tribal-military-mobilization-defeat-houthis-al-bayda",
    "politics/spain-housing-crisis-protests-early-elections",
    "politics/saudi-strategic-patience-houthi-attacks",
  ].map(site),
  sports: [
    "sports/uae-planes-fans-jeddah-khaleeji-27-final",
    "sports/cristiano-ronaldo-returns-al-nassr-training-diriyah-match",
    "sports/roger-ibanez-al-ahli-vs-al-nassr-match-fitness",
    "sports/ronaldo-returns-riyadh-jesus-meeting-details",
  ].map(site),
  culture: [
    "culture/sheikh-ismail-bin-mubairik-rabigh-history",
    "culture/rabeh-sager-new-album-1980s-surprise",
    "culture/basma-wahba-retirement-hints-family-reasons",
    "culture/lucy-retirement-ahmed-elawady-defense",
  ].map(site),
  tech: [
    "tech/saudi-digital-transformation-experience-engineering",
    "tech/stc-group-wins-platinum-game-operator-award-2026",
    "tech/pentagon-autonomous-warfare-command-ai-weapons",
    "tech/pentagon-data-leak-millions-exposed",
  ].map(site),
};

const decode = (s = "") =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const text = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const meta = (html, prop) => {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? decode(m[1]) : "";
};

function extractBody(html) {
  const start = html.indexOf('id="mvp-content-main"');
  if (start < 0) return [];
  let end = html.indexOf("mvp-post-tags", start);
  if (end < 0) end = html.length;
  const block = html.slice(start, end);
  const parts = [];
  for (const m of block.matchAll(/<(h[2-4]|p)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = text(m[2]);
    if (t.length < 2) continue;
    parts.push(m[1].toLowerCase() === "p" ? t : `## ${t}`);
  }
  return parts;
}

function extractTags(html) {
  const start = html.indexOf('class="mvp-post-tags"');
  if (start < 0) return [];
  const block = html.slice(start, start + 3000);
  return [...new Set([...block.matchAll(/rel="tag"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => text(m[1])).filter(Boolean))].slice(0, 6);
}

mkdirSync(new URL("../data/uploads/", import.meta.url), { recursive: true });

const out = [];
let n = 0;
for (const [category, urls] of Object.entries(sources)) {
  for (const url of urls) {
    try {
      const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
      const imgUrl = meta(html, "og:image");
      let image = "";
      if (imgUrl) {
        const ext = (extname(new URL(imgUrl).pathname) || ".jpg").toLowerCase().replace(".jfif_", ".jpg");
        const name = `seed-${++n}${[".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg"}`;
        const res = await fetch(imgUrl, { headers: { "user-agent": "Mozilla/5.0" } });
        writeFileSync(new URL(`../data/uploads/${name}`, import.meta.url), Buffer.from(await res.arrayBuffer()));
        image = name;
      }
      const body = extractBody(html);
      out.push({
        category,
        url,
        title: meta(html, "og:title").replace(/\s*[-|–]\s*أخبار السعودية.*$/, ""),
        excerpt: meta(html, "og:description"),
        image,
        date: (meta(html, "article:published_time") || new Date().toISOString()).slice(0, 10),
        tags: extractTags(html),
        body: body.join("\n\n"),
      });
      console.log("ok", category, body.length, "blocks");
    } catch (e) {
      console.log("fail", url, e.message);
    }
  }
}
writeFileSync(new URL("../data/seed-news.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("total", out.length);
