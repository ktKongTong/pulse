import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { StatsPeriodSchema } from "@pulse/realtime-protocol";

import type { AppEnv } from "../http/hono";
import { roomStub } from "../rpc/room";

const WorkspaceQuerySchema = z.object({
  workspaceId: z.string().optional(),
});

const HistoryQuerySchema = WorkspaceQuerySchema.extend({
  period: StatsPeriodSchema.optional(),
  limit: z.coerce.number().int().positive().optional(),
  anchorDay: z.string().optional(),
});

const ContentHistoryQuerySchema = HistoryQuerySchema.extend({
  canonicalUrl: z.string().url(),
});

const ContentLifetimeQuerySchema = WorkspaceQuerySchema.extend({
  canonicalUrl: z.string().url(),
});

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get("/v1/site/history", zValidator("query", HistoryQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const period = query.period ?? "day";
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getSiteHistory(period, query.limit ?? defaultLimit(period), query.anchorDay ?? today()));
});

statsRoutes.get("/v1/site/lifetime", zValidator("query", WorkspaceQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getSiteLifetime());
});

statsRoutes.get("/v1/content/history", zValidator("query", ContentHistoryQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const period = query.period ?? "day";
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getContentHistory(query.canonicalUrl, period, query.limit ?? defaultLimit(period), query.anchorDay ?? today()));
});

statsRoutes.get("/v1/content/lifetime", zValidator("query", ContentLifetimeQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getContentLifetime(query.canonicalUrl));
});

statsRoutes.get("/v1/owner/history", zValidator("query", HistoryQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const period = query.period ?? "day";
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getOwnerHistory(period, query.limit ?? defaultLimit(period), query.anchorDay ?? today()));
});

statsRoutes.get("/v1/owner/lifetime", zValidator("query", WorkspaceQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = resolveWorkspace(c.env.WORKSPACE_ID, query.workspaceId);
  if (!workspaceId) return c.json({ error: "workspace_mismatch" }, 403);
  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getOwnerLifetime());
});

function resolveWorkspace(expectedWorkspaceId: string, workspaceId?: string) {
  const resolved = workspaceId ?? expectedWorkspaceId;
  return resolved === expectedWorkspaceId ? resolved : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultLimit(period: string) {
  if (period === "day") return 30;
  if (period === "month") return 12;
  return 5;
}
