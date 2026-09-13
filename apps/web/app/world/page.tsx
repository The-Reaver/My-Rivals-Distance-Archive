import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { titleCase } from "@/lib/format";

// P1-2's other half: "Character profiles, /world, plus new /archive index
// and /archive/:id reader." Only archive_documents got a reader route in
// earlier passes -- world_briefings has had RLS and a schema since 0001
// with nowhere for a reader to ever see one, confirmed by grep (no /world
// route, no admin editor) before building this. Found while scoping
// Connective Tissue Trails (Idea 8), which is specifically about cross-link
// clicks "in the Level 2 world briefings" -- a feature that needs this
// page to exist first.
//
// Same RLS-gated, grouped-listing pattern as /archive: world_briefings_select
// already restricts what comes back to storage_mode = 'live' rows at or
// below the visitor's clearance, so no filtering happens here.
export default async function WorldPage() {
  const supabase = await createClient();

  const { data: briefings, error } = await supabase
    .from("world_briefings")
    .select("id, category, title")
    .order("category")
    .order("title");

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load world briefings: {error.message}
        </p>
      </main>
    );
  }

  const grouped = new Map<string, typeof briefings>();
  for (const briefing of briefings ?? []) {
    const bucket = grouped.get(briefing.category) ?? [];
    bucket.push(briefing);
    grouped.set(briefing.category, bucket);
  }

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-grid">
        <h1 className="font-display text-section-heading text-text-primary">World</h1>
        <p className="mt-xs font-body text-body-small text-accent-steel">
          Briefings on the physics, politics, and geography of The Lords of Cian.
        </p>

        {grouped.size === 0 && (
          <p className="mt-lg font-body text-body text-accent-steel">
            Nothing is visible yet at your clearance level.
          </p>
        )}

        {[...grouped.entries()].map(([category, entries]) => (
          <section key={category} className="mt-xl">
            <h2 className="font-display text-card-title text-text-primary">
              {titleCase(category)}
            </h2>
            <div className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
              {entries!.map((briefing) => (
                <Link
                  key={briefing.id}
                  href={`/world/${briefing.id}`}
                  className="rounded-card border border-border-subtle bg-bg-elevated p-md transition-colors duration-hover hover:border-accent-gold/30"
                >
                  <h3 className="font-display text-card-title text-text-primary">
                    {briefing.title}
                  </h3>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
