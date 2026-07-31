import { selectSeededUser, signOut } from "@/app/actions";
import type { CurrentUser } from "@/lib/auth";
import { Button } from "@/components/button";

type SeededUser = {
  id: string;
  name: string;
  email: string;
  memberships: {
    role: string;
    workspace: {
      name: string;
      slug: string;
    };
  }[];
};

type UserSelectorProps = {
  users: SeededUser[];
  currentUser: CurrentUser | null;
};

export function UserSelector({ users, currentUser }: UserSelectorProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Seeded login
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            Flamingo triage setup
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Pick a seeded user. The server sets a signed, HTTP-only cookie; no real OAuth is
            built for this assignment.
          </p>
        </div>

        {currentUser ? (
          <form action={signOut}>
            <Button variant="secondary" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        ) : null}
      </div>

      {currentUser ? (
        <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">
          <p className="font-medium">Signed in as {currentUser.name}</p>
          <p className="mt-1 text-emerald-800">{currentUser.email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {currentUser.memberships.map((membership) => (
              <span
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200"
                key={membership.id}
              >
                {membership.workspace.name}: {membership.role.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <form action={selectSeededUser} className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          User
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none ring-sky-500 focus:ring-2"
            defaultValue={currentUser?.id ?? ""}
            name="userId"
            required
          >
            <option disabled value="">
              Choose a seeded user
            </option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} — {user.memberships
                  .map((m) => `${m.workspace.slug}:${m.role.toLowerCase()}`)
                  .join(", ")}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="md:self-end">
          Use selected user
        </Button>
      </form>
    </section>
  );
}
