import { createClient } from "@/lib/supabase/server";

/**
 * Calls canon-service. Server-only -- CANON_SERVICE_URL is a Railway
 * private-network address, unreachable from the browser by design (see
 * apps/web/.env.example's own comment). Every call forwards the current
 * user's own Supabase access token as a bearer credential; canon-service
 * verifies it against Supabase's JWKS (app/auth.py) and re-checks
 * reader_profiles.is_admin itself for anything under /knowledge-core
 * (app/admin.py) -- this helper carries no privilege of its own, it's
 * just plumbing.
 *
 * Only ever call this from a Server Component, a Route Handler, or a
 * Server Action ("use server") -- never from a Client Component, which
 * would try to reach a host it cannot resolve.
 */
export async function canonServiceFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not signed in.");
  }

  const canonServiceUrl = process.env.CANON_SERVICE_URL;
  if (!canonServiceUrl) {
    throw new Error("CANON_SERVICE_URL is not configured.");
  }

  return fetch(`${canonServiceUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
    cache: "no-store",
  });
}

/** Parses canon-service's {"detail": ...} error shape into a plain string,
 * whether detail is a string (FastAPI's own 401/403/404s) or the
 * {"code", "message"} object routes_knowledge_core.py raises on a
 * RatificationError/ExtractionError. */
export async function canonServiceErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") {
      return body.detail;
    }
    if (body.detail?.message) {
      return String(body.detail.message);
    }
    return `canon-service returned ${response.status}`;
  } catch {
    return `canon-service returned ${response.status}`;
  }
}
