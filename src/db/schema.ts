// M1 schema (auth/tenancy). Spec v1.1 + Appendix A. Tenant tables carry workspace_id NOT NULL + ENABLE/FORCE RLS
// with USING + WITH CHECK (see db/migrations/0000_m1_auth_tenancy.sql). IDs are UUIDv7 generated app-side.
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, smallint, date, jsonb, pgEnum, primaryKey, uniqueIndex, index, unique, foreignKey } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("workspace_role", ["owner", "admin", "member", "guest"]);

// --- Exempt from RLS (db/rls-exempt-allowlist.txt); only reached via the auth repo by the session owner ---
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(), // argon2id
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  displayName: text("display_name"), avatarUrl: text("avatar_url"), theme: text("theme").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 30-day rolling
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const emailVerifications = pgTable("email_verifications", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 1 h, single use
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// --- Workspace registry: no workspace_id column; resolved only through resolve_workspace() (SECURITY DEFINER) ---
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Tenant tables (RLS) ---
export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("memberships_ws_user_uq").on(t.workspaceId, t.userId), index("memberships_user_idx").on(t.userId)]);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(), // 2-5 uppercase letters, unique per workspace (0001)
  issueSeq: integer("issue_seq").notNull().default(0), // atomic per-team issue counter
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("teams_id_workspace_id_key").on(t.id, t.workspaceId)]);

export const teamMemberships = pgTable("team_memberships", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.teamId, t.userId] }),
  // composite FK: a membership cannot point at a team of another workspace (FK checks bypass RLS)
  foreignKey({ columns: [t.teamId, t.workspaceId], foreignColumns: [teams.id, teams.workspaceId] }).onDelete("cascade"),
]);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Postgres-backed rate limiting (multi-instance safe). Global, no workspace_id; keyed by bucket string.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);


// --- M2 (db/migrations/0001_m2_data_model.sql). Constraints (composite tenant FKs, cycle overlap exclusion, parent-chain
// trigger, checks, append-only grants) live in the SQL migration; this mirrors the columns for typed queries. ---
export const issueStatusEnum = pgEnum("issue_status", ["backlog", "todo", "in_progress", "in_review", "done", "canceled"]);
const ts = (n: string) => timestamp(n, { withTimezone: true });
const wsId = () => uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), name: text("name").notNull(), description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const projectTeams = pgTable("project_teams", {
  workspaceId: wsId(), projectId: uuid("project_id").notNull(), teamId: uuid("team_id").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.teamId] })]);
export const cycles = pgTable("cycles", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), teamId: uuid("team_id").notNull(), name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(), endDate: date("end_date", { mode: "string" }).notNull(),
  version: integer("version").notNull().default(1), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const labels = pgTable("labels", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), name: text("name").notNull(), color: text("color").notNull().default("#888888"),
  version: integer("version").notNull().default(1), createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const issues = pgTable("issues", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), teamId: uuid("team_id").notNull(), number: integer("number").notNull(),
  title: text("title").notNull(), description: text("description").notNull().default(""),
  status: issueStatusEnum("status").notNull().default("backlog"), priority: smallint("priority").notNull().default(0),
  assigneeId: uuid("assignee_id").references(() => users.id), projectId: uuid("project_id"), cycleId: uuid("cycle_id"), parentId: uuid("parent_id"),
  sortKey: text("sort_key").notNull(), version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => users.id), deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const issueLabels = pgTable("issue_labels", {
  workspaceId: wsId(), issueId: uuid("issue_id").notNull(), labelId: uuid("label_id").notNull(),
}, (t) => [primaryKey({ columns: [t.issueId, t.labelId] })]);
export const comments = pgTable("comments", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), issueId: uuid("issue_id").notNull(), authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(), version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(), updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const issueShares = pgTable("issue_shares", {
  workspaceId: wsId(), issueId: uuid("issue_id").notNull(), guestUserId: uuid("guest_user_id").notNull().references(() => users.id),
  sharedBy: uuid("shared_by").notNull().references(() => users.id), createdAt: ts("created_at").notNull().defaultNow(), revokedAt: ts("revoked_at"),
}, (t) => [primaryKey({ columns: [t.issueId, t.guestUserId] })]);
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(), workspaceId: wsId(), actorId: uuid("actor_id").references(() => users.id),
  entity: text("entity").notNull(), entityId: uuid("entity_id"), action: text("action").notNull(),
  diff: jsonb("diff").notNull().default({}), createdAt: ts("created_at").notNull().defaultNow(),
});
