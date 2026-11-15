import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response, type Router } from "express";
import {
  accountSchema,
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  usernameSchema,
  type ApiError
} from "@imposter/shared";
import type { AccountService, AuthenticatedUser } from "../accounts/accountService.js";
import type { StatsService } from "../stats/statsService.js";

/*
 * JSON API for accounts, profiles and the leaderboard, mounted at /api.
 * Authentication is a bearer token in the Authorization header (no cookies).
 * Every response body is either an allow-listed DTO from @imposter/shared or { error }.
 */

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const route =
  (handler: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

const sendError = (res: Response, status: number, error: string) => {
  const body: ApiError = { error };
  res.status(status).json(body);
};

const bearerToken = (req: Request): string | null => {
  const header = req.get("authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/);
  return match ? match[1] : null;
};

export type ApiOptions = {
  accounts: AccountService;
  stats: StatsService;
  /** Called after a session is revoked so open sockets that used it can be closed. */
  onSessionRevoked?: (sessionHash: string) => Promise<void> | void;
};

/** `?page=` for paged lists: absent means 1; anything but a whole number from 1 to 1000 is refused. */
function parsePage(value: unknown): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const page = Number(value);
  return page >= 1 && page <= 1000 ? page : null;
}

export function createApiRouter({ accounts, stats, onSessionRevoked }: ApiOptions): Router {
  const router = express.Router();

  router.use((_req, res, next) => {
    // Responses can contain session tokens or personal data: never cache them.
    res.set("Cache-Control", "no-store");
    next();
  });

  // Requests that read or change account data wait for the store; refuse clearly while it is down.
  router.use((_req, res, next) => {
    if (!accounts.available()) return sendError(res, 503, "Accounts are temporarily unavailable. Guest play still works.");
    next();
  });

  const requireUser = async (req: Request, res: Response): Promise<AuthenticatedUser | null> => {
    const user = await accounts.authenticate(bearerToken(req));
    if (!user) sendError(res, 401, "Please sign in again.");
    return user;
  };

  router.post(
    "/auth/register",
    route(async (req, res) => {
      const parsed = registerRequestSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message ?? "Check the form and try again.");
      const result = await accounts.register(parsed.data);
      if (!result.ok) return sendError(res, result.status, result.error);
      res.status(201).json(result.value);
    })
  );

  router.post(
    "/auth/login",
    route(async (req, res) => {
      const parsed = loginRequestSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "Enter your username and password.");
      const result = await accounts.login(parsed.data);
      if (!result.ok) return sendError(res, result.status, result.error);
      res.json(result.value);
    })
  );

  router.post(
    "/auth/logout",
    route(async (req, res) => {
      const token = bearerToken(req);
      const revoked = token ? await accounts.logout(token) : null;
      if (revoked && onSessionRevoked) await onSessionRevoked(revoked);
      res.status(204).end();
    })
  );

  router.get(
    "/auth/me",
    route(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const account = await accounts.account(user.userId);
      if (!account) return sendError(res, 401, "Please sign in again.");
      res.json(accountSchema.parse(account));
    })
  );

  router.patch(
    "/me",
    route(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const parsed = updateProfileRequestSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "Choose one of the available avatars.");
      const account = await accounts.updateAvatar(user.userId, parsed.data.avatar);
      if (!account) return sendError(res, 401, "Please sign in again.");
      res.json(accountSchema.parse(account));
    })
  );

  // Only the signed-in player's own matches: the account comes from the token, never from the request.
  router.get(
    "/me/matches",
    route(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      const page = parsePage(req.query.page);
      if (page === null) return sendError(res, 400, "Invalid page number.");
      res.json(await stats.history(user.userId, page));
    })
  );

  router.get(
    "/players/:username",
    route(async (req, res) => {
      const username = usernameSchema.safeParse(req.params.username);
      const profile = username.success ? await stats.profile(username.data) : null;
      if (!profile) return sendError(res, 404, "No player with that username.");
      res.json(profile);
    })
  );

  router.get(
    "/leaderboard",
    route(async (_req, res) => {
      res.json(await stats.leaderboard());
    })
  );

  router.use((_req, res) => sendError(res, 404, "Not found."));
  return router;
}

/** Last-resort error handler: JSON only, never a stack trace or internal message. */
export const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const type = (error as { type?: unknown } | null)?.type;
  if (type === "entity.parse.failed") return sendError(res, 400, "The request body must be valid JSON.");
  if (type === "entity.too.large") return sendError(res, 413, "The request is too large.");
  console.error("[http] Request failed:", error);
  sendError(res, 500, "Something went wrong. Please try again.");
};
