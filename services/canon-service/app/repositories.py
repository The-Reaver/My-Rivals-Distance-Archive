"""Real Postgres-backed implementations of the repository Protocols defined
in app.ratification and app.extraction. Both of those modules' actual
decision logic is pure and already unit-tested in isolation with in-memory
fakes (tests/test_ratification.py, tests/test_extraction.py); this file's
only job is translating that logic's data needs into SQL against
knowledge_core.* and the operational tables.

Every method here runs on a psycopg Connection the caller already opened
and is managing the transaction for -- neither class ever commits or rolls
back itself. That's what lets a route compose "validate, then write" (or,
on failure, "validate, write nothing") into one atomic unit: see
app/routes_knowledge_core.py, which is the only place these get
instantiated.
"""

from __future__ import annotations

from psycopg import Connection
from psycopg.types.json import Json

from app.extraction import TARGET_TABLE, TargetType
from app.ratification import EntryRecord, EntryStatus, ReferenceRecord

# ---------------------------------------------------------------------------
# Ratification
# ---------------------------------------------------------------------------


class PostgresKnowledgeCoreRepository:
    """Backs app.ratification.transition() / validate_for_ratification()."""

    def __init__(self, conn: Connection):
        self._conn = conn

    def get_entry(self, entry_id: str) -> EntryRecord | None:
        row = self._conn.execute(
            "select id, status, book_placement from knowledge_core.kc_entries where id = %s",
            (entry_id,),
        ).fetchone()
        if row is None:
            return None
        row_id, status, book_placement = row
        return EntryRecord(id=str(row_id), status=EntryStatus(status), book_placement=book_placement)

    def get_outgoing_references(self, entry_id: str) -> list[ReferenceRecord]:
        rows = self._conn.execute(
            "select to_entry_id, relationship_type from knowledge_core.kc_references "
            "where from_entry_id = %s",
            (entry_id,),
        ).fetchall()
        return [
            ReferenceRecord(to_entry_id=str(to_entry_id), relationship_type=relationship_type)
            for to_entry_id, relationship_type in rows
        ]

    def set_status(self, entry_id: str, new_status: EntryStatus) -> None:
        """Not part of the ratification.KnowledgeCoreRepository Protocol --
        that Protocol is read-only by design, since transition() itself
        never writes (see its own docstring: "callers commit the new status
        in the same transaction as any side effects"). Called by the route
        only after transition() has validated the move."""
        if new_status == EntryStatus.RATIFIED:
            self._conn.execute(
                "update knowledge_core.kc_entries "
                "set status = %s, ratified_at = now(), updated_at = now() "
                "where id = %s",
                (new_status.value, entry_id),
            )
        else:
            self._conn.execute(
                "update knowledge_core.kc_entries set status = %s, updated_at = now() where id = %s",
                (new_status.value, entry_id),
            )

    def list_entries(self, status: EntryStatus | None = None) -> list[dict]:
        """Read-only convenience for the admin Knowledge Core browser --
        not part of ratification.py's Protocol (that contract only needs
        single-entry lookups), just colocated since it's the same table and
        connection pattern."""
        if status is not None:
            rows = self._conn.execute(
                "select id, entry_type, title, status, book_placement, created_at "
                "from knowledge_core.kc_entries where status = %s order by created_at desc",
                (status.value,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "select id, entry_type, title, status, book_placement, created_at "
                "from knowledge_core.kc_entries order by created_at desc"
            ).fetchall()

        return [
            {
                "id": str(row[0]),
                "entry_type": row[1],
                "title": row[2],
                "status": row[3],
                "book_placement": row[4],
                "created_at": row[5].isoformat(),
            }
            for row in rows
        ]

    def get_entry_full(self, entry_id: str) -> dict | None:
        """Read-only convenience for the admin entry-detail view -- same
        caveat as list_entries() above."""
        row = self._conn.execute(
            "select id, entry_type, title, body, status, book_placement, character_ids, "
            "created_at, updated_at, ratified_at "
            "from knowledge_core.kc_entries where id = %s",
            (entry_id,),
        ).fetchone()
        if row is None:
            return None

        entry_id_val = str(row[0])
        references = self.get_outgoing_references(entry_id_val)

        return {
            "id": entry_id_val,
            "entry_type": row[1],
            "title": row[2],
            "body": row[3],
            "status": row[4],
            "book_placement": row[5],
            "character_ids": [str(c) for c in row[6]],
            "created_at": row[7].isoformat(),
            "updated_at": row[8].isoformat(),
            "ratified_at": row[9].isoformat() if row[9] else None,
            "outgoing_references": [
                {"to_entry_id": r.to_entry_id, "relationship_type": r.relationship_type}
                for r in references
            ],
        }


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

# The columns each target table's NOT NULL-with-no-default constraints
# actually require -- extraction.commit_extraction() raises before ever
# reaching SQL if extracted_content is missing one of these.
REQUIRED_COLUMNS: dict[TargetType, tuple[str, ...]] = {
    TargetType.CHRONICLE_ENTRY: ("character_id", "entry_number", "title", "body_markdown"),
    TargetType.WORLD_BRIEFING: ("category", "title", "body_markdown"),
    TargetType.ARCHIVE_DOCUMENT: ("document_type", "title", "body_markdown"),
}

# Columns the operational tables accept but that have their own DB default
# (or are nullable) -- included in the INSERT only when extracted_content
# actually supplies them, so an extraction that doesn't have an opinion on
# (say) arc_label doesn't have to pass an explicit null.
OPTIONAL_COLUMNS: dict[TargetType, tuple[str, ...]] = {
    TargetType.CHRONICLE_ENTRY: ("arc_label", "onyx_commentary", "word_count", "publish_date"),
    TargetType.WORLD_BRIEFING: ("related_character_ids",),
    TargetType.ARCHIVE_DOCUMENT: ("subtitle", "character_id", "structured_data", "tags"),
}

# Columns that need the Json() adapter rather than psycopg's default type
# inference (a plain Python dict has no unambiguous Postgres type).
JSONB_COLUMNS = frozenset({"structured_data"})


class PostgresExtractionRepository:
    """Backs app.extraction.commit_extraction()."""

    def __init__(self, conn: Connection):
        self._conn = conn

    def get_entry_status(self, entry_id: str) -> EntryStatus | None:
        row = self._conn.execute(
            "select status from knowledge_core.kc_entries where id = %s", (entry_id,)
        ).fetchone()
        return EntryStatus(row[0]) if row else None

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

        missing = [column for column in required if column not in content]
        if missing:
            raise ValueError(
                f"extracted_content missing required column(s) for {target_type.value}: {missing}"
            )

        present_optional = [column for column in optional if column in content]
        columns = [*required, *present_optional, "required_clearance", "storage_mode", "book_placement"]
        values = {
            **content,
            "required_clearance": clearance_level,
            "storage_mode": storage_mode,
            "book_placement": book_placement,
        }

        column_sql = ", ".join(columns)
        placeholder_sql = ", ".join(["%s"] * len(columns))
        params = [
            Json(values[column]) if column in JSONB_COLUMNS else values[column] for column in columns
        ]

        row = self._conn.execute(
            f"insert into public.{table} ({column_sql}) values ({placeholder_sql}) returning id",  # noqa: S608
            params,
        ).fetchone()
        return str(row[0])

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
        row = self._conn.execute(
            "insert into knowledge_core.kc_extractions "
            "(source_entry_id, target_type, extracted_content, clearance_level, book_placement, "
            " status, operational_table, operational_row_id, committed_at) "
            "values (%s, %s, %s, %s, %s, 'committed', %s, %s, now()) "
            "returning id",
            (
                source_entry_id,
                target_type.value,
                Json(extracted_content),
                clearance_level,
                book_placement,
                operational_table,
                operational_row_id,
            ),
        ).fetchone()
        return str(row[0])
