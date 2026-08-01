import { UserSelector } from "@/components/user-selector";
import { QueueTable } from "@/components/queue-table";
import { getCurrentUser, listSeededUsers } from "@/lib/auth";
import { findWorkspaceItemsCursor } from "@/lib/items";
import type { ItemRecord } from "@/lib/items";
import { loadMoreItems } from "./actions";

export const dynamic = "force-dynamic";

async function QueueDataLoader() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-500">Sign in to view the queue</p>
      </div>
    );
  }

  const workspaces = user.memberships.map((m) => ({
    id: m.workspaceId,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
  }));

  const workspaceIds = workspaces.map((w) => w.id);

  const items = await findWorkspaceItemsCursor({
    workspaceIds,
    limit: 50,
  });

  // Count from Prisma (separate query — fine for initial page load)
  const { prisma } = await import("@/lib/db");
  const totalCount = await prisma.item.count({
    where: {
      workspaceId: { in: workspaceIds },
      status: { not: "RESOLVED" },
    },
  });

  const canMutate = workspaces.some(
    (w) => w.role === "OWNER" || w.role === "MEMBER",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">
          {user.name}
        </span>
        {workspaces.map((w) => (
          <span
            key={w.id}
            className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium ring-1 ring-slate-200"
          >
            {w.slug}: {w.role.toLowerCase()}
          </span>
        ))}
      </div>
      <QueueTable
        initialItems={items}
        canMutate={canMutate}
        currentUserName={user.name}
        hasMore={items.length < totalCount}
        loadMoreAction={loadMoreItems}
        label="Queue"
        initialTotalCount={totalCount}
      />
    </div>
  );
}

export default async function Home() {
  const [users, currentUser] = await Promise.all([
    listSeededUsers(),
    getCurrentUser(),
  ]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 sm:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <UserSelector currentUser={currentUser} users={users} />

        {currentUser ? (
          <QueueDataLoader />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-500">Sign in to view the queue</p>
          </div>
        )}
      </div>
    </main>
  );
}
