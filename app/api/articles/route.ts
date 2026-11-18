import { listArticles } from "@/lib/queries";

export const dynamic = "force-dynamic";

const FIELDS = { publicOnly: true } as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(0, Math.min(200, Number(searchParams.get("page")) || 0));
  const limit = 9;
  const ex = (searchParams.get("ex") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n < 1e9)
    .slice(0, 60);
  const { rows, total } = await listArticles({
    ...FIELDS,
    excludeIds: ex.length ? ex : undefined,
    limit,
    offset: page * limit,
  });
  return Response.json({
    items: rows,
    hasMore: (page + 1) * limit < total,
    page,
  });
}
