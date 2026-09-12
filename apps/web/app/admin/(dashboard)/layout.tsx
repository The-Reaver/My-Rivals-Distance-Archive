import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The gate: everything under app/admin/(dashboard)/ requires a signed-in
// user whose reader_profiles.is_admin is true. This is a server-side check
// on every request (no client-only "hide the button" gate) -- RLS on the
// operational tables enforces the same is_admin() condition independently,
// so this layout is a UX convenience (redirect to login) rather than the
// real security boundary. app/admin/login sits outside this route group
// deliberately, so the redirect below can't loop.
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: profile } = await supabase
    .from("reader_profiles")
    .select("is_admin, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect("/admin/login?denied=1");
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="flex items-center justify-between border-b border-border-subtle px-md py-sm">
        <nav className="flex gap-md font-body text-body-small">
          <Link href="/admin" className="hover:text-accent-gold">
            Dashboard
          </Link>
          <Link href="/admin/chronicles" className="hover:text-accent-gold">
            Chronicles
          </Link>
        </nav>
        <p className="font-mono text-caption text-accent-steel">{profile.email}</p>
      </header>
      <div className="px-md py-lg">{children}</div>
    </div>
  );
}
