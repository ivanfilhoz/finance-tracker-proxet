import { reconcileBudgets } from "#/server/budget-alerts.server";
import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "#/db";
import { env } from "#/server/env";
import { m } from "#/paraglide/messages";
import {
  consumeAuthToken,
  createAuthToken,
  hashToken,
  PASSWORD_RESET_TTL_MS,
  VERIFY_EMAIL_TTL_MS,
} from "#/server/auth-tokens.server";
import { sendEmail } from "#/server/email";
import { getLogger } from "#/server/logger";
import { checkPasswordPolicy } from "#/server/password-policy";
import {
  checkRateLimit,
  clearAuthFailures,
  isLockedOut,
  recordAuthFailure,
} from "#/server/rate-limit";
import {
  resolveSessionUser,
  rotateSession,
  useAppSession,
} from "#/server/session";


const DUMMY_HASH =
  "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";

// Login stays permissive (existing accounts may predate the policy);
// registration enforces the password policy. The identifier is an email or
// a legacy username.
const credentialsSchema = z.object({
  identifier: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});

// Password length/strength is enforced by checkPasswordPolicy inside the
// handler (not the schema) so violations surface as a graceful `{ error }`
// the form can display, rather than a thrown validation error.
const registerSchema = z.object({
  username: z.string().min(1).max(32),
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(255)),
  password: z.string().min(1).max(128),
  // CAPTCHA hook point — validated only when CAPTCHA_ENABLED=1.
  captchaToken: z.string().optional(),
});

const tokenSchema = z.object({ token: z.string().min(1).max(256) });


const AUTH_WINDOW_MS = 15 * 60_000;
// Sliding windows: 10 attempts / 15 min per IP and per identifier. Relaxed
// in TEST_MODE so the parallel E2E suite (which shares one IP) doesn't trip
// them; the progressive lockout below stays active and is covered by E2E.
const testModeFactor = env.isTestMode ? 10_000 : 1;
const IP_LIMIT = { limit: 10 * testModeFactor, windowMs: AUTH_WINDOW_MS };
const IDENTIFIER_LIMIT = {
  limit: 10 * testModeFactor,
  windowMs: AUTH_WINDOW_MS,
};
// Email-sending endpoints get a tighter per-target window so an attacker
// cannot flood a victim's inbox. Loosened in TEST_MODE like the rest.
const EMAIL_SEND_LIMIT = { limit: 3 * testModeFactor, windowMs: AUTH_WINDOW_MS };

const GENERIC_THROTTLE_ERROR = "Too many attempts. Please try again later.";

function getClientIp(): string {
  const forwarded = getRequestHeader("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function throttled(retryAfterSeconds: number) {
  setResponseHeader("Retry-After", String(retryAfterSeconds));
  return { error: GENERIC_THROTTLE_ERROR, retryAfterSeconds };
}

// CAPTCHA hook point: ships disabled. When CAPTCHA_ENABLED=1, registration
// fails closed until a real provider verification is wired in here.
function verifyCaptcha(token: string | undefined): boolean {
  if (!env.captchaEnabled) return true;
  if (!token) return false;
  // TODO: call the CAPTCHA provider's verify endpoint (e.g. Turnstile/
  // reCAPTCHA) when a provider is chosen. Fail closed until then.
  return false;
}


async function sendVerificationEmail(userId: string, email: string) {
  const token = await createAuthToken(userId, "verify_email", VERIFY_EMAIL_TTL_MS);
  await sendEmail({
    to: email,
    subject: m.email_verify_subject(),
    text: m.email_verify_body({
      link: `${env.email.baseUrl}/verify-email?token=${token}`,
    }),
  });
}

export const hasUsers = createServerFn({ method: "GET" }).handler(async () => {
  const users = await db.select().from(schema.users).limit(1);
  return users.length > 0;
});

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await resolveSessionUser();
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      // Legacy accounts without an email predate verification — nothing to
      // verify, so they are not prompted.
      emailVerified: user.email ? user.email_verified_at != null : true,
    };
  },
);

