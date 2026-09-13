"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitExtractionAction } from "@/app/admin/(dashboard)/knowledge-core/actions";

const TARGET_TYPES = ["chronicle_entry", "world_briefing", "archive_document"] as const;
const BOOK_PLACEMENTS = [
  "pre_book",
  "book_1",
  "book_2",
  "book_3",
  "book_4",
  "book_5",
  "post_series",
] as const;

const REQUIRED_COLUMNS_HINT: Record<(typeof TARGET_TYPES)[number], string> = {
  chronicle_entry: "character_id, entry_number, title, body_markdown",
  world_briefing: "category, title, body_markdown",
  archive_document: "document_type, title, body_markdown",
};

// General-purpose power tool, not a type-specific wizard: extraction can
// target any of three tables with different required columns
// (app/repositories.py's REQUIRED_COLUMNS), so extracted_content is a raw
// JSON textarea rather than three separate bespoke forms. Honest about the
// underlying API surface; a guided per-type form is a reasonable future
// upgrade once real usage shows which shape is worth optimizing for.
export function ExtractionForm({ sourceEntryId }: { sourceEntryId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetType, setTargetType] = useState<(typeof TARGET_TYPES)[number]>("archive_document");
  const [extractedContentJson, setExtractedContentJson] = useState("{\n  \n}");
  const [clearanceLevel, setClearanceLevel] = useState(1);
  const [bookPlacement, setBookPlacement] = useState<(typeof BOOK_PLACEMENTS)[number]>("pre_book");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ operationalTable: string; operationalRowId: string } | null>(
    null,
  );

  function handleSubmit() {
    setError(null);
    setResult(null);

    let extractedContent: Record<string, unknown>;
    try {
      extractedContent = JSON.parse(extractedContentJson);
    } catch {
      setError("extracted_content is not valid JSON.");
      return;
    }

    startTransition(async () => {
      const response = await commitExtractionAction({
        sourceEntryId,
        targetType,
        extractedContent,
        clearanceLevel,
        bookPlacement,
      });
      if (!response.ok) {
        setError(response.error);
      } else {
        setResult({ operationalTable: response.operationalTable, operationalRowId: response.operationalRowId });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap gap-sm">
        <select
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as (typeof TARGET_TYPES)[number])}
          className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
        >
          {TARGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          value={clearanceLevel}
          onChange={(event) => setClearanceLevel(Number(event.target.value))}
          className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
        >
          {[0, 1, 2, 3].map((level) => (
            <option key={level} value={level}>
              Level {level}
            </option>
          ))}
        </select>
        <select
          value={bookPlacement}
          onChange={(event) => setBookPlacement(event.target.value as (typeof BOOK_PLACEMENTS)[number])}
          className="rounded-card border border-border-subtle bg-bg-elevated px-sm py-xs font-body text-body-small text-text-primary"
        >
          {BOOK_PLACEMENTS.map((placement) => (
            <option key={placement} value={placement}>
              {placement}
            </option>
          ))}
        </select>
      </div>

      <p className="font-body text-caption text-accent-steel">
        extracted_content (JSON) — required for {targetType}: {REQUIRED_COLUMNS_HINT[targetType]}
      </p>
      <textarea
        value={extractedContentJson}
        onChange={(event) => setExtractedContentJson(event.target.value)}
        rows={10}
        className="w-full rounded-card border border-border-subtle bg-bg-elevated p-md font-mono text-body-small text-text-primary"
      />

      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        className="self-start rounded-card bg-accent-gold px-md py-xs font-body text-body-small font-semibold text-bg-primary transition-colors duration-hover hover:bg-[#b3953f] disabled:opacity-50"
      >
        {isPending ? "Extracting…" : "Commit extraction"}
      </button>

      {error && <p className="font-body text-body-small text-accent-ember">{error}</p>}
      {result && (
        <p className="font-body text-body-small text-accent-gold">
          Committed to {result.operationalTable} (row {result.operationalRowId}), storage_mode=vault.
        </p>
      )}
    </div>
  );
}
