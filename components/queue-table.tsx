"use client";

import { useState, useCallback } from "react";
import { ItemStatusBadge } from "./item-status";
import { Button } from "./button";

type QueueItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  claimedById: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  workspaceId: string;
  claimedBy: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; slug: string };
  notificationStatus?: string;
};

type ActionMessage = {
  type: "success" | "error" | "info";
  text: string;
} | null;

type Props = {
  initialItems: QueueItem[];
  canMutate: boolean;
  currentUserName: string;
  hasMore: boolean;
  loadMoreAction: (offset: number) => Promise<QueueItem[]>;
  label: string;
};

export function QueueTable({
  initialItems,
  canMutate,
  currentUserName,
  hasMore: initialHasMore,
  loadMoreAction,
  label,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);
  const [pendingActions, setPendingActions] = useState<Map<string, string>>(new Map());

  const doAction = useCallback(
    async (itemId: string, action: "claim" | "release" | "resolve") => {
      setActionMessage(null);
      setPendingActions((prev) => new Map(prev).set(itemId, action));

      try {
        const res = await fetch(`/api/items/${itemId}/${action}`, {
          method: "POST",
          credentials: "same-origin",
        });

        const body = await res.json();

        if (!res.ok) {
          if (res.status === 409 && action === "claim" && body.currentHolder) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === itemId
                  ? {
                      ...it,
                      status: body.itemStatus ?? "CLAIMED",
                      claimedById: body.currentHolder?.id ?? null,
                      claimedBy: body.currentHolder ?? null,
                    }
                  : it,
              ),
            );
            setActionMessage({
              type: "info",
              text: `Already claimed by ${body.currentHolder?.name ?? "another user"}`,
            });
          } else {
            setActionMessage({
              type: "error",
              text: body.reason ?? body.error ?? `${action} failed`,
            });
          }
          return;
        }

        if (action === "claim") {
          setItems((prev) =>
            prev.map((it) =>
              it.id === itemId
                ? {
                    ...it,
                    status: "CLAIMED",
                    claimedById: currentUserName as unknown as string,
                    claimedBy: {
                      id: "",
                      name: currentUserName,
                      email: "",
                    },
                  }
                : it,
            ),
          );
          setActionMessage({ type: "success", text: "Claimed" });
        } else if (action === "release") {
          setItems((prev) =>
            prev.map((it) =>
              it.id === itemId
                ? {
                    ...it,
                    status: "QUEUED",
                    claimedById: null,
                    claimedBy: null,
                  }
                : it,
            ),
          );
          setActionMessage({ type: "success", text: "Released" });
        } else if (action === "resolve") {
          setItems((prev) =>
            prev.filter((it) => it.id !== itemId),
          );
          setActionMessage({
            type: "success",
            text: "Resolved — removed from queue",
          });
        }
      } catch {
        setActionMessage({ type: "error", text: "Network error" });
      } finally {
        setPendingActions((prev) => {
          const next = new Map(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [currentUserName],
  );

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const newItems = await loadMoreAction(items.length);
      setItems((prev) => [...prev, ...newItems]);
      if (newItems.length < 50) setHasMore(false);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  }, [loadMoreAction, items.length]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="p-8 text-center text-sm text-slate-400">
          No items
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>

      {actionMessage && (
        <div
          className={`border-b px-4 py-2.5 text-sm ${
            actionMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : actionMessage.type === "info"
                ? "border-sky-200 bg-sky-50 text-sky-800"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {actionMessage.text}
          <button
            className="ml-3 text-xs underline cursor-pointer"
            onClick={() => setActionMessage(null)}
          >
            dismiss
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5">Title</th>
              <th className="px-3 py-2.5 hidden sm:table-cell">Priority</th>
              <th className="px-3 py-2.5 align-middle text-center">Status</th>
              <th className="px-3 py-2.5 hidden md:table-cell">Holder</th>
              <th className="px-3 py-2.5 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, idx) => {
              const isHeldByMe =
                item.status === "CLAIMED" &&
                item.claimedBy?.name === currentUserName;
              const pendingAction = pendingActions.get(item.id);

              return (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {item.title}
                      </p>
                      <p className="hidden sm:block mt-0.5 text-xs text-slate-500 truncate">
                        {item.description}
                      </p>
                      <p className="sm:hidden mt-0.5 text-xs text-slate-400">
                        {item.priority.toLowerCase()}
                        {item.claimedBy?.name && <> · {item.claimedBy.name}</>}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span
                      className={`text-xs font-medium ${
                        item.priority === "URGENT"
                          ? "text-red-600"
                          : item.priority === "HIGH"
                            ? "text-orange-600"
                            : "text-slate-600"
                      }`}
                    >
                      {item.priority.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap align-middle text-center">
                    <ItemStatusBadge status={item.status} />
                    {item.notificationStatus && (
                      <span className="hidden sm:inline ml-1.5 text-xs text-slate-400">
                        notify: {item.notificationStatus.toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs text-slate-600">
                    {item.claimedBy?.name ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap align-middle text-center">
                    {!canMutate ? (
                      <span className="text-xs text-slate-400">Read-only</span>
                    ) : item.status === "QUEUED" ? (
                      <Button
                        size="xs"
                        pending={pendingAction === "claim"}
                        disabled={pendingAction != null}
                        onClick={() => doAction(item.id, "claim")}
                      >
                        Claim
                      </Button>
                    ) : item.status === "CLAIMED" && isHeldByMe ? (
                      <div className="flex flex-col gap-0.5">
                        <Button
                          variant="secondary"
                          size="xs"
                          pending={pendingAction === "release"}
                          disabled={pendingAction != null}
                          onClick={() => doAction(item.id, "release")}
                        >
                          Release
                        </Button>
                        <Button
                          variant="success"
                          size="xs"
                          pending={pendingAction === "resolve"}
                          disabled={pendingAction != null}
                          onClick={() => doAction(item.id, "resolve")}
                        >
                          Resolve
                        </Button>
                      </div>
                    ) : item.status === "CLAIMED" ? (
                      <span className="text-xs text-slate-400">
                        Held by {item.claimedBy?.name ?? "other"}
                      </span>
                    ) : item.status === "RESOLVED" ? (
                      <span className="text-xs text-slate-400">
                        Completed by {item.claimedBy?.name ?? "—"}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-400">
        <span>
          {items.length} item{items.length !== 1 ? "s" : ""}
          {!canMutate && " · viewer mode"}
        </span>
        {hasMore && (
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingMore}
            pending={loadingMore}
            onClick={loadMore}
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
