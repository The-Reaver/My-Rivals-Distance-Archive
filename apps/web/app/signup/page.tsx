import { Suspense } from "react";
import { SignupForm } from "@/components/SignupForm";

// Server component wrapper so SignupForm's useSearchParams() (it reads
// ?follow= and ?ref=) doesn't de-opt this whole route from static
// generation -- same Suspense-boundary requirement Next.js applies to any
// client component reading search params.
export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-md text-center">
      <h1 className="font-display text-section-heading text-text-primary">
        Follow the Chronicles
      </h1>
      <p className="mt-xs font-body text-body-small text-accent-steel">
        Sign up with your email for a sign-in link. No password.
      </p>
      <Suspense>
        <SignupForm />
      </Suspense>
    </main>
  );
}
