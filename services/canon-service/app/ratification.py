"""The Knowledge Core ratification state machine and cross-reference validator.

This is the one piece of logic the extraction workflow and the future
post-series fan-contribution workflow both depend on -- it must behave
identically no matter what triggers a transition (an admin click, a cron
job, or eventually a fan submission), so it lives here as pure, injectable
logic rather than being reimplemented per call site.

    draft -> under_review -> ratified -> locked
                  |               |
              rejected       superseded

AI-Parse output always lands as `draft`. Ratifying an entry is exclusively a
human action, gated by the checks in `validate_for_ratification` below.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol


class EntryStatus(str, Enum):
    DRAFT = "draft"
    UNDER_REVIEW = "under_review"
    RATIFIED = "ratified"
    LOCKED = "locked"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


# Statuses a dependency must already be in for a citing entry to ratify.
# Locked counts too -- it's ratified *and* already extracted, still a valid
# citation target.
RATIFIED_LIKE = frozenset({EntryStatus.RATIFIED, EntryStatus.LOCKED})

VALID_TRANSITIONS: dict[EntryStatus, frozenset[EntryStatus]] = {
    EntryStatus.DRAFT: frozenset({EntryStatus.UNDER_REVIEW}),
    EntryStatus.UNDER_REVIEW: frozenset(
        {EntryStatus.RATIFIED, EntryStatus.REJECTED, EntryStatus.DRAFT}
    ),
    EntryStatus.RATIFIED: frozenset({EntryStatus.LOCKED, EntryStatus.SUPERSEDED}),
    EntryStatus.LOCKED: frozenset({EntryStatus.SUPERSEDED}),
    EntryStatus.REJECTED: frozenset({EntryStatus.DRAFT}),
    EntryStatus.SUPERSEDED: frozenset(),
}

# Book placement ordering -- a dependency must not sit "later" in the series
# than the entry citing it (a pre-book Chronicle Entry can't depend on Book 3
# content that doesn't exist yet from the reader's vantage point).
BOOK_PLACEMENT_ORDER = [
    "pre_book",
    "book_1",
    "book_2",
    "book_3",
    "book_4",
    "book_5",
    "post_series",
]


class RatificationError(Exception):
    """Raised with a stable `code` so callers can branch on failure reason
    without parsing message text."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class EntryRecord:
    id: str
    status: EntryStatus
    book_placement: str


@dataclass(frozen=True)
class ReferenceRecord:
    to_entry_id: str
    relationship_type: str  # "mentions" | "depends_on" | "contradicts" | "supersedes"


class KnowledgeCoreRepository(Protocol):
    """The data access boundary. A real implementation talks to Postgres;
    tests use an in-memory fake -- ratification logic itself never imports
    a DB client, which is what makes it unit-testable in isolation."""

    def get_entry(self, entry_id: str) -> EntryRecord | None: ...
    def get_outgoing_references(self, entry_id: str) -> list[ReferenceRecord]: ...


def _book_index(book_placement: str) -> int:
    try:
        return BOOK_PLACEMENT_ORDER.index(book_placement)
    except ValueError as exc:
        raise RatificationError(
            "unknown_book_placement", f"Unrecognized book_placement: {book_placement!r}"
        ) from exc


def validate_for_ratification(repo: KnowledgeCoreRepository, entry: EntryRecord) -> None:
    """Raises RatificationError if `entry` may not become RATIFIED yet.
    Only `depends_on` references are load-bearing here -- `mentions` is
    informational, `contradicts`/`supersedes` are handled elsewhere (canon
    conflict review), not blockers to this specific entry's ratification."""

    entry_book_index = _book_index(entry.book_placement)

    for ref in repo.get_outgoing_references(entry.id):
        if ref.relationship_type != "depends_on":
            continue

        target = repo.get_entry(ref.to_entry_id)
        if target is None:
            raise RatificationError(
                "missing_dependency",
                f"Entry {entry.id} depends on {ref.to_entry_id}, which does not exist.",
            )

        if target.status not in RATIFIED_LIKE:
            raise RatificationError(
                "unratified_dependency",
                f"Entry {entry.id} depends on {target.id}, which is not ratified "
                f"(status={target.status.value}).",
            )

        if _book_index(target.book_placement) > entry_book_index:
            raise RatificationError(
                "book_placement_conflict",
                f"Entry {entry.id} (book_placement={entry.book_placement}) depends on "
                f"{target.id} (book_placement={target.book_placement}), which is later "
                "in the series than the entry citing it.",
            )


def transition(
    repo: KnowledgeCoreRepository, entry_id: str, new_status: EntryStatus
) -> EntryStatus:
    """The single entry point for moving an entry's status. Returns the new
    status on success; raises RatificationError on any invalid transition or
    failed validation. Never mutates the repository itself -- callers commit
    the new status in the same transaction as any side effects (e.g. an
    extraction commit), which is why this returns a value rather than writing."""

    entry = repo.get_entry(entry_id)
    if entry is None:
        raise RatificationError("not_found", f"No such entry: {entry_id}")

    allowed = VALID_TRANSITIONS.get(entry.status, frozenset())
    if new_status not in allowed:
        raise RatificationError(
            "invalid_transition",
            f"Cannot move entry {entry_id} from {entry.status.value} to "
            f"{new_status.value}. Allowed: {sorted(s.value for s in allowed)}",
        )

    if new_status == EntryStatus.RATIFIED:
        validate_for_ratification(repo, entry)

    return new_status
