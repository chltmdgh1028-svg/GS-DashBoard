import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/app.js";

const app = createApp();

/**
 * Vercel entrypoint for the whole API.
 *
 * Every `/api/*` request is rewritten to this one function (see vercel.json)
 * instead of relying on filesystem catch-all routing, which only resolved a
 * single path segment in production: `/api/campaigns` reached the function but
 * `/api/dashboard/latest` and `/api/admin/*` were answered by the platform's
 * own 404 before any application code ran.
 *
 * The rewrite carries the requested path in `__vpath`, and this adapter puts
 * it back on `req.url` so the Express router - whose routes are declared as
 * `/api/...` and are shared with the self-hosted server - sees exactly the URL
 * the client asked for. If the platform ever preserves the original URL on its
 * own, `__vpath` is simply absent and this is a no-op.
 *
 * No route, handler, permission check or payload shape changes here.
 */
const PATH_PARAM = "__vpath";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const requested = new URL(req.url ?? "/", "http://localhost");
  const forwarded = requested.searchParams.get(PATH_PARAM);

  if (forwarded !== null) {
    requested.searchParams.delete(PATH_PARAM);
    const trimmed = forwarded.replace(/^\/+/, "");
    const query = requested.searchParams.toString();
    req.url = `/api${trimmed ? `/${trimmed}` : ""}${query ? `?${query}` : ""}`;
  }

  return app(req, res);
}
