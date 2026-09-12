import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { titleCase } from "@/lib/format";

// P1-4's list side: an admin sees every chronicle_entries row regardless of
// storage_mode/is_live (RLS's is_admin() branch), which is the point --
// vault and writer_reference rows need to be manageable here too, not just
// live ones.
export default async function ChroniclesListPage() {
  const supabase = await createClient();

  const { data: entries, error } = await supabase
    .from("chronicle_entries")
    .select(
      "id, entry_number, title, arc_label, required_clearance, storage_mode, is_live, characters(name)",
    )
    .order("character_id")
    .order("entry_number");

  if (error) {
    return (
      <p className="font-body text-body text-accent-ember">
        Could not load chronicle entries: {error.message}
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-section-heading text-text-primary">
          Chronicle Entries
        </h1>
        <Link
          href="/admin/chronicles/new"
          className="rounded-card bg-accent-gold px-md py-xs font-body text-body-small font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f]"
        >
          + New
        </Link>
      </div>

      {(!entries || entries.length === 0) && (
        <p className="mt-lg font-body text-body text-accent-steel">No chronicle entries yet.</p>
      )}

      <div className="mt-lg space-y-xs">
        {entries?.map((entry) => {
          const character = Array.isArray(entry.characters)
            ? entry.characters[0]
            : entry.characters;
          return (
            <Link
              key={entry.id}
              href={`/admin/chronicles/${entry.id}`}
              className="flex items-center justify-between rounded-card border border-border-subtle bg-bg-elevated px-md py-sm transition-colors duration-hover hover:border-accent-gold/30"
            >
              <div>
                <p className="font-body text-body text-text-primary">
                  {character?.name ?? "—"} #{entry.entry_number} — {entry.title}
                </p>
                {entry.arc_label && (
                  <p className="font-body text-caption text-accent-steel">{entry.arc_label}</p>
                )}
              </div>
              <div className="flex items-center gap-sm font-mono text-caption text-accent-steel">
                <span>Clearance {entry.required_clearance}</span>
                <span>{titleCase(entry.storage_mode)}</span>
                <span className={entry.is_live ? "text-accent-gold" : ""}>
                  {entry.is_live ? "Live" : "Not live"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
