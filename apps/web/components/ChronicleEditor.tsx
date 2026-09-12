"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";

const STORAGE_MODES = ["vault", "live", "writer_reference"] as const;
const BOOK_PLACEMENTS = [
  "pre_book",
  "book_1",
  "book_2",
  "book_3",
  "book_4",
  "book_5",
  "post_series",
] as const;

type CharacterOption = { id: string; name: string };

type ChronicleFields = {
  character_id: string;
  entry_number: number;
  title: string;
  arc_label: string;
  body_markdown: string;
  required_clearance: number;
  storage_mode: (typeof STORAGE_MODES)[number];
  book_placement: (typeof BOOK_PLACEMENTS)[number];
  is_live: boolean;
};

const EMPTY_FIELDS: ChronicleFields = {
  character_id: "",
  entry_number: 1,
  title: "",
  arc_label: "",
  body_markdown: "",
  required_clearance: 1,
  storage_mode: "vault",
  book_placement: "pre_book",
  is_live: false,
};

/**
 * P1-4 (game plan): "a side-by-side editor" for chronicle prose. Writes
 * directly to chronicle_entries through the browser Supabase client using
 * the signed-in admin's own session -- RLS's chronicle_entries_admin_write
 * policy (is_admin()) is what actually authorizes the write; this component
 * has no elevated privilege of its own, same as every other admin write in
 * this app.
 */
export function ChronicleEditor({
  mode,
  characters,
  entryId,
  initial,
}: {
  mode: "create" | "edit";
  characters: CharacterOption[];
  entryId?: string;
  initial?: Partial<ChronicleFields>;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<ChronicleFields>({ ...EMPTY_FIELDS, ...initial });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function set<K extends keyof ChronicleFields>(key: K, value: ChronicleFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMessage(null);

    const supabase = createClient();
    const payload = {
      character_id: fields.character_id,
      entry_number: fields.entry_number,
      title: fields.title,
      arc_label: fields.arc_label || null,
      body_markdown: fields.body_markdown,
      required_clearance: fields.required_clearance,
      storage_mode: fields.storage_mode,
      book_placement: fields.book_placement,
      is_live: fields.is_live,
      word_count: fields.body_markdown.trim().length
        ? fields.body_markdown.trim().split(/\s+/).length
        : 0,
    };

    const result =
      mode === "create"
        ? await supabase.from("chronicle_entries").insert(payload).select("id").single()
        : await supabase.from("chronicle_entries").update(payload).eq("id", entryId!).select("id").single();

    if (result.error) {
      setStatus("error");
      setErrorMessage(result.error.message);
      return;
    }

    setStatus("saved");
    if (mode === "create") {
      router.push(`/admin/chronicles/${result.data.id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-xs">
          <span className="font-body text-caption text-accent-steel">Character</span>
          <select
            value={fields.character_id}
            onChange={(event) => set("character_id", event.target.value)}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          >
            <option value="" disabled>
              Select a character
            </option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-xs">
          <span className="font-body text-caption text-accent-steel">Entry number</span>
          <input
            type="number"
            min={1}
            value={fields.entry_number}
            onChange={(event) => set("entry_number", Number(event.target.value))}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          />
        </label>

        <label className="flex flex-col gap-xs">
          <span className="font-body text-caption text-accent-steel">Required clearance</span>
          <select
            value={fields.required_clearance}
            onChange={(event) => set("required_clearance", Number(event.target.value))}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          >
            {[0, 1, 2, 3].map((level) => (
              <option key={level} value={level}>
                Level {level}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-xs">
          <span className="font-body text-caption text-accent-steel">Storage mode</span>
          <select
            value={fields.storage_mode}
            onChange={(event) => set("storage_mode", event.target.value as ChronicleFields["storage_mode"])}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          >
            {STORAGE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-xs">
          <span className="font-body text-caption text-accent-steel">Book placement</span>
          <select
            value={fields.book_placement}
            onChange={(event) =>
              set("book_placement", event.target.value as ChronicleFields["book_placement"])
            }
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          >
            {BOOK_PLACEMENTS.map((placement) => (
              <option key={placement} value={placement}>
                {placement}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-xs">
          <input
            type="checkbox"
            checked={fields.is_live}
            onChange={(event) => set("is_live", event.target.checked)}
          />
          <span className="font-body text-caption text-accent-steel">Live</span>
        </label>

        <label className="flex flex-col gap-xs sm:col-span-2 lg:col-span-4">
          <span className="font-body text-caption text-accent-steel">Title</span>
          <input
            type="text"
            value={fields.title}
            onChange={(event) => set("title", event.target.value)}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body text-text-primary"
          />
        </label>

        <label className="flex flex-col gap-xs sm:col-span-2 lg:col-span-4">
          <span className="font-body text-caption text-accent-steel">Arc label (optional)</span>
          <input
            type="text"
            value={fields.arc_label}
            onChange={(event) => set("arc_label", event.target.value)}
            className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
          />
        </label>
      </div>

      <div className="mt-lg grid grid-cols-1 gap-md lg:grid-cols-2">
        <div>
          <p className="font-body text-caption text-accent-steel">Body (Markdown)</p>
          <textarea
            value={fields.body_markdown}
            onChange={(event) => set("body_markdown", event.target.value)}
            rows={24}
            className="mt-xs w-full rounded-card border border-border-subtle bg-bg-elevated p-md font-mono text-body-small text-text-primary"
          />
        </div>
        <div>
          <p className="font-body text-caption text-accent-steel">Preview</p>
          <div className="mt-xs h-[calc(24*1.5rem+2rem)] overflow-y-auto rounded-card border border-border-subtle bg-bg-elevated p-md">
            <Markdown>{fields.body_markdown || "*Nothing yet.*"}</Markdown>
          </div>
        </div>
      </div>

      <div className="mt-lg flex items-center gap-md">
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving" || !fields.character_id || !fields.title}
          className="rounded-card bg-accent-gold px-lg py-sm font-body text-body font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </button>
        {status === "saved" && (
          <span className="font-body text-body-small text-accent-gold">Saved.</span>
        )}
        {status === "error" && errorMessage && (
          <span className="font-body text-body-small text-accent-ember">{errorMessage}</span>
        )}
      </div>
    </div>
  );
}
