import Link from "next/link";
import { notFound } from "next/navigation";
import { canonServiceFetch, canonServiceErrorMessage } from "@/lib/canonService";
import { TransitionForm } from "@/components/TransitionForm";
import { ExtractionForm } from "@/components/ExtractionForm";

type EntryDetail = {
  id: string;
  entry_type: string;
  title: string;
  body: Record<string, unknown>;
  status: string;
  book_placement: string;
  character_ids: string[];
  created_at: string;
  updated_at: string;
  ratified_at: string | null;
  outgoing_references: { to_entry_id: string; relationship_type: string }[];
};

export default async function KnowledgeCoreEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const response = await canonServiceFetch(`/knowledge-core/entries/${id}`);

  if (response.status === 404) {
    notFound();
  }
  if (!response.ok) {
    return (
      <p className="font-body text-body text-accent-ember">
        {await canonServiceErrorMessage(response)}
      </p>
    );
  }

  const entry: EntryDetail = await response.json();
  const canExtract = entry.status === "ratified" || entry.status === "locked";

  return (
    <div>
      <Link href="/admin/knowledge-core" className="font-body text-caption text-accent-steel">
        ← Knowledge Core
      </Link>

      <h1 className="mt-xs font-display text-section-heading text-text-primary">{entry.title}</h1>
      <p className="mt-xs font-mono text-caption text-accent-gold">
        {entry.entry_type} · {entry.status} · {entry.book_placement}
      </p>
      {entry.ratified_at && (
        <p className="mt-xs font-body text-caption text-accent-steel">
          Ratified {new Date(entry.ratified_at).toLocaleString()}
        </p>
      )}

      <pre className="mt-lg overflow-x-auto rounded-card border border-border-subtle bg-bg-elevated p-md font-mono text-body-small text-text-primary">
        {JSON.stringify(entry.body, null, 2)}
      </pre>

      {entry.outgoing_references.length > 0 && (
        <div className="mt-lg">
          <p className="font-body text-caption text-accent-steel">References</p>
          <ul className="mt-xs space-y-xs font-body text-body-small text-text-primary">
            {entry.outgoing_references.map((ref) => (
              <li key={ref.to_entry_id}>
                <Link
                  href={`/admin/knowledge-core/${ref.to_entry_id}`}
                  className="underline underline-offset-2"
                >
                  {ref.to_entry_id}
                </Link>
                <span className="ml-xs text-accent-steel">({ref.relationship_type})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-xl">
        <p className="font-body text-caption text-accent-steel">Transition</p>
        <div className="mt-xs">
          <TransitionForm entryId={entry.id} currentStatus={entry.status} />
        </div>
      </div>

      {canExtract && (
        <div className="mt-xl">
          <p className="font-body text-caption text-accent-steel">
            Extract to reader-facing content
          </p>
          <div className="mt-xs">
            <ExtractionForm sourceEntryId={entry.id} />
          </div>
        </div>
      )}
    </div>
  );
}
