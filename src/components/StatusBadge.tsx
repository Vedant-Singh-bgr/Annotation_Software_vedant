const STYLES: Record<string, string> = {
  ASSIGNED: "bg-slate-700/50 text-slate-300",
  IN_PROGRESS: "bg-amber-900/40 text-amber-300",
  SUBMITTED: "bg-blue-900/40 text-blue-300",
  APPROVED: "bg-green-900/40 text-green-300",
  REJECTED: "bg-red-900/40 text-red-300",
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
    <span className={`badge ${STYLES[status] ?? "bg-slate-700/50 text-slate-300"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
