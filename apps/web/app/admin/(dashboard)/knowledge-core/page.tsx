import Link from "next/link";
import { canonServiceFetch, canonServiceErrorMessage } from "@/lib/canonService";

const STATUSES = ["draft", "under_review", "ratified", "locked", "rejected", "superseded"] as const;

type EntrySummary = {
  id: string;
  entry_type: string;
  title: string;
  status: string;
  book_placement: string;
  created_at: string;
};

// The reader-facing app never talks to knowledge_core directly -- it's
// invisible to the anon/authenticated Postgres roles by design
// (0002_knowledge_core_schema.sql). This page goes through canon-service's
// admin-gated GET /knowledge-core/entries instead, same as every other
// Knowledge Core read or write in this app.
export default async function KnowledgeCoreListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  let entries: EntrySummary[] = [];
  let error: string | null = null;

  try {
    const response = await canonServiceFetch(`/knowledge-core/entries${query}`);
    if (!response.ok) {
      error = await canonServiceErrorMessage(response);
    } else {
      entries = await response.json();
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error reaching canon-service.";
  }

  return (
    <div>
      <h1 className="font-display text-section-heading text-text-primary">Knowledge Core</h1>

      <div className="mt-md flex flex-wrap gap-sm font-body text-body-small">
        <Link
          href="/admin/knowledge-core"
          className={!status ? "text-accent-gold" : "text-accent-steel hover:text-text-primary"}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/knowledge-core?status=${s}`}
            className={status === s ? "text-accent-gold" : "text-accent-steel hover:text-text-primary"}
          >
            {s}
          </Link>
        ))}
      </div>

      {error && <p className="mt-lg font-body text-body text-accent-ember">{error}</p>}

      <div className="mt-lg space-y-xs">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            href={`/admin/knowledge-core/${entry.id}`}
            className="flex items-center justify-between rounded-card border border-border-subtle bg-bg-elevated px-md py-sm transition-colors duration-hover hover:border-accent-gold/30"
          >
            <div>
              <p className="font-body text-body text-text-primary">{entry.title}</p>
              <p className="font-body text-caption text-accent-steel">{entry.entry_type}</p>
            </div>
            <div className="flex items-center gap-sm font-mono text-caption text-accent-steel">
              <span>{entry.status}</span>
              <span>{entry.book_placement}</span>
            </div>
          </Link>
        ))}
        {entries.length === 0 && !error && (
          <p className="font-body text-body text-accent-steel">No entries.</p>
        )}
      </div>
    </div>
  );
}
