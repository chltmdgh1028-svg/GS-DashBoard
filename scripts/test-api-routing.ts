/**
 * Checks the Vercel API entrypoint.
 *
 * Sends requests in both shapes the platform can deliver them in:
 *  - rewritten  : /api?__vpath=dashboard/latest   (what vercel.json produces)
 *  - direct     : /api/dashboard/latest           (self-hosted server)
 * and asserts the Express router sees the same route either way, that auth is
 * still enforced, and that admin endpoints stay closed without an admin session.
 */
import http from "node:http";
import handler from "../api/index.js";

const server = http.createServer((req, res) => handler(req, res));

interface Result {
  status: number;
  body: string;
  setCookie?: string;
}

function request(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("server not listening"));
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        method: options.method ?? "GET",
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            setCookie: (res.headers["set-cookie"] ?? [])[0],
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let failures = 0;

function check(name: string, condition: boolean, detail: string) {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`${mark}  ${name}${condition ? "" : ` -> ${detail}`}`);
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const adminId = process.env.ADMIN_ID || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";

  // 1. unauthenticated session probe, both shapes
  const sessionDirect = await request("/api/session");
  const sessionRewritten = await request("/api?__vpath=session");
  check("GET /api/session (direct)", sessionDirect.status === 200, `${sessionDirect.status}`);
  check("GET /api/session (rewritten)", sessionRewritten.status === 200, `${sessionRewritten.status}`);
  check(
    "both shapes return the same body",
    sessionDirect.body === sessionRewritten.body,
    `${sessionDirect.body} vs ${sessionRewritten.body}`,
  );

  // 2. two-segment path must reach the router, not fall through
  const latestAnon = await request("/api?__vpath=dashboard/latest");
  check("GET /api/dashboard/latest without session -> 401", latestAnon.status === 401, `${latestAnon.status} ${latestAnon.body}`);

  // 3. admin endpoints closed without a session
  const tokenAnon = await request("/api?__vpath=admin/local-sync-token", { method: "POST" });
  const accountsAnon = await request("/api?__vpath=admin/ofc-accounts");
  const revisionsAnon = await request("/api?__vpath=admin/campaigns/x/revisions");
  check("POST /api/admin/local-sync-token anonymous -> 401", tokenAnon.status === 401, `${tokenAnon.status}`);
  check("GET /api/admin/ofc-accounts anonymous -> 401", accountsAnon.status === 401, `${accountsAnon.status}`);
  check("GET /api/admin/campaigns/:id/revisions anonymous -> 401", revisionsAnon.status === 401, `${revisionsAnon.status}`);

  // 4. login, then the same endpoints with a session
  const login = await request("/api?__vpath=login", {
    method: "POST",
    body: { userId: adminId, password: adminPassword },
  });
  check("POST /api/login -> 200", login.status === 200, `${login.status} ${login.body}`);
  const cookie = (login.setCookie ?? "").split(";")[0];
  check("login sets a session cookie", cookie.startsWith("sid="), cookie);

  const latestAuthed = await request("/api?__vpath=dashboard/latest", { cookie });
  check("GET /api/dashboard/latest with session -> 200", latestAuthed.status === 200, `${latestAuthed.status} ${latestAuthed.body.slice(0, 120)}`);

  const campaigns = await request("/api?__vpath=campaigns", { cookie });
  check("GET /api/campaigns with session -> 200", campaigns.status === 200, `${campaigns.status}`);

  const token = await request("/api?__vpath=admin/local-sync-token", { method: "POST", cookie });
  check("POST /api/admin/local-sync-token as admin -> 200", token.status === 200, `${token.status} ${token.body.slice(0, 120)}`);
  check("sync token issued", token.body.includes("\"token\""), token.body.slice(0, 120));

  const accounts = await request("/api?__vpath=admin/ofc-accounts", { cookie });
  check("GET /api/admin/ofc-accounts as admin -> 200", accounts.status === 200, `${accounts.status}`);

  // 5. local agent sync endpoint rejects a missing/invalid token (3 segments deep)
  const syncNoToken = await request("/api?__vpath=admin/campaigns/local-sync", { method: "POST", body: {} });
  check(
    "POST /api/admin/campaigns/local-sync without token -> 401",
    syncNoToken.status === 401,
    `${syncNoToken.status} ${syncNoToken.body}`,
  );

  // 6. query strings survive the rewrite
  const withQuery = await request("/api?__vpath=dashboard/latest&foo=bar", { cookie });
  check("query params preserved alongside __vpath", withQuery.status === 200, `${withQuery.status}`);

  // 7. unknown api paths still 404 from the app, not from the adapter
  const unknown = await request("/api?__vpath=does/not/exist", { cookie });
  check("unknown nested path -> 404", unknown.status === 404, `${unknown.status}`);

  server.close();
  console.log(failures === 0 ? "\nAll routing checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
