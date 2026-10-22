/**
 * Runtime configuration.
 *
 * The console holds no inspection data. It is a second UI over the inspection
 * app's own admin-grid API, which is the only thing allowed to write the
 * canonical rows. Either it is pointed at that API or it serves nothing - a
 * master console that silently shows something else is worse than one that is
 * down, because the numbers would still look plausible.
 */

export interface InspectionApiConfig {
  /** Origin of the inspection app, e.g. https://inspection-app-main.vercel.app */
  base: string;
  /**
   * Session token issued by the inspection app. Permissions are decided there
   * from this token, so the console never holds Supabase credentials and
   * cannot exceed what the token is allowed to do.
   */
  sessionToken: string;
}

function trimmed(name: string) {
  return (process.env[name] || "").trim();
}

export function inspectionApiConfig(): InspectionApiConfig | undefined {
  const base = trimmed("INSPECTION_APP_BASE");
  const sessionToken = trimmed("INSPECTION_SESSION_TOKEN");
  if (!base || !sessionToken) return undefined;
  return { base: base.replace(/\/+$/, ""), sessionToken };
}

export function missingInspectionVars() {
  return (["INSPECTION_APP_BASE", "INSPECTION_SESSION_TOKEN"] as const).filter((name) => !trimmed(name));
}

/**
 * Corrections are off unless explicitly enabled. A correction rewrites a
 * canonical inspection row, so the ability to make one is a deployment
 * decision rather than something that follows from merely holding a token.
 */
export function correctionsEnabled() {
  return trimmed("CORRECTIONS_ENABLED") === "true";
}

/**
 * The inspection app's origin, safe to hand to the browser: photos are served
 * from it by signed id (`/api/photo?id=...`), which is a capability in itself
 * and needs no header, so the image can load directly instead of being
 * proxied through this function.
 */
export function inspectionBase() {
  return inspectionApiConfig()?.base;
}

/**
 * Link target for the inspection app's own admin grid (기준정보). The console
 * links out to it instead of rebuilding it.
 */
export function adminGridUrl() {
  const config = inspectionApiConfig();
  return config ? `${config.base}/?view=admin-grid` : undefined;
}
