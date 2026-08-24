import Link from "next/link";

// Visual Direction 6. Home / Landing -- "a door, not a brochure."
// Full-viewport hero, gradient #0A0A0F -> #12121A, single CTA. No carousel,
// no feature grid, no testimonials. This is the Level 0 discovery layer
// (System Explanation 2 / Strategy 5) -- server-rendered so it's crawlable.
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-bg-primary to-bg-elevated px-md text-center">
      <h1 className="font-display text-page-title text-text-primary sm:text-5xl">
        The Lords of Cian
      </h1>
      <p className="mt-sm font-body text-body text-accent-steel">
        Explore the world of My Rival&rsquo;s Distance before the first book is written.
      </p>
      <Link
        href="/characters"
        className="mt-xl rounded-card bg-accent-gold px-lg py-sm font-body text-body font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f]"
      >
        Enter the Archive
      </Link>
    </main>
  );
}
