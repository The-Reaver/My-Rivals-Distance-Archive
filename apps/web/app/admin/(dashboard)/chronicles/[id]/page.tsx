import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChronicleEditor } from "@/components/ChronicleEditor";

export default async function EditChroniclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: entry, error }, { data: characters }] = await Promise.all([
    supabase
      .from("chronicle_entries")
      .select(
        "id, character_id, entry_number, title, arc_label, body_markdown, required_clearance, storage_mode, book_placement, is_live",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("characters").select("id, name").order("name"),
  ]);

  if (error) {
    return (
      <p className="font-body text-body text-accent-ember">
        Could not load this entry: {error.message}
      </p>
    );
  }

  if (!entry) {
    notFound();
  }

  return (
    <div>
      <h1 className="font-display text-section-heading text-text-primary">{entry.title}</h1>
      <div className="mt-lg">
        <ChronicleEditor
          mode="edit"
          entryId={entry.id}
          characters={characters ?? []}
          initial={{
            character_id: entry.character_id,
            entry_number: entry.entry_number,
            title: entry.title,
            arc_label: entry.arc_label ?? "",
            body_markdown: entry.body_markdown,
            required_clearance: entry.required_clearance,
            storage_mode: entry.storage_mode as "vault" | "live" | "writer_reference",
            book_placement: entry.book_placement as
              | "pre_book"
              | "book_1"
              | "book_2"
              | "book_3"
              | "book_4"
              | "book_5"
              | "post_series",
            is_live: entry.is_live,
          }}
        />
      </div>
    </div>
  );
}