export const register = createServerFn({ method: "POST" })
  .inputValidator(registerSchema)
  .handler(async ({ data }) => {
    const ipCheck = checkRateLimit(`auth:ip:${getClientIp()}`, IP_LIMIT);
    if (!ipCheck.allowed) {
      return throttled(ipCheck.retryAfterSeconds);
    }

    if (!verifyCaptcha(data.captchaToken)) {
      return { error: "CAPTCHA verification failed" };
    }

    const policyError = checkPasswordPolicy(data.password, data.username);
    if (policyError) {
      return { error: policyError };
    }

    const existingUsername = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, data.username))
      .limit(1);
    if (existingUsername.length > 0) {
      return { error: "Username already taken" };
    }

    const existingEmail = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, data.email))
      .limit(1);
    if (existingEmail.length > 0) {
      return { error: "An account with this email already exists" };
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const id = crypto.randomUUID();

    await db.insert(schema.users).values({
      id,
      username: data.username,
      email: data.email,
      password_hash: passwordHash,
    });

    // Account starts unverified; browsing is allowed, AI spend is gated on
    // verification. Send failures must not strand the fresh account.
    try {
      await sendVerificationEmail(id, data.email);
    } catch (error) {
      getLogger().error({ err: error }, "failed to send verification email");
    }

    // Rotate the session on privilege change (fresh identity, no fixation)
    await rotateSession({ userId: id, username: data.username, sessionVersion: 0 });

    throw redirect({ to: "/dashboard" });
  });

export const login = createServerFn({ method: "POST" })
  .inputValidator(credentialsSchema)
  .handler(async ({ data }) => {
    const ipCheck = checkRateLimit(`auth:ip:${getClientIp()}`, IP_LIMIT);
    if (!ipCheck.allowed) {
      return throttled(ipCheck.retryAfterSeconds);
    }

    const identifier = data.identifier.trim().toLowerCase();
    const identifierKey = `login:user:${identifier}`;
    const lockout = isLockedOut(identifierKey);
    if (!lockout.allowed) {
      return throttled(lockout.retryAfterSeconds);
    }
    const identifierCheck = checkRateLimit(identifierKey, IDENTIFIER_LIMIT);
    if (!identifierCheck.allowed) {
      return throttled(identifierCheck.retryAfterSeconds);
    }

    // The identifier is an email for accounts created since email identity
    // landed, or a legacy username. Emails are stored lowercased; legacy
    // usernames keep their original case, so try the raw value too.
    const byEmail = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, identifier))
      .limit(1);
    const byUsername =
      byEmail.length > 0
        ? []
        : await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.username, data.identifier.trim()))
            .limit(1);

    const user = byEmail[0] ?? byUsername[0];
    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(data.password, hashToCheck);
    const ok = user != null && passwordMatches;

    if (!ok) {
      recordAuthFailure(identifierKey);
      return { error: "Invalid credentials" };
    }

    clearAuthFailures(identifierKey);

    // Rotate the session on privilege change (fresh identity, no fixation)
    await rotateSession({
      userId: user.id,
      username: user.username,
      sessionVersion: user.session_version,
    });

    throw redirect({ to: "/dashboard" });
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useAppSession();
  await session.clear();
  throw redirect({ to: "/login" });
});


export const verifyEmail = createServerFn({ method: "POST" })
  .inputValidator(tokenSchema)
  .handler(async ({ data }) => {
    const userId = await consumeAuthToken(data.token, "verify_email");
    if (!userId) {
      return { error: "This verification link is invalid or has expired." };
    }
    await db
      .update(schema.users)
      .set({ email_verified_at: new Date() })
      .where(eq(schema.users.id, userId));
    await reconcileBudgets(userId);
    return { success: true };
  });

