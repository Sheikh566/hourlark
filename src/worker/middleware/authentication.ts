import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createMiddleware } from "hono/factory";

import { normalizeEmail } from "@/domain/normalization";
import {
  WORKSPACE_ID,
  type AppContext,
  type MemberRow,
  type WorkspaceRow,
  toAuthenticatedMember,
} from "@/domain/types";
import { parseRuntimeConfig, type RuntimeConfig } from "@/worker/env";
import { ApiError } from "@/worker/errors";

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function issuerFor(teamDomain: string): string {
  const value = teamDomain.trim().replace(/\/+$/, "");
  return value.startsWith("https://") ? value : `https://${value}`;
}

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  jwksByIssuer.set(issuer, created);
  return created;
}

async function verifyAccessIdentity(
  request: Request,
  config: RuntimeConfig,
): Promise<{ subject: string; email: string }> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new ApiError(
      401,
      "access_token_missing",
      "Cloudflare Access authentication is required.",
    );
  }

  const issuer = issuerFor(config.ACCESS_TEAM_DOMAIN);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience: config.ACCESS_AUD,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new ApiError(401, "access_token_invalid", "Cloudflare Access authentication is invalid.");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new ApiError(401, "access_subject_missing", "The Access identity has no subject.");
  }
  if (typeof payload.email !== "string" || !payload.email) {
    throw new ApiError(401, "access_email_missing", "The Access identity has no email.");
  }
  return { subject: payload.sub, email: normalizeEmail(payload.email) };
}

function displayNameFromEmail(email: string): string {
  return (
    email
      .split("@")[0]
      ?.split(/[._-]/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" ") || email
  );
}

async function bootstrapAdmin(
  db: D1Database,
  config: RuntimeConfig,
  identity: { subject: string; email: string },
): Promise<void> {
  const workspace = await db
    .prepare("SELECT bootstrap_completed_at FROM workspaces WHERE id = ?")
    .bind(WORKSPACE_ID)
    .first<Pick<WorkspaceRow, "bootstrap_completed_at">>();
  if (!workspace || workspace.bootstrap_completed_at !== null) return;

  const activeAdmins =
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM members WHERE workspace_id = ? AND role = 'admin' AND status = 'active'",
        )
        .bind(WORKSPACE_ID)
        .first<{ count: number }>()
    )?.count ?? 0;
  const now = Date.now();
  if (activeAdmins > 0) {
    await db
      .prepare(
        "UPDATE workspaces SET bootstrap_completed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND bootstrap_completed_at IS NULL",
      )
      .bind(now, now, WORKSPACE_ID)
      .run();
    return;
  }

  const emails = [
    ...new Set(config.BOOTSTRAP_ADMIN_EMAILS.split(",").map(normalizeEmail).filter(Boolean)),
  ];
  if (!emails.includes(identity.email)) return;

  const existing = await findMemberByEmail(db, identity.email);
  if (existing?.access_subject && existing.access_subject !== identity.subject) {
    throw new ApiError(
      409,
      "access_subject_mismatch",
      "This bootstrap administrator is already bound to another Access identity.",
    );
  }
  const provision = existing
    ? db
        .prepare(
          `UPDATE members
           SET role = 'admin', status = 'active', access_subject = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND (access_subject IS NULL OR access_subject = ?)`,
        )
        .bind(identity.subject, now, existing.id, identity.subject)
    : db
        .prepare(
          `INSERT OR IGNORE INTO members (
          id, workspace_id, email, email_normalized, display_name, role, status, access_subject,
          timezone, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          WORKSPACE_ID,
          identity.email,
          identity.email,
          displayNameFromEmail(identity.email),
          identity.subject,
          config.DEFAULT_TIMEZONE,
          now,
          now,
        );
  await db.batch([
    provision,
    db
      .prepare(
        "UPDATE workspaces SET bootstrap_completed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND bootstrap_completed_at IS NULL",
      )
      .bind(now, now, WORKSPACE_ID),
  ]);
}

async function findMemberByEmail(db: D1Database, email: string): Promise<MemberRow | null> {
  return db
    .prepare("SELECT * FROM members WHERE workspace_id = ? AND email_normalized = ?")
    .bind(WORKSPACE_ID, email)
    .first<MemberRow>();
}

async function resolveAccessMember(
  db: D1Database,
  identity: { subject: string; email: string },
): Promise<MemberRow> {
  const subjectMember = await db
    .prepare("SELECT * FROM members WHERE workspace_id = ? AND access_subject = ?")
    .bind(WORKSPACE_ID, identity.subject)
    .first<MemberRow>();
  if (subjectMember) {
    if (subjectMember.email_normalized !== identity.email) {
      throw new ApiError(
        409,
        "access_email_mismatch",
        "The verified Access email does not match the bound member.",
      );
    }
    return subjectMember;
  }

  const emailMember = await findMemberByEmail(db, identity.email);
  if (!emailMember) {
    throw new ApiError(403, "member_not_provisioned", "This email has not been provisioned.");
  }
  if (emailMember.access_subject && emailMember.access_subject !== identity.subject) {
    throw new ApiError(
      409,
      "access_subject_mismatch",
      "This member is already bound to another Access identity.",
    );
  }

  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE members
       SET access_subject = ?, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = ?, version = version + 1
       WHERE id = ? AND access_subject IS NULL`,
    )
    .bind(identity.subject, now, emailMember.id)
    .run();
  if (result.meta.changes === 0) {
    const reloaded = await findMemberByEmail(db, identity.email);
    if (!reloaded || reloaded.access_subject !== identity.subject) {
      throw new ApiError(
        409,
        "access_binding_conflict",
        "The identity binding changed. Try again.",
      );
    }
    return reloaded;
  }
  const bound = await findMemberByEmail(db, identity.email);
  if (!bound)
    throw new ApiError(500, "member_binding_failed", "The member binding could not be loaded.");
  return bound;
}

export const authenticationMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const config = parseRuntimeConfig(c.env);
  let row: MemberRow | null;

  if (config.AUTH_MODE === "dev") {
    const email = normalizeEmail(
      c.req.header("X-Dev-User-Email") || config.DEV_DEFAULT_USER_EMAIL || "",
    );
    if (!email) {
      throw new ApiError(401, "development_identity_missing", "Select a development user.");
    }
    row = await findMemberByEmail(c.env.DB, email);
    if (!row) {
      throw new ApiError(
        403,
        "development_user_not_seeded",
        "Run the local development seed before signing in.",
      );
    }
  } else {
    const identity = await verifyAccessIdentity(c.req.raw, config);
    await bootstrapAdmin(c.env.DB, config, identity);
    row = await resolveAccessMember(c.env.DB, identity);
  }

  if (row.status !== "active") {
    throw new ApiError(403, "member_inactive", "This member account is not active.");
  }

  const now = Date.now();
  if (row.last_seen_at === null || row.last_seen_at < now - 15 * 60_000) {
    await c.env.DB.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?")
      .bind(now, row.id)
      .run();
    row.last_seen_at = now;
  }
  c.set("member", toAuthenticatedMember(row));
  await next();
});
