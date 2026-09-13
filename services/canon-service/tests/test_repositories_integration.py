"""Integration tests for the Postgres-backed repositories.

The pure logic in app.ratification / app.extraction is already unit-tested
against in-memory fakes (test_ratification.py, test_extraction.py) -- this
file proves the real SQL in app.repositories actually does the right thing
against the real schema, using a genuine Postgres instance rather than a
Protocol double.

Requires TEST_DATABASE_URL, pointed at a database that already has
supabase/testing/local_auth_stub.sql and every file in supabase/migrations/
applied, in order (see that stub's own header, and .github/workflows/ci.yml
for the automated version of the same setup). Skipped entirely when that
env var isn't set, so the base `pytest -q` a casual contributor runs stays
DB-free -- these are opt-in, not part of the default suite.

Each test opens its own connection and rolls back at the end instead of
committing, so tests never need to clean up after each other or run in any
particular order.
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from app.extraction import ExtractionError, ExtractionRequest, TargetType, commit_extraction
from app.ratification import EntryStatus, RatificationError, transition
from app.repositories import PostgresExtractionRepository, PostgresKnowledgeCoreRepository

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set -- these integration tests need a real, migrated Postgres.",
)


@pytest.fixture
def conn():
    connection = psycopg.connect(TEST_DATABASE_URL)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def insert_kc_entry(conn, status: str = "draft", book_placement: str = "pre_book") -> str:
    row = conn.execute(
        "insert into knowledge_core.kc_entries (entry_type, title, status, book_placement) "
        "values ('test_entry', 'Test Entry', %s, %s) returning id",
        (status, book_placement),
    ).fetchone()
    return str(row[0])


def insert_character(conn) -> str:
    row = conn.execute(
        "insert into public.characters (slug, name) values (%s, 'Test Character') returning id",
        (f"test-{uuid.uuid4()}",),
    ).fetchone()
    return str(row[0])


class TestPostgresKnowledgeCoreRepository:
    def test_get_entry_returns_none_for_missing_id(self, conn):
        repo = PostgresKnowledgeCoreRepository(conn)
        assert repo.get_entry(str(uuid.uuid4())) is None

    def test_get_entry_round_trips_a_real_row(self, conn):
        entry_id = insert_kc_entry(conn, status="ratified", book_placement="book_1")
        repo = PostgresKnowledgeCoreRepository(conn)

        entry = repo.get_entry(entry_id)

        assert entry is not None
        assert entry.id == entry_id
        assert entry.status == EntryStatus.RATIFIED
        assert entry.book_placement == "book_1"

    def test_get_outgoing_references_reads_real_rows(self, conn):
        source_id = insert_kc_entry(conn)
        target_id = insert_kc_entry(conn)
        conn.execute(
            "insert into knowledge_core.kc_references (from_entry_id, to_entry_id, relationship_type) "
            "values (%s, %s, 'depends_on')",
            (source_id, target_id),
        )
        repo = PostgresKnowledgeCoreRepository(conn)

        refs = repo.get_outgoing_references(source_id)

        assert len(refs) == 1
        assert refs[0].to_entry_id == target_id
        assert refs[0].relationship_type == "depends_on"

    def test_transition_and_set_status_persist_together(self, conn):
        entry_id = insert_kc_entry(conn, status="under_review")
        repo = PostgresKnowledgeCoreRepository(conn)

        new_status = transition(repo, entry_id, EntryStatus.RATIFIED)
        repo.set_status(entry_id, new_status)

        # Re-fetch through a fresh call to prove the write actually landed,
        # not just that transition() returned the right in-memory value.
        reloaded = repo.get_entry(entry_id)
        assert reloaded.status == EntryStatus.RATIFIED

        row = conn.execute(
            "select ratified_at is not null from knowledge_core.kc_entries where id = %s",
            (entry_id,),
        ).fetchone()
        assert row[0] is True

    def test_transition_blocked_by_a_real_unratified_dependency(self, conn):
        dependency_id = insert_kc_entry(conn, status="draft")
        entry_id = insert_kc_entry(conn, status="under_review")
        conn.execute(
            "insert into knowledge_core.kc_references (from_entry_id, to_entry_id, relationship_type) "
            "values (%s, %s, 'depends_on')",
            (entry_id, dependency_id),
        )
        repo = PostgresKnowledgeCoreRepository(conn)

        with pytest.raises(RatificationError) as exc_info:
            transition(repo, entry_id, EntryStatus.RATIFIED)
        assert exc_info.value.code == "unratified_dependency"

        # Confirms transition() really didn't write anything -- set_status()
        # was never reached, so status should still read under_review.
        assert repo.get_entry(entry_id).status == EntryStatus.UNDER_REVIEW

    def test_list_entries_filters_by_status(self, conn):
        draft_id = insert_kc_entry(conn, status="draft")
        ratified_id = insert_kc_entry(conn, status="ratified")
        repo = PostgresKnowledgeCoreRepository(conn)

        ratified_only = repo.list_entries(EntryStatus.RATIFIED)
        ratified_ids = {e["id"] for e in ratified_only}

        assert ratified_id in ratified_ids
        assert draft_id not in ratified_ids

    def test_list_entries_with_no_filter_returns_everything(self, conn):
        entry_id = insert_kc_entry(conn, status="locked")
        repo = PostgresKnowledgeCoreRepository(conn)

        all_entries = repo.list_entries()

        assert any(e["id"] == entry_id for e in all_entries)

    def test_get_entry_full_returns_none_for_missing_id(self, conn):
        repo = PostgresKnowledgeCoreRepository(conn)
        assert repo.get_entry_full(str(uuid.uuid4())) is None

    def test_get_entry_full_includes_references(self, conn):
        target_id = insert_kc_entry(conn)
        entry_id = insert_kc_entry(conn, status="under_review")
        conn.execute(
            "insert into knowledge_core.kc_references (from_entry_id, to_entry_id, relationship_type) "
            "values (%s, %s, 'mentions')",
            (entry_id, target_id),
        )
        repo = PostgresKnowledgeCoreRepository(conn)

        detail = repo.get_entry_full(entry_id)

        assert detail is not None
        assert detail["id"] == entry_id
        assert detail["status"] == "under_review"
        assert isinstance(detail["body"], dict)
        assert detail["ratified_at"] is None
        assert len(detail["outgoing_references"]) == 1
        assert detail["outgoing_references"][0]["to_entry_id"] == target_id
        assert detail["outgoing_references"][0]["relationship_type"] == "mentions"


class TestPostgresExtractionRepository:
    def test_commit_extraction_writes_archive_document_and_extraction_record(self, conn):
        source_id = insert_kc_entry(conn, status="ratified")
        character_id = insert_character(conn)
        repo = PostgresExtractionRepository(conn)

        result = commit_extraction(
            repo,
            ExtractionRequest(
                source_entry_id=source_id,
                target_type=TargetType.ARCHIVE_DOCUMENT,
                extracted_content={
                    "document_type": "arsenal_dossier",
                    "title": "Test Weapon",
                    "character_id": character_id,
                    "body_markdown": "A test weapon entry.",
                    "structured_data": {"damage": "high"},
                    "tags": ["test", "weapon"],
                },
                clearance_level=1,
                book_placement="pre_book",
            ),
        )

        assert result.operational_table == "archive_documents"

        row = conn.execute(
            "select title, storage_mode, required_clearance, structured_data, tags "
            "from public.archive_documents where id = %s",
            (result.operational_row_id,),
        ).fetchone()
        assert row[0] == "Test Weapon"
        assert row[1] == "vault"  # always vault on write, never live directly
        assert row[2] == 1
        assert row[3] == {"damage": "high"}
        assert set(row[4]) == {"test", "weapon"}

        extraction_row = conn.execute(
            "select source_entry_id, status, operational_row_id from knowledge_core.kc_extractions "
            "where id = %s",
            (result.kc_extraction_id,),
        ).fetchone()
        # psycopg3 returns native UUID objects for uuid-typed columns, not
        # str -- str() them before comparing against the str ids the
        # repository layer returns (matching the Protocol's str contract).
        assert str(extraction_row[0]) == source_id
        assert extraction_row[1] == "committed"
        assert str(extraction_row[2]) == result.operational_row_id

    def test_commit_extraction_writes_chronicle_entry(self, conn):
        source_id = insert_kc_entry(conn, status="locked")
        character_id = insert_character(conn)
        repo = PostgresExtractionRepository(conn)

        result = commit_extraction(
            repo,
            ExtractionRequest(
                source_entry_id=source_id,
                target_type=TargetType.CHRONICLE_ENTRY,
                extracted_content={
                    "character_id": character_id,
                    "entry_number": 1,
                    "title": "Test Chronicle",
                    "body_markdown": "Once upon a time.",
                    "arc_label": "Test Arc",
                },
                clearance_level=2,
                book_placement="book_1",
            ),
        )

        assert result.operational_table == "chronicle_entries"
        row = conn.execute(
            "select title, arc_label, storage_mode, book_placement, is_live "
            "from public.chronicle_entries where id = %s",
            (result.operational_row_id,),
        ).fetchone()
        assert row[0] == "Test Chronicle"
        assert row[1] == "Test Arc"
        assert row[2] == "vault"
        assert row[3] == "book_1"
        assert row[4] is False  # extraction never sets is_live -- a separate, later action

    def test_commit_extraction_rejects_draft_source_and_writes_nothing(self, conn):
        source_id = insert_kc_entry(conn, status="draft")
        character_id = insert_character(conn)
        repo = PostgresExtractionRepository(conn)

        with pytest.raises(ExtractionError) as exc_info:
            commit_extraction(
                repo,
                ExtractionRequest(
                    source_entry_id=source_id,
                    target_type=TargetType.ARCHIVE_DOCUMENT,
                    extracted_content={
                        "document_type": "arsenal_dossier",
                        "title": "Should Not Exist",
                        "body_markdown": "N/A",
                    },
                    clearance_level=1,
                    book_placement="pre_book",
                ),
            )
        assert exc_info.value.code == "source_not_ratified"

        count = conn.execute(
            "select count(*) from public.archive_documents where title = 'Should Not Exist'"
        ).fetchone()[0]
        assert count == 0
        assert character_id  # keep the fixture alive/used for symmetry with the other tests
