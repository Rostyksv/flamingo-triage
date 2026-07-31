import "server-only";

import { type CurrentUser } from "@/lib/auth";

export type WorkspaceAccess = {
  canRead: boolean;
  canMutate: boolean;
  role: string | null;
  membershipId: string | null;
};

export type AuthCheck =
  | { allowed: true; access: WorkspaceAccess }
  | { allowed: false; status: number; body: Record<string, string> };

export function deriveWorkspaceAccess(
  user: CurrentUser,
  workspaceId: string,
): WorkspaceAccess {
  const membership = user.memberships.find(
    (m) => m.workspaceId === workspaceId,
  );

  if (!membership) {
    return { canRead: false, canMutate: false, role: null, membershipId: null };
  }

  if (membership.role === "VIEWER") {
    return {
      canRead: true,
      canMutate: false,
      role: "VIEWER",
      membershipId: membership.id,
    };
  }

  return {
    canRead: true,
    canMutate: true,
    role: membership.role,
    membershipId: membership.id,
  };
}

export function checkCanMutate(
  user: CurrentUser | null,
  workspaceId: string,
): AuthCheck {
  if (!user) {
    return {
      allowed: false,
      status: 401,
      body: { error: "Not authenticated" },
    };
  }

  const access = deriveWorkspaceAccess(user, workspaceId);

  if (!access.canRead) {
    return { allowed: false, status: 404, body: { error: "Not found" } };
  }

  if (!access.canMutate) {
    return {
      allowed: false,
      status: 403,
      body: {
        error: "Forbidden",
        reason: "role_not_allowed",
        detail: `Role '${access.role}' cannot mutate items`,
      },
    };
  }

  return { allowed: true, access };
}
