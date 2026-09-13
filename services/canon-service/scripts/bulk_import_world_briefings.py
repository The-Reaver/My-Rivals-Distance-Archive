#!/usr/bin/env python3
"""Bulk-imports World Briefings, grouped by canon-ledger.json rule prefix, into
this app's Knowledge Core pipeline, then publishes each one live.

Why grouped rather than one row per rule
-----------------------------------------
Unlike the Chronicle Entry corpus (services/canon-service/scripts/bulk_import_knowledge_core.py),
canon-ledger.json's remaining ~1,000 non-Chronicle rules are atomic, telegraphic
facts, not finished prose documents -- importing one world_briefings row per rule
would produce hundreds of one-sentence fragments, not readable "briefings." This
script instead groups every locked, non-superseded rule under a given ID prefix
(e.g. all `ASH-*` rules) into ONE briefing document per manifest entry, each rule
rendered as its own numbered paragraph (source rule id kept visible for
traceability) in ascending rule-number order. No rule's own wording is altered --
this is concatenation, not rewriting -- so it stays "mechanical transcription of
already-approved canon," the same standing this project has used for the
Chronicle import.

Same SQL-generation approach as bulk_import_knowledge_core.py, and for the same
reason: no live Postgres connection is available here, only the Supabase MCP
tool an interactive session can call. Every id is generated client-side (uuid4).

Manifest format: a JSON array of objects, one per World Briefing document:
    {
      "title": "World Atlas & Geography",
      "category": "geography",     // must be one of world_briefings' own CHECK values
      "rule_prefix": "GEO",        // canon-ledger.json rule id prefix to pull, e.g. "GEO-006"
      "batch_id": "Archive world-briefing import, 2026-09-13",
      "book_placement": "pre_book",  // optional, defaults to pre_book
      "clearance_level": 1           // optional, defaults to 1
    }

Usage:
    python bulk_import_world_briefings.py \\
        --manifest manifests/world_briefings.json \\
        --ledger /home/user/Lords-of-Cian-Knowledge-Core/canon-ledger.json \\
        --out /tmp/world-briefings.sql
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extraction import (  # noqa: E402
    TARGET_TABLE,
    CommittedExtraction,
    ExtractionRequest,
    TargetType,
    commit_extraction,
)
from app.ratification import EntryRecord, EntryStatus, ReferenceRecord, transition  # noqa: E402
from app.repositories import OPTIONAL_COLUMNS, REQUIRED_COLUMNS  # noqa: E402

TRANSITION_PATH = [EntryStatus.UNDER_REVIEW, EntryStatus.RATIFIED, EntryStatus.LOCKED]

WORLD_BRIEFING_CATEGORIES = {
    "physics", "politics", "factions", "events", "geography",
    "arsenal", "technology", "locations", "other",
}


# ---------------------------------------------------------------------------
# SQL literal rendering (identical rules to bulk_import_knowledge_core.py)
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
# canon-ledger.json rule collection
# ---------------------------------------------------------------------------


def rule_number(rule_id: str) -> int:
    m = re.search(r"-(\d+)$", rule_id)
    return int(m.group(1)) if m else 0


def collect_rules(ledger: dict, prefix: str) -> list[dict]:
    pattern = re.compile(rf"^{re.escape(prefix)}-\d+$")
    rules = [
        r for r in ledger["rules"]
        if pattern.match(r["id"]) and r.get("status") not in ("superseded", "rejected")
    ]
    rules.sort(key=lambda r: rule_number(r["id"]))
    if not rules:
        raise ValueError(f"No locked rules found for prefix {prefix!r}")
    return rules


def render_briefing_text(title: str, rules: list[dict]) -> str:
    lines = [f"# {title}", ""]
    for r in rules:
        lines.append(f"**{r['id']}.** {r['statement']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# In-memory repositories that double as a SQL emitter (same pattern as the
# Chronicle Entry importer)
# ---------------------------------------------------------------------------


class SqlEmittingKnowledgeCoreRepo:
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
        transition(self, self.entry_id, new_status)
        extra = ", ratified_at = now()" if new_status == EntryStatus.RATIFIED else ""
        self.statements.append(
            f"update knowledge_core.kc_entries set status = {pg_str(new_status.value)}{extra}, "
            f"updated_at = now() where id = {pg_uuid(self.entry_id)};"
        )
        self.status = new_status


class SqlEmittingExtractionRepo:
    def __init__(self, entry_status: EntryStatus):
        self.entry_status = entry_status
        self.statements: list[str] = []

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
        return ext_id


# ---------------------------------------------------------------------------
# Per-item pipeline
# ---------------------------------------------------------------------------


def build_provenance_note(prefix: str, rule_ids: list[str], batch_id: str) -> str:
    return (
        f"Grouped, mechanically concatenated from {len(rule_ids)} already-locked "
        f"Lords-of-Cian-Knowledge-Core canon-ledger.json rules under the '{prefix}-' prefix "
        f"({rule_ids[0]}-{rule_ids[-1]}), via {batch_id}. No rule's own wording was altered; "
        "only headings/ordering were added. Mechanical import via "
        "scripts/bulk_import_world_briefings.py, not a fresh editorial ratification."
    )


def import_item(item: dict, ledger: dict) -> list[str]:
    statements: list[str] = []

    title = item["title"]
    category = item["category"]
    prefix = item["rule_prefix"]
    batch_id = item["batch_id"]
    # kc_documents.document_type has its own fixed CHECK constraint (from the
    # pre-existing Knowledge Core document taxonomy) that does not include a
    # generic "world_briefing" value -- pick the closest-fit existing type per
    # manifest entry instead.
    document_type = item["document_type"]
    book_placement = item.get("book_placement", "pre_book")
    clearance_level = item.get("clearance_level", 1)

    if category not in WORLD_BRIEFING_CATEGORIES:
        raise ValueError(f"{prefix}: unknown category {category!r}, must be one of {WORLD_BRIEFING_CATEGORIES}")

    rules = collect_rules(ledger, prefix)
    rule_ids = [r["id"] for r in rules]
    full_text = render_briefing_text(title, rules)

    # --- kc_documents ---
    document_id = str(uuid.uuid4())
    statements.append(
        "insert into knowledge_core.kc_documents (id, document_type, source_raw_text, intake_status, batch_id) "
        f"values ({pg_uuid(document_id)}, {pg_str(document_type)}, {pg_str(full_text)}, 'parsed', {pg_str(batch_id)});"
    )

    # --- kc_entries (status starts draft) ---
    entry_id = str(uuid.uuid4())
    body = {
        "source_rule_prefix": prefix,
        "source_rule_ids": rule_ids,
        "provenance": build_provenance_note(prefix, rule_ids, batch_id),
    }
    statements.append(
        "insert into knowledge_core.kc_entries "
        "(id, entry_type, parent_document_id, title, body, status, character_ids, book_placement) "
        f"values ({pg_uuid(entry_id)}, 'world_briefing', {pg_uuid(document_id)}, {pg_str(title)}, "
        f"{pg_jsonb(body)}, 'draft', array[]::uuid[], {pg_str(book_placement)});"
    )

    # --- ratify: draft -> under_review -> ratified -> locked ---
    kc_repo = SqlEmittingKnowledgeCoreRepo(entry_id, book_placement)
    for target_status in TRANSITION_PATH:
        kc_repo.advance_to(target_status)
    statements.extend(kc_repo.statements)

    # --- extraction commit (lands in vault) ---
    extracted_content = {
        "category": category,
        "title": title,
        "body_markdown": full_text,
    }

    ext_repo = SqlEmittingExtractionRepo(entry_status=EntryStatus.LOCKED)
    committed: CommittedExtraction = commit_extraction(
        ext_repo,
        ExtractionRequest(
            source_entry_id=entry_id,
            target_type=TargetType.WORLD_BRIEFING,
            extracted_content=extracted_content,
            clearance_level=clearance_level,
            book_placement=book_placement,
        ),
    )
    statements.extend(ext_repo.statements)

    # --- publish: vault -> live ---
    statements.append(
        "update public.world_briefings set storage_mode = 'live', "
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
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--split",
        action="store_true",
        help="Write one file per manifest item (named <out-stem>-<rule_prefix><out-suffix>) instead "
        "of one combined file -- each item's own briefing can be large (hundreds of concatenated "
        "rules), so this keeps individual apply-tool payloads manageable.",
    )
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    ledger = json.loads(args.ledger.read_text(encoding="utf-8"))

    if args.split:
        for item in manifest:
            statements = ["begin;", "", f"-- {item['rule_prefix']}: {item['title']}"]
            statements.extend(import_item(item, ledger))
            statements.append("commit;")
            out_path = args.out.with_name(f"{args.out.stem}-{item['rule_prefix'].lower()}{args.out.suffix}")
            out_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
        print(
            f"Wrote {len(manifest)} World Briefings across separate files "
            f"({args.out.with_name(args.out.stem + '-<prefix>' + args.out.suffix)}). Apply each in turn."
        )
        return

    all_statements: list[str] = ["begin;", ""]
    for item in manifest:
        all_statements.append(f"-- {item['rule_prefix']}: {item['title']}")
        all_statements.extend(import_item(item, ledger))
        all_statements.append("")
    all_statements.append("commit;")

    args.out.write_text("\n".join(all_statements) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest)} World Briefings ({args.out}). Review, then apply against the live DB.")


if __name__ == "__main__":
    main()
