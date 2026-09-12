import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic-link landing target: Supabase redirects here with a `code` query
// param after the reader clicks the emailed link; exchanging it sets the
// session cookie via lib/supabase/server.ts's cookie adapter.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
