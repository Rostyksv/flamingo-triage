import type { ItemStatus, ItemPriority } from "@prisma/client";

type Props = {
  status: ItemStatus | string;
};

const statusStyles: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-700 ring-slate-300",
  CLAIMED: "bg-amber-50 text-amber-800 ring-amber-300",
  RESOLVED: "bg-emerald-50 text-emerald-800 ring-emerald-300",
};

export function ItemStatusBadge({ status }: Props) {
  const style = statusStyles[status] ?? statusStyles.QUEUED;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {status.toLowerCase()}
    </span>
  );
}

type PriorityBadgeProps = {
  priority: ItemPriority | string;
};

const priorityStyles: Record<string, string> = {
  LOW: "text-slate-500",
  NORMAL: "text-slate-700",
  HIGH: "text-orange-600",
  URGENT: "text-red-600 font-semibold",
};

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const style = priorityStyles[priority] ?? priorityStyles.NORMAL;

  return (
    <span className={`text-xs ${style}`}>
      {priority.toLowerCase()}
    </span>
  );
}
