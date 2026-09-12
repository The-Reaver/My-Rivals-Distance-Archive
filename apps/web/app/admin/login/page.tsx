"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Passwordless (magic-link) admin sign-in. Deliberately the only auth method
// wired up so far -- there is no reader-facing signup flow yet either
// (that's Phase 2's reader loop, not this gate). Being an admin is decided
// entirely by reader_profiles.is_admin, set manually in Supabase today;
// nothing in this UI can set that flag.
export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-md text-center">
      <h1 className="font-display text-section-heading text-text-primary">Admin Sign In</h1>
      <p className="mt-xs font-body text-body-small text-accent-steel">
        Enter an admin account&rsquo;s email for a sign-in link.
      </p>

      {status === "sent" ? (
        <p className="mt-lg font-body text-body text-accent-gold">
          Check {email} for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-lg flex w-full max-w-sm flex-col gap-sm">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="rounded-card border border-border-subtle bg-bg-elevated px-md py-sm font-body text-body text-text-primary outline-none focus-visible:border-accent-gold"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-card bg-accent-gold px-lg py-sm font-body text-body font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {status === "error" && errorMessage && (
            <p className="font-body text-body-small text-accent-ember">{errorMessage}</p>
          )}
        </form>
      )}
    </main>
  );
}
