"""The writer-reference -> reader-facing extraction commit.

P1-3 in the archive game plan: "Select a section of a Character Codex,
Arsenal Dossier, Tactical Architecture, or Threat Blueprint and promote it
into a new reader-facing row... with its own clearance and book placement,
leaving the source row untouched." Nothing in the described admin sections
performs this, and per the game plan's own Phase 5 correction, the unlock
cascade has no legal mechanism without it -- Writer-Reference rows never
flip directly to Live.

Pure, injectable logic, same shape as ratification.py and for the same
reason: a real implementation wraps both writes (the new operational row,
and the kc_extractions record pointing at it) in one Postgres transaction,
but the decision logic itself -- can this source be extracted from, what
storage_mode does the result get -- has no DB dependency and is unit-tested
in isolation here.

No HTTP route wires this up yet, matching main.py's own stated scope
("Real admin/ratification routes land in a later pass") -- this ships the
commit logic and its tests, not the endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from app.ratification import BOOK_PLACEMENT_ORDER, RATIFIED_LIKE, EntryStatus


class TargetType(str, Enum):
    CHRONICLE_ENTRY = "chronicle_entry"
    WORLD_BRIEFING = "world_briefing"
    ARCHIVE_DOCUMENT = "archive_document"


# Mirrors kc_extractions.target_type's check constraint -> the operational
# table each target actually lands in (0002_knowledge_core_schema.sql).
TARGET_TABLE: dict[TargetType, str] = {
    TargetType.CHRONICLE_ENTRY: "chronicle_entries",
    TargetType.WORLD_BRIEFING: "world_briefings",
    TargetType.ARCHIVE_DOCUMENT: "archive_documents",
}

# Extraction always lands in the vault, regardless of book_placement --
# never a direct write to 'live'. Per the game plan's Phase 5: "the cascade
# makes Book-1-tagged vault items eligible to go live, subject to author
# review." Going live is always a separate, later, human action (via the
# chronicle/world-briefing/archive-document editors), not something the
# extraction commit itself decides.
EXTRACTED_STORAGE_MODE = "vault"


class ExtractionError(Exception):
    """Raised with a stable `code` so callers can branch on failure reason
    without parsing message text -- same convention as RatificationError."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class ExtractionRequest:
    source_entry_id: str
    target_type: TargetType
    extracted_content: dict
    clearance_level: int
    book_placement: str


@dataclass(frozen=True)
class CommittedExtraction:
    kc_extraction_id: str
    operational_table: str
    operational_row_id: str


class ExtractionRepository(Protocol):
    """The data access boundary. A real implementation talks to Postgres in
    one transaction; tests use an in-memory fake."""

    def get_entry_status(self, entry_id: str) -> EntryStatus | None: ...

    def insert_operational_row(
        self,
        target_type: TargetType,
        content: dict,
        clearance_level: int,
        book_placement: str,
        storage_mode: str,
    ) -> str:
        """Inserts into the table TARGET_TABLE[target_type] and returns the
        new row's id."""
        ...

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
        """Inserts a committed knowledge_core.kc_extractions row and returns
        its id."""
        ...


def _validate_clearance_level(clearance_level: int) -> None:
    if not 0 <= clearance_level <= 3:
        raise ExtractionError(
            "invalid_clearance_level",
            f"clearance_level must be between 0 and 3, got {clearance_level}.",
        )


def _validate_book_placement(book_placement: str) -> None:
    if book_placement not in BOOK_PLACEMENT_ORDER:
        raise ExtractionError(
            "unknown_book_placement", f"Unrecognized book_placement: {book_placement!r}"
        )


def commit_extraction(
    repo: ExtractionRepository, request: ExtractionRequest
) -> CommittedExtraction:
    """The single entry point for an extraction. Raises ExtractionError on
    any invalid request; otherwise writes the new operational row and its
    kc_extractions record and returns both ids. Never mutates the source
    kc_entries row -- extraction is additive, the writer-reference boundary
    depends on that."""

    _validate_clearance_level(request.clearance_level)
    _validate_book_placement(request.book_placement)

    status = repo.get_entry_status(request.source_entry_id)
    if status is None:
        raise ExtractionError(
            "source_not_found", f"No such Knowledge Core entry: {request.source_entry_id}"
        )

    if status not in RATIFIED_LIKE:
        raise ExtractionError(
            "source_not_ratified",
            f"Entry {request.source_entry_id} is not ratified (status={status.value}); "
            "only ratified or locked entries can be extracted from.",
        )

    operational_table = TARGET_TABLE[request.target_type]
    operational_row_id = repo.insert_operational_row(
        target_type=request.target_type,
        content=request.extracted_content,
        clearance_level=request.clearance_level,
        book_placement=request.book_placement,
        storage_mode=EXTRACTED_STORAGE_MODE,
    )

    kc_extraction_id = repo.record_extraction(
        source_entry_id=request.source_entry_id,
        target_type=request.target_type,
        extracted_content=request.extracted_content,
        clearance_level=request.clearance_level,
        book_placement=request.book_placement,
        operational_table=operational_table,
        operational_row_id=operational_row_id,
    )

    return CommittedExtraction(
        kc_extraction_id=kc_extraction_id,
        operational_table=operational_table,
        operational_row_id=operational_row_id,
    )
