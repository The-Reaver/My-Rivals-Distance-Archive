import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components / Route Handlers.
 * Uses the publishable (anon) key -- RLS is the real enforcement point
 * (see supabase/migrations/0001_operational_schema.sql), this client never
 * bypasses it. Pairs with the RLS policies as defense-in-depth: a route that
 * forgets to check clearance still can't read a row the database won't return.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component -- middleware refreshes the
            // session instead. Safe to ignore.
          }
        },
      },
    },
  );
}
