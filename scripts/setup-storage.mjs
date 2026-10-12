// Idempotently creates the private Supabase Storage bucket for article images. Usage: node scripts/setup-storage.mjs
try {
  process.loadEnvFile(".env.local");
} catch {}

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "article-images";

if (!base || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const res = await fetch(`${base}/storage/v1/bucket`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
  body: JSON.stringify({
    id: bucket,
    name: bucket,
    public: false,
    file_size_limit: 5242880,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  }),
});

if (res.ok) {
  console.log(`Bucket '${bucket}' created.`);
} else {
  const body = await res.text().catch(() => "");
  if (res.status === 409 || /already exists|duplicate/i.test(body)) {
    console.log(`Bucket '${bucket}' already exists.`);
  } else {
    console.error(`Failed to create bucket (${res.status})`);
    process.exit(1);
  }
}
