import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE_NAME = "flamingo_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  issuedAt: number;
};

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 24) {
    throw new Error("AUTH_SECRET must be set to a value of at least 24 characters.");
  }

  return secret;
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    if (typeof parsed.userId !== "string" || typeof parsed.issuedAt !== "number") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function sign(value: string) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken(userId: string) {
  const encoded = encodePayload({ userId, issuedAt: Date.now() });
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  const [encoded, signature, extra] = token.split(".");

  if (!encoded || !signature || extra) {
    return null;
  }

  if (!safeEqual(signature, sign(encoded))) {
    return null;
  }

  return decodePayload(encoded);
}

export async function setSessionCookie(userId: string) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      memberships: {
        include: { workspace: true },
        orderBy: [{ workspace: { name: "asc" } }],
      },
    },
  });
}

export async function listSeededUsers() {
  return prisma.user.findMany({
    include: {
      memberships: {
        include: { workspace: true },
        orderBy: [{ workspace: { name: "asc" } }],
      },
    },
    orderBy: { name: "asc" },
  });
}