export const resendVerification = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await resolveSessionUser();
    if (!user) {
      throw new Response("Unauthorized", { status: 401 });
    }
    if (!user.email || user.email_verified_at) {
      return { success: true };
    }
    const limit = checkRateLimit(`verify-email:${user.id}`, EMAIL_SEND_LIMIT);
    if (!limit.allowed) {
      return throttled(limit.retryAfterSeconds);
    }
    await sendVerificationEmail(user.id, user.email);
    return { success: true };
  },
);

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(255)),
    }),
  )
  .handler(async ({ data }) => {
    const ipCheck = checkRateLimit(`auth:ip:${getClientIp()}`, IP_LIMIT);
    if (!ipCheck.allowed) {
      return throttled(ipCheck.retryAfterSeconds);
    }
    const emailCheck = checkRateLimit(
      `pw-reset:${data.email}`,
      EMAIL_SEND_LIMIT,
    );
    if (!emailCheck.allowed) {
      return throttled(emailCheck.retryAfterSeconds);
    }

    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, data.email))
      .limit(1);

    const user = users[0];
    if (user) {
      const token = await createAuthToken(
        user.id,
        "password_reset",
        PASSWORD_RESET_TTL_MS,
      );
      // Fire-and-forget so response timing doesn't reveal whether the email
      // exists (a synchronous provider call would be measurably slower).
      void sendEmail({
        to: data.email,
        subject: m.email_reset_subject(),
        text: m.email_reset_body({
          link: `${env.email.baseUrl}/reset-password?token=${token}`,
        }),
      }).catch((error) =>
        getLogger().error({ err: error }, "failed to send password reset email"),
      );
    }

    // Identical response whether or not the account exists — no enumeration.
    return { success: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string().min(1).max(256),
      password: z.string().min(1).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const genericError = "This reset link is invalid or has expired.";

    // Peek at the token first (without consuming it) so a password-policy
    // violation doesn't burn the single-use link.
    const peeked = await db
      .select()
      .from(schema.auth_tokens)
      .where(eq(schema.auth_tokens.token_hash, hashToken(data.token)))
      .limit(1);
    const peekedToken = peeked[0];
    if (
      !peekedToken ||
      peekedToken.type !== "password_reset" ||
      peekedToken.used_at ||
      peekedToken.expires_at.getTime() < Date.now()
    ) {
      return { error: genericError };
    }

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, peekedToken.user_id))
      .limit(1);
    const user = users[0];
    if (!user) {
      return { error: genericError };
    }

    const policyError = checkPasswordPolicy(data.password, user.username);
    if (policyError) {
      return { error: policyError };
    }

    // Atomic consume — a concurrent redemption of the same link loses here.
    const userId = await consumeAuthToken(data.token, "password_reset");
    if (!userId) {
      return { error: genericError };
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    // Bumping session_version revokes every outstanding session, including
    // whichever device an attacker may have hijacked.
    await db
      .update(schema.users)
      .set({
        password_hash: passwordHash,
        session_version: user.session_version + 1,
      })
      .where(eq(schema.users.id, userId));

    clearAuthFailures(`login:user:${(user.email ?? user.username).toLowerCase()}`);

    if (user.email) {
      void sendEmail({
        to: user.email,
        subject: m.email_password_changed_subject(),
        text: m.email_password_changed_body(),
      }).catch((error) =>
        getLogger().error({ err: error }, "failed to send password change notice"),
      );
    }

    return { success: true };
  });


export const logoutEverywhere = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await resolveSessionUser();
    if (!user) {
      throw new Response("Unauthorized", { status: 401 });
    }
    // Invalidate every session cookie minted with the old version, then
    // clear this device's cookie too.
    await db
      .update(schema.users)
      .set({ session_version: user.session_version + 1 })
      .where(eq(schema.users.id, user.id));
    const session = await useAppSession();
    await session.clear();
    throw redirect({ to: "/login" });
  },
);
