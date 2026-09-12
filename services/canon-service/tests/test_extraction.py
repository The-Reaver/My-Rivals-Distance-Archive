from app.extraction import (
    EXTRACTED_STORAGE_MODE,
    TARGET_TABLE,
    CommittedExtraction,
    ExtractionError,
    ExtractionRequest,
    TargetType,
    commit_extraction,
)
from app.ratification import EntryStatus


class FakeRepository:
    """In-memory ExtractionRepository -- no DB, no network."""

    def __init__(self, entries: dict[str, EntryStatus]):
        self._entries = entries
        self.inserted_rows: list[dict] = []
        self.recorded_extractions: list[dict] = []
        self._next_row_id = 0
        self._next_extraction_id = 0

    def get_entry_status(self, entry_id: str) -> EntryStatus | None:
        return self._entries.get(entry_id)

    def insert_operational_row(
        self, target_type, content, clearance_level, book_placement, storage_mode
    ) -> str:
        self._next_row_id += 1
        row_id = f"row-{self._next_row_id}"
        self.inserted_rows.append(
            {
                "id": row_id,
                "target_type": target_type,
                "content": content,
                "clearance_level": clearance_level,
                "book_placement": book_placement,
                "storage_mode": storage_mode,
            }
        )
        return row_id

    def record_extraction(
        self,
        source_entry_id,
        target_type,
        extracted_content,
        clearance_level,
        book_placement,
        operational_table,
        operational_row_id,
    ) -> str:
        self._next_extraction_id += 1
        extraction_id = f"extraction-{self._next_extraction_id}"
        self.recorded_extractions.append(
            {
                "id": extraction_id,
                "source_entry_id": source_entry_id,
                "target_type": target_type,
                "extracted_content": extracted_content,
                "clearance_level": clearance_level,
                "book_placement": book_placement,
                "operational_table": operational_table,
                "operational_row_id": operational_row_id,
            }
        )
        return extraction_id


def make_request(**overrides) -> ExtractionRequest:
    defaults = dict(
        source_entry_id="weapon",
        target_type=TargetType.ARCHIVE_DOCUMENT,
        extracted_content={"title": "The Rexmar Machete"},
        clearance_level=1,
        book_placement="pre_book",
    )
    defaults.update(overrides)
    return ExtractionRequest(**defaults)


def test_extraction_succeeds_for_ratified_source():
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    result = commit_extraction(repo, make_request())
    assert isinstance(result, CommittedExtraction)
    assert result.operational_table == "archive_documents"
    assert len(repo.inserted_rows) == 1
    assert len(repo.recorded_extractions) == 1


def test_extraction_succeeds_for_locked_source():
    repo = FakeRepository({"weapon": EntryStatus.LOCKED})
    result = commit_extraction(repo, make_request())
    assert result.operational_row_id == repo.inserted_rows[0]["id"]


def test_extraction_blocked_for_draft_source():
    repo = FakeRepository({"weapon": EntryStatus.DRAFT})
    try:
        commit_extraction(repo, make_request())
        assert False, "expected ExtractionError"
    except ExtractionError as e:
        assert e.code == "source_not_ratified"
    assert repo.inserted_rows == []
    assert repo.recorded_extractions == []


def test_extraction_blocked_for_under_review_source():
    repo = FakeRepository({"weapon": EntryStatus.UNDER_REVIEW})
    try:
        commit_extraction(repo, make_request())
        assert False, "expected ExtractionError"
    except ExtractionError as e:
        assert e.code == "source_not_ratified"


def test_extraction_blocked_for_missing_source():
    repo = FakeRepository({})
    try:
        commit_extraction(repo, make_request(source_entry_id="ghost"))
        assert False, "expected ExtractionError"
    except ExtractionError as e:
        assert e.code == "source_not_found"


def test_extraction_blocked_for_invalid_clearance_level():
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    for bad_level in (-1, 4):
        try:
            commit_extraction(repo, make_request(clearance_level=bad_level))
            assert False, "expected ExtractionError"
        except ExtractionError as e:
            assert e.code == "invalid_clearance_level"
    assert repo.inserted_rows == []


def test_extraction_blocked_for_unknown_book_placement():
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    try:
        commit_extraction(repo, make_request(book_placement="book_99"))
        assert False, "expected ExtractionError"
    except ExtractionError as e:
        assert e.code == "unknown_book_placement"
    assert repo.inserted_rows == []


def test_extraction_always_writes_vault_storage_mode_regardless_of_book_placement():
    # Phase 5's own correction: extraction never writes 'live' directly,
    # even for pre_book content -- going live is always a separate,
    # subsequent human action.
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    for placement in ("pre_book", "book_1", "book_5", "post_series"):
        commit_extraction(repo, make_request(book_placement=placement))
    assert all(row["storage_mode"] == EXTRACTED_STORAGE_MODE for row in repo.inserted_rows)
    assert EXTRACTED_STORAGE_MODE == "vault"


def test_extraction_does_not_mutate_source_entry():
    # ExtractionRepository has no method that could change an existing
    # kc_entries row's status -- extraction is additive by construction,
    # not just by convention. This test documents that guarantee.
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    commit_extraction(repo, make_request())
    assert repo.get_entry_status("weapon") == EntryStatus.RATIFIED


def test_target_table_mapping_covers_every_target_type():
    assert TARGET_TABLE[TargetType.CHRONICLE_ENTRY] == "chronicle_entries"
    assert TARGET_TABLE[TargetType.WORLD_BRIEFING] == "world_briefings"
    assert TARGET_TABLE[TargetType.ARCHIVE_DOCUMENT] == "archive_documents"
    for target_type in TargetType:
        assert target_type in TARGET_TABLE


def test_extraction_for_each_target_type_routes_to_correct_table():
    repo = FakeRepository({"weapon": EntryStatus.RATIFIED})
    for target_type, table in TARGET_TABLE.items():
        result = commit_extraction(repo, make_request(target_type=target_type))
        assert result.operational_table == table
