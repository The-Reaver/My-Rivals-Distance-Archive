import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bookPlacementLabel, titleCase } from "@/lib/format";
import { Markdown } from "@/components/Markdown";
import { RequestChronicleButton } from "@/components/RequestChronicleButton";
import { ShareButton } from "@/components/ShareButton";

// Character dossier page -- Level 0 discovery layer (characters_select_all
// RLS policy is unrestricted), linked from the Character Index. Chronicle
// entries listed here are already clearance-filtered by
// chronicle_entries_select's RLS policy, so a reader below a chapter's
// required_clearance simply never sees that row in the query result; no
// clearance check happens in this component.
//
// classification_status distinguishes two different "no entries" states
// (per its own column comment in 0001_operational_schema.sql): 'pending'
// means nothing has been written yet -- offer the request flow. 'active'
// with zero visible rows means entries exist but sit above this reader's
// clearance -- a request would be meaningless, so it's not offered.
//
// Layout follows Visual Direction v1.0: a hero with the classification
// stamp, a four-metric stat bar (§4), and an asymmetric 60/40 Lore Panel
// for the dossier body plus a status sidebar, all inside the card system
// (§8/§11 tokens) rather than a bare text column. Metrics shown are only
// ones already exposed as public aggregates (demand_scores,
// chronicle_request_ledger) or already clearance-filtered by RLS
// (entries.length) -- no new aggregate views added in this pass.
export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: character, error } = await supabase
    .from("characters")
    .select(
      "id, slug, name, aliases, dossier_cover, hook_line, classification_status, cover_image_url, demand_scores(score, trend_7d)",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return (
      <main className="min-h-screen bg-bg-primary px-md py-2xl text-text-primary">
        <p className="font-body text-body text-accent-ember">
          Could not load this character: {error.message}
        </p>
      </main>
    );
  }

  if (!character) {
    notFound();
  }

  const [{ data: entries }, { data: userData }, { data: ledger }, { data: requestReasons }] =
    await Promise.all([
      supabase
        .from("chronicle_entries")
        .select("id, entry_number, arc_label, title, book_placement")
        .eq("character_id", character.id)
        .order("entry_number"),
      supabase.auth.getUser(),
      // Standing Requests Ledger (Idea 1): public aggregate, no reader
      // identity -- chronicle_request_ledger/_reasons are views that bypass
      // chronicle_requests' own-row RLS by design (see 0008's own comment).
      // Fetched unconditionally now: the stat bar shows request count for
      // every character, not just pending ones.
      supabase
        .from("chronicle_request_ledger")
        .select("request_count")
        .eq("character_id", character.id)
        .maybeSingle(),
      supabase
        .from("chronicle_request_reasons")
        .select("reason, created_at")
        .eq("character_id", character.id)
        .limit(20),
    ]);

  const user = userData.user;
  let alreadyRequested = false;
  if (user) {
    const { data: existingRequest } = await supabase
      .from("chronicle_requests")
      .select("id")
      .eq("character_id", character.id)
      .eq("reader_id", user.id)
      .maybeSingle();
    alreadyRequested = !!existingRequest;
  }

  const demandRow = Array.isArray(character.demand_scores)
    ? character.demand_scores[0]
    : character.demand_scores;
  const score = demandRow?.score ?? 0;
  const trend7d = demandRow?.trend_7d ?? 0;
  const requestCount = ledger?.request_count ?? 0;
  const chronicleCount = entries?.length ?? 0;
  const isPending = character.classification_status === "pending";
  const initial = character.name.trim().charAt(0).toUpperCase();

  const stats: { label: string; value: string }[] = [
    { label: "Demand", value: String(score) },
    { label: "7-Day Trend", value: `${trend7d > 0 ? "+" : ""}${trend7d}` },
    { label: "Chronicles", value: String(chronicleCount) },
    { label: "Requests", value: String(requestCount) },
  ];

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <div className="mx-auto max-w-grid">
        <Link href="/characters" className="font-body text-caption text-accent-steel">
          ← Character Index
        </Link>

        {/* Hero: classification stamp + portrait/monogram + core identity */}
        <div className="mt-md flex flex-col gap-lg rounded-card border border-border-subtle bg-bg-elevated p-lg md:flex-row md:items-start md:p-xl">
          <div className="mx-auto w-40 shrink-0 md:mx-0">
            <div className="relative aspect-square w-full overflow-hidden rounded-card border-2 border-accent-gold/40 bg-bg-primary">
              {character.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={character.cover_image_url}
                  alt={character.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(201,168,76,0.16),_transparent_70%)]">
                  <span className="font-display text-5xl text-accent-gold/70">{initial}</span>
                </div>
              )}
            </div>
            <p className="mt-xs text-center font-mono text-caption uppercase tracking-widest text-accent-steel">
              {isPending ? "Dossier Pending" : "Dossier Active"}
            </p>
          </div>

          <div className="min-w-0 flex-1">
            <span
              className={`inline-block rounded-card border px-sm py-[2px] font-mono text-caption uppercase tracking-widest ${
                isPending
                  ? "border-accent-steel/50 text-accent-steel"
                  : "border-accent-gold/50 text-accent-gold"
              }`}
            >
              {titleCase(character.classification_status)}
            </span>

            <h1 className="mt-sm font-display text-page-title text-text-primary">
              {character.name}
            </h1>
            {character.aliases && character.aliases.length > 0 && (
              <p className="mt-xs font-body text-body-small italic text-accent-steel">
                {character.aliases.join(" · ")}
              </p>
            )}
            {character.hook_line && (
              <p className="mt-md border-l-2 border-accent-gold/50 pl-md font-body text-body italic text-accent-parchment">
                {character.hook_line}
              </p>
            )}
            <div className="mt-md">
              <ShareButton entityType="character" entityId={character.id} />
            </div>
          </div>
        </div>

        {/* Stat bar -- Visual Direction §4 */}
        <div className="mt-lg grid grid-cols-2 gap-sm sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-card border border-border-subtle bg-bg-elevated px-md py-sm text-center"
            >
              <p className="font-mono text-metric text-accent-gold">{stat.value}</p>
              <p className="mt-[2px] font-mono text-caption uppercase tracking-wider text-accent-steel">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {/* Lore Panel -- asymmetric 60/40 split, Visual Direction §4 */}
        <div className="mt-xl grid gap-lg md:grid-cols-5">
          <div className="md:col-span-3">
            {character.dossier_cover ? (
              <div className="rounded-card border border-border-subtle bg-bg-elevated p-lg">
                <h2 className="font-display text-card-title text-text-primary">Dossier</h2>
                <Markdown>{character.dossier_cover}</Markdown>
              </div>
            ) : (
              <div className="rounded-card border border-border-subtle bg-bg-elevated p-lg">
                <p className="font-body text-body-small text-accent-steel">
                  No dossier summary has been written for {character.name} yet.
                </p>
              </div>
            )}
          </div>

          <aside className="md:col-span-2">
            <div className="rounded-card border border-border-subtle bg-bg-elevated p-lg">
              <h2 className="font-display text-card-title text-text-primary">Status</h2>
              <dl className="mt-sm space-y-xs font-body text-body-small">
                <div className="flex justify-between gap-sm">
                  <dt className="text-accent-steel">Classification</dt>
                  <dd className="text-text-primary">{titleCase(character.classification_status)}</dd>
                </div>
                <div className="flex justify-between gap-sm">
                  <dt className="text-accent-steel">Chronicles live</dt>
                  <dd className="font-mono text-text-primary">{chronicleCount}</dd>
                </div>
                <div className="flex justify-between gap-sm">
                  <dt className="text-accent-steel">Reader requests</dt>
                  <dd className="font-mono text-text-primary">{requestCount}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>

        {/* Chronicles */}
        <section className="mt-xl">
          <h2 className="font-display text-section-heading text-text-primary">Chronicles</h2>

          {entries && entries.length > 0 ? (
            <ul className="mt-md space-y-sm">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/characters/${character.slug}/chronicles/${entry.entry_number}`}
                    className="flex flex-col gap-xs rounded-card border border-border-subtle bg-bg-elevated p-md transition-colors duration-hover hover:bg-bg-hover sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span>
                      {entry.arc_label && (
                        <span className="mr-sm font-mono text-caption uppercase tracking-wider text-accent-steel">
                          {entry.arc_label}
                        </span>
                      )}
                      <span className="font-display text-card-title text-text-primary">
                        {entry.title}
                      </span>
                    </span>
                    <span className="font-mono text-caption text-accent-steel">
                      {bookPlacementLabel(entry.book_placement)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : isPending ? (
            <div className="mt-md rounded-card border border-border-subtle bg-bg-elevated p-lg">
              <p className="font-body text-body-small text-accent-steel">
                No Chronicle has been written for {character.name} yet.
              </p>
              {requestCount > 0 && (
                <p className="mt-xs font-mono text-caption text-accent-gold">
                  {requestCount} reader{requestCount === 1 ? "" : "s"} have requested this
                  Chronicle.
                </p>
              )}
              <RequestChronicleButton
                characterId={character.id}
                isSignedIn={!!user}
                alreadyRequested={alreadyRequested}
              />
              {requestReasons && requestReasons.length > 0 && (
                <ul className="mt-md space-y-xs border-t border-border-subtle pt-sm">
                  {requestReasons.map((entry, index) => (
                    <li
                      key={`${entry.created_at}-${index}`}
                      className="font-body text-body-small italic text-text-primary"
                    >
                      &ldquo;{entry.reason}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-md rounded-card border border-border-subtle bg-bg-elevated p-lg">
              <p className="font-body text-body-small text-accent-steel">
                {character.name} has Chronicles beyond your current clearance level.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
