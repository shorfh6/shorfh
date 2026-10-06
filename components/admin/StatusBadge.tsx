import { statusLabels } from "@/lib/format";

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge-s s-${status}`}>{statusLabels[status] ?? status}</span>;
}
