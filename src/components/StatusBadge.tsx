const STYLES: Record<string, string> = {
  ASSIGNED: "border-ink-900/15 bg-ink-900/[0.04] text-ink-600",
  IN_PROGRESS: "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow",
  SUBMITTED: "border-accent-blue/30 bg-accent-blue/10 text-accent-blue",
  APPROVED: "border-accent-green/30 bg-accent-green/10 text-accent-green",
  REJECTED: "border-accent-red/30 bg-accent-red/10 text-accent-red",
};

const LABELS: Record<string, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "border-ink-900/15 bg-ink-900/[0.04] text-ink-600"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
