import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request. Server Components
 * can't write cookies themselves (lib/supabase/server.ts's setAll silently
 * no-ops there), so without this, a session nearing expiry would never get
 * refreshed and admin routes would start bouncing signed-in users to login.
 * Standard @supabase/ssr middleware pattern for the Next.js App Router.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching auth.getUser() (not getSession()) is what actually validates
  // the token against Supabase and triggers a refresh when it's stale.
  await supabase.auth.getUser();

  return supabaseResponse;
}
