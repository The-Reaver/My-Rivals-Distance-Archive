import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bookPlacementLabel } from "@/lib/format";
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
      "id, slug, name, aliases, dossier_cover, hook_line, classification_status, cover_image_url, demand_scores(score)",
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
      // Only rendered in the "pending" branch below, but cheap enough to
      // always fetch alongside everything else on this page.
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

  const score = Array.isArray(character.demand_scores)
    ? (character.demand_scores[0]?.score ?? 0)
    : 0;

  return (
    <main className="min-h-screen bg-bg-primary px-md py-2xl">
      <article className="mx-auto max-w-reader">
        <Link href="/characters" className="font-body text-caption text-accent-steel">
          ← Character Index
        </Link>

        <h1 className="mt-xs font-display text-page-title text-text-primary">{character.name}</h1>
        {character.aliases && character.aliases.length > 0 && (
          <p className="mt-xs font-body text-body-small italic text-accent-steel">
            {character.aliases.join(" · ")}
          </p>
        )}
        {character.hook_line && (
          <p className="mt-sm font-body text-body text-text-primary">{character.hook_line}</p>
        )}
        <p className="mt-sm font-mono text-metric text-accent-gold">{score} demand</p>
        <div className="mt-xs">
          <ShareButton entityType="character" entityId={character.id} />
        </div>

        {character.dossier_cover && (
          <div className="mt-lg">
            <Markdown>{character.dossier_cover}</Markdown>
          </div>
        )}

        <section className="mt-xl border-t border-border-subtle pt-lg">
          <h2 className="font-display text-card-title text-text-primary">Chronicles</h2>

          {entries && entries.length > 0 ? (
            <ul className="mt-md space-y-sm">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/characters/${character.slug}/chronicles/${entry.entry_number}`}
                    className="font-body text-body text-accent-gold underline underline-offset-2"
                  >
                    {entry.arc_label ? `${entry.arc_label} — ` : ""}
                    {entry.title}
                  </Link>
                  <span className="ml-sm font-mono text-caption text-accent-steel">
                    {bookPlacementLabel(entry.book_placement)}
                  </span>
                </li>
              ))}
            </ul>
          ) : character.classification_status === "pending" ? (
            <div className="mt-md">
              <p className="font-body text-body-small text-accent-steel">
                No Chronicle has been written for {character.name} yet.
              </p>
              {ledger && ledger.request_count > 0 && (
                <p className="mt-xs font-mono text-caption text-accent-gold">
                  {ledger.request_count} reader{ledger.request_count === 1 ? "" : "s"} have
                  requested this Chronicle.
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
            <p className="mt-md font-body text-body-small text-accent-steel">
              {character.name} has Chronicles beyond your current clearance level.
            </p>
          )}
        </section>
      </article>
    </main>
  );
}
