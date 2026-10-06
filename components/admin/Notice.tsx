import { flash } from "@/lib/format";

export default function Notice({ m, e }: { m?: string; e?: string }) {
  const { ok, error } = flash(m, e);
  if (!ok && !error) return null;
  return <div className={`notice ${error ? "err" : "ok"}`}>{error ?? ok}</div>;
}
