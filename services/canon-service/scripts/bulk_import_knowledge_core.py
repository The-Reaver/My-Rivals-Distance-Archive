#!/usr/bin/env python3
"""Bulk-imports already-locked Lords of Cian canon (Chronicle Entry files today; the
same shape extends to World Briefings / Archive Documents later) from the Knowledge
Core repo into this app's own Knowledge Core pipeline, then publishes the result live.

Why this is a SQL *generator*, not a live-DB importer
-------------------------------------------------------
The sessions that run this script have no direct Postgres connectivity to the Supabase
project -- no DATABASE_URL, no DB password, and outbound network here is HTTPS-proxied,
not arbitrary TCP. The only proven path to the live database is the Supabase MCP tool an
interactive Claude Code session can call. So instead of opening a psycopg connection,
this script drives the real app.ratification / app.extraction pure decision logic
(imported unmodified from this same package -- the state machine and extraction rules
are never reimplemented here) against a small in-memory repository, and that repository's
writes double as emitted SQL text. Run the script, review the .sql it writes, then apply
it (e.g. via the Supabase MCP execute_sql tool, or `psql "$DATABASE_URL" -f` if a direct
connection is ever available).

If a real DATABASE_URL is ever wired up in this environment, this script's in-memory
repositories should be swapped for app.repositories.PostgresKnowledgeCoreRepository /
PostgresExtractionRepository against a real transaction -- the pure logic they wrap is
identical either way, so nothing about the import's *rules* would need to change.

Every id (kc_document, kc_entry, the operational row, kc_extraction) is generated
client-side (uuid4) rather than left to the tables' own gen_random_uuid() defaults,
specifically so later statements in the same script can reference a row an earlier
statement "inserted" without a round-trip. That sidesteps the exact bug class that hit
the first, hand-written import of this pipeline: a data-modifying CTE's INSERT isn't
visible to a sibling CTE (or the outer query) in the same statement without an explicit
CTE reference, so a subquery re-reading the table directly comes back empty.

Usage
-----
    python bulk_import_knowledge_core.py \\
        --manifest manifests/bane-wave-2.json \\
        --source-root /home/user/Lords-of-Cian-Knowledge-Core \\
        --out /tmp/bane-wave-2.sql

Manifest format: a JSON array of objects, one per Chronicle Entry to import:
    {
      "rule_id": "MCD-398",               // canon-ledger.json rule id, for provenance
      "title": "What the Fog Remembers",  // must match the file's own leading "# Title" line
      "file": "docs/lords-of-cian/chronicles/what-the-fog-remembers.md",  // relative to --source-root
      "character_slug": "kanja",          // must already be in character_ids.json
      "arc_label": "Bane",
      "entry_number": 4,                  // unique per character; caller's job to sequence correctly
      "book_placement": "pre_book",       // one of ratification.BOOK_PLACEMENT_ORDER
      "batch_id": "Batch 117",            // Knowledge Core batch, for kc_documents.batch_id
      "clearance_level": 1                // 0-3, extraction.py's own valid range
    }

character_ids.json (checked in alongside this script) maps character_slug -> that
character's live public.characters.id. This script only imports Chronicle Entries
against characters that already exist -- creating a character needs hand-written
dossier_cover/hook_line prose, not mechanical extraction, so it stays a separate step.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extraction import (  # noqa: E402
    TARGET_TABLE,
    CommittedExtraction,
    ExtractionRequest,
    TargetType,
    commit_extraction,
)
from app.ratification import (  # noqa: E402
    BOOK_PLACEMENT_ORDER,
    EntryRecord,
    EntryStatus,
    ReferenceRecord,
    transition,
)
from app.repositories import OPTIONAL_COLUMNS, REQUIRED_COLUMNS  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent

# The exact three-step climb every mechanically-imported entry takes. Real fan
# submissions can stall at under_review or get rejected; a Knowledge-Core-repo
# import never does, since the content already carries Abad's own explicit,
# quoted approval -- see the provenance note baked into each kc_entries.body below.
TRANSITION_PATH = [EntryStatus.UNDER_REVIEW, EntryStatus.RATIFIED, EntryStatus.LOCKED]


# ---------------------------------------------------------------------------
# SQL literal rendering
# ---------------------------------------------------------------------------


def pg_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def pg_uuid(value: str) -> str:
    return pg_str(value)


def pg_jsonb(value: dict) -> str:
    return pg_str(json.dumps(value)) + "::jsonb"


def pg_uuid_array(values: list[str]) -> str:
    return "array[" + ", ".join(pg_uuid(v) for v in values) + "]::uuid[]"


def pg_literal(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dict):
        return pg_jsonb(value)
    if isinstance(value, str):
        return pg_str(value)
    if value is None:
        return "null"
    raise TypeError(f"No SQL literal rendering for {value!r} ({type(value)})")


# ---------------------------------------------------------------------------
# Chronicle file parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedChronicle:
    title: str
    full_text: str
    body_markdown: str


def parse_chronicle_file(path: Path) -> ParsedChronicle:
    full_text = path.read_text(encoding="utf-8")
    lines = full_text.splitlines()

    title_line = next((line for line in lines if line.startswith("# ")), None)
    if title_line is None:
        raise ValueError(f"{path}: no leading '# Title' line found")
    title = title_line[2:].strip()

    rule_indices = [i for i, line in enumerate(lines) if line.strip() == "---"]
    if len(rule_indices) < 2:
        raise ValueError(
            f"{path}: expected two '---' separator lines (metadata | narrative | "
            f"continuity notes), found {len(rule_indices)}"
        )
    start, end = rule_indices[0] + 1, rule_indices[1]
    body_lines = lines[start:end]
    # Trim the blank lines the separators leave on both sides, keep everything else
    # (including intentional blank lines between paragraphs) as-is.
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    while body_lines and not body_lines[-1].strip():
        body_lines.pop()
    body_markdown = "\n".join(body_lines)

    return ParsedChronicle(title=title, full_text=full_text, body_markdown=body_markdown)


# ---------------------------------------------------------------------------
# In-memory repositories that double as a SQL emitter
# ---------------------------------------------------------------------------


class SqlEmittingKnowledgeCoreRepo:
    """Backs ratification.transition() for one entry that only this run knows about
    (it isn't in the DB yet). depends_on references are always empty here: every
    Chronicle Entry this script imports is a self-contained scene from an
    already-published, already-approved source -- none of them cite another
    kc_entries row as a load-bearing dependency."""

    def __init__(self, entry_id: str, book_placement: str):
        self.entry_id = entry_id
        self.status = EntryStatus.DRAFT
        self.book_placement = book_placement
        self.statements: list[str] = []

    def get_entry(self, entry_id: str) -> EntryRecord | None:
        if entry_id != self.entry_id:
            return None
        return EntryRecord(id=self.entry_id, status=self.status, book_placement=self.book_placement)

    def get_outgoing_references(self, entry_id: str) -> list[ReferenceRecord]:
        return []

    def advance_to(self, new_status: EntryStatus) -> None:
        transition(self, self.entry_id, new_status)  # raises RatificationError if invalid
        extra = ", ratified_at = now()" if new_status == EntryStatus.RATIFIED else ""
        self.statements.append(
            f"update knowledge_core.kc_entries set status = {pg_str(new_status.value)}{extra}, "
            f"updated_at = now() where id = {pg_uuid(self.entry_id)};"
        )
        self.status = new_status


class SqlEmittingExtractionRepo:
    """Backs extraction.commit_extraction(). Client-generates both the operational
    row's id and the kc_extractions row's id so downstream SQL (the publish step)
    never has to re-query for them."""

    def __init__(self, entry_status: EntryStatus):
        self.entry_status = entry_status
        self.statements: list[str] = []
        self.last_operational_row_id: str | None = None
        self.last_kc_extraction_id: str | None = None

    def get_entry_status(self, entry_id: str) -> EntryStatus | None:
        return self.entry_status

    def insert_operational_row(
        self,
        target_type: TargetType,
        content: dict,
        clearance_level: int,
        book_placement: str,
        storage_mode: str,
    ) -> str:
        table = TARGET_TABLE[target_type]
        required = REQUIRED_COLUMNS[target_type]
        optional = OPTIONAL_COLUMNS[target_type]

        missing = [c for c in required if c not in content]
        if missing:
            raise ValueError(f"extracted_content missing required column(s) for {table}: {missing}")

        present_optional = [c for c in optional if c in content]
        row_id = str(uuid.uuid4())
        columns = ["id", *required, *present_optional, "required_clearance", "storage_mode", "book_placement"]
        values = {
            **content,
            "id": row_id,
            "required_clearance": clearance_level,
            "storage_mode": storage_mode,
            "book_placement": book_placement,
        }
        column_sql = ", ".join(columns)
        value_sql = ", ".join(pg_literal(values[c]) for c in columns)
        self.statements.append(f"insert into public.{table} ({column_sql}) values ({value_sql});")
        self.last_operational_row_id = row_id
        return row_id

    def record_extraction(
        self,
        source_entry_id: str,
        target_type: TargetType,
        extracted_content: dict,
        clearance_level: int,
        book_placement: str,
        operational_table: str,
        operational_row_id: str,
    ) -> str:
        ext_id = str(uuid.uuid4())
        self.statements.append(
            "insert into knowledge_core.kc_extractions "
            "(id, source_entry_id, target_type, extracted_content, clearance_level, "
            " book_placement, status, operational_table, operational_row_id, committed_at) "
            f"values ({pg_uuid(ext_id)}, {pg_uuid(source_entry_id)}, {pg_str(target_type.value)}, "
            f"{pg_jsonb(extracted_content)}, {clearance_level}, {pg_str(book_placement)}, "
            f"'committed', {pg_str(operational_table)}, {pg_uuid(operational_row_id)}, now());"
        )
        self.last_kc_extraction_id = ext_id
        return ext_id


# ---------------------------------------------------------------------------
# Per-item pipeline
# ---------------------------------------------------------------------------


def build_provenance_note(rule_id: str, batch_id: str) -> str:
    return (
        f"Pre-ratified in Lords-of-Cian-Knowledge-Core ({batch_id}, {rule_id}, Abad approval "
        "quoted verbatim in canon-ledger.json). Mechanical status transition via "
        "scripts/bulk_import_knowledge_core.py, not a fresh editorial ratification."
    )


def import_item(item: dict, source_root: Path, character_ids: dict[str, str]) -> list[str]:
    statements: list[str] = []

    rule_id = item["rule_id"]
    manifest_title = item.get("title")  # None => trust the file's own leading "# Title" line as-is
    file_path = source_root / item["file"]
    character_slug = item["character_slug"]
    arc_label = item.get("arc_label")
    entry_number = item["entry_number"]
    book_placement = item.get("book_placement", "pre_book")
    batch_id = item["batch_id"]
    clearance_level = item.get("clearance_level", 1)

    if book_placement not in BOOK_PLACEMENT_ORDER:
        raise ValueError(f"{rule_id}: unknown book_placement {book_placement!r}")
    if character_slug not in character_ids:
        raise ValueError(
            f"{rule_id}: character_slug {character_slug!r} not in character_ids.json -- "
            "create the characters row first, then add its id there."
        )
    character_id = character_ids[character_slug]

    parsed = parse_chronicle_file(file_path)
    if manifest_title is not None and parsed.title != manifest_title:
        raise ValueError(
            f"{rule_id}: manifest title {manifest_title!r} != file's own title {parsed.title!r} "
            f"({file_path})"
        )

    # --- kc_documents ---
    document_id = str(uuid.uuid4())
    statements.append(
        "insert into knowledge_core.kc_documents (id, document_type, source_raw_text, intake_status, batch_id) "
        f"values ({pg_uuid(document_id)}, 'chronicle_entry', {pg_str(parsed.full_text)}, 'parsed', {pg_str(batch_id)});"
    )

    # --- kc_entries (status starts draft) ---
    entry_id = str(uuid.uuid4())
    body = {
        "source_rule_id": rule_id,
        "provenance": build_provenance_note(rule_id, batch_id),
    }
    statements.append(
        "insert into knowledge_core.kc_entries "
        "(id, entry_type, parent_document_id, title, body, status, character_ids, book_placement) "
        f"values ({pg_uuid(entry_id)}, 'chronicle_entry', {pg_uuid(document_id)}, {pg_str(parsed.title)}, "
        f"{pg_jsonb(body)}, 'draft', {pg_uuid_array([character_id])}, {pg_str(book_placement)});"
    )

    # --- ratify: draft -> under_review -> ratified -> locked ---
    kc_repo = SqlEmittingKnowledgeCoreRepo(entry_id, book_placement)
    for target_status in TRANSITION_PATH:
        kc_repo.advance_to(target_status)
    statements.extend(kc_repo.statements)

    # --- extraction commit (lands in vault, per extraction.py's own design) ---
    extracted_content = {
        "character_id": character_id,
        "entry_number": entry_number,
        "title": parsed.title,
        "body_markdown": parsed.body_markdown,
    }
    if arc_label:
        extracted_content["arc_label"] = arc_label

    ext_repo = SqlEmittingExtractionRepo(entry_status=EntryStatus.LOCKED)
    committed: CommittedExtraction = commit_extraction(
        ext_repo,
        ExtractionRequest(
            source_entry_id=entry_id,
            target_type=TargetType.CHRONICLE_ENTRY,
            extracted_content=extracted_content,
            clearance_level=clearance_level,
            book_placement=book_placement,
        ),
    )
    statements.extend(ext_repo.statements)

    # --- publish: vault -> live (the deliberate, separate "go live" action) ---
    statements.append(
        "update public.chronicle_entries set storage_mode = 'live', is_live = true, "
        f"kc_extraction_id = {pg_uuid(committed.kc_extraction_id)} "
        f"where id = {pg_uuid(committed.operational_row_id)};"
    )

    return statements


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--character-ids",
        type=Path,
        default=SCRIPT_DIR / "character_ids.json",
        help="Path to the character_slug -> live characters.id mapping (default: scripts/character_ids.json)",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=0,
        help="Split output into multiple <out-stem>-partNNN<out-suffix> files of this many Chronicle "
        "Entries each (each independently wrapped in its own begin/commit), instead of one big file. "
        "Useful when applying via a tool with a payload-size limit. 0 (default) = single file.",
    )
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    character_ids = {k: v for k, v in json.loads(args.character_ids.read_text(encoding="utf-8")).items() if not k.startswith("_")}

    seen_entry_numbers: dict[str, set[int]] = {}
    for item in manifest:
        key = item["character_slug"]
        seen_entry_numbers.setdefault(key, set())
        if item["entry_number"] in seen_entry_numbers[key]:
            raise ValueError(
                f"Duplicate entry_number {item['entry_number']} for character {key!r} within this manifest"
            )
        seen_entry_numbers[key].add(item["entry_number"])

    def render(items: list[dict]) -> str:
        statements: list[str] = ["begin;", ""]
        for item in items:
            statements.append(f"-- {item['rule_id']}")
            statements.extend(import_item(item, args.source_root, character_ids))
            statements.append("")
        statements.append("commit;")
        return "\n".join(statements) + "\n"

    chunk_size = args.chunk_size or len(manifest)
    chunks = [manifest[i : i + chunk_size] for i in range(0, len(manifest), chunk_size)]

    if len(chunks) == 1:
        args.out.write_text(render(chunks[0]), encoding="utf-8")
        print(f"Wrote {len(manifest)} Chronicle Entries ({args.out}). Review, then apply against the live DB.")
    else:
        width = len(str(len(chunks)))
        for i, chunk in enumerate(chunks, start=1):
            out_path = args.out.with_name(f"{args.out.stem}-part{i:0{width}d}{args.out.suffix}")
            out_path.write_text(render(chunk), encoding="utf-8")
        print(
            f"Wrote {len(manifest)} Chronicle Entries across {len(chunks)} files "
            f"({args.out.with_name(args.out.stem + '-part*' + args.out.suffix)}). "
            "Apply each part in order, verifying no errors before the next."
        )


if __name__ == "__main__":
    main()
