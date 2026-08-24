from app.ratification import (
    EntryRecord,
    EntryStatus,
    ReferenceRecord,
    RatificationError,
    transition,
)


class FakeRepository:
    """In-memory KnowledgeCoreRepository for testing -- no DB, no network."""

    def __init__(self, entries: dict[str, EntryRecord], references: dict[str, list[ReferenceRecord]]):
        self._entries = entries
        self._references = references

    def get_entry(self, entry_id: str) -> EntryRecord | None:
        return self._entries.get(entry_id)

    def get_outgoing_references(self, entry_id: str) -> list[ReferenceRecord]:
        return self._references.get(entry_id, [])


def make_repo(**overrides) -> FakeRepository:
    entries = {
        "weapon": EntryRecord(id="weapon", status=EntryStatus.DRAFT, book_placement="pre_book"),
        "chronicle": EntryRecord(id="chronicle", status=EntryStatus.DRAFT, book_placement="pre_book"),
    }
    entries.update(overrides.pop("entries", {}))
    references = overrides.pop("references", {})
    return FakeRepository(entries, references)


def test_valid_forward_transitions_succeed():
    repo = make_repo(entries={"chronicle": EntryRecord("chronicle", EntryStatus.DRAFT, "pre_book")})
    assert transition(repo, "chronicle", EntryStatus.UNDER_REVIEW) == EntryStatus.UNDER_REVIEW


def test_draft_cannot_skip_straight_to_ratified():
    repo = make_repo(entries={"chronicle": EntryRecord("chronicle", EntryStatus.DRAFT, "pre_book")})
    try:
        transition(repo, "chronicle", EntryStatus.RATIFIED)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "invalid_transition"


def test_locked_is_terminal_except_supersede():
    repo = make_repo(entries={"chronicle": EntryRecord("chronicle", EntryStatus.LOCKED, "pre_book")})
    try:
        transition(repo, "chronicle", EntryStatus.RATIFIED)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "invalid_transition"

    assert transition(repo, "chronicle", EntryStatus.SUPERSEDED) == EntryStatus.SUPERSEDED


def test_ratify_blocked_by_unratified_dependency():
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.DRAFT, "pre_book"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "depends_on")]},
    )
    try:
        transition(repo, "chronicle", EntryStatus.RATIFIED)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "unratified_dependency"
        assert "weapon" in str(e)


def test_ratify_succeeds_once_dependency_is_ratified():
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.RATIFIED, "pre_book"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "depends_on")]},
    )
    assert transition(repo, "chronicle", EntryStatus.RATIFIED) == EntryStatus.RATIFIED


def test_ratify_succeeds_when_dependency_is_locked_too():
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.LOCKED, "pre_book"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "depends_on")]},
    )
    assert transition(repo, "chronicle", EntryStatus.RATIFIED) == EntryStatus.RATIFIED


def test_mentions_reference_does_not_block_ratification():
    # A "mentions" link (not "depends_on") to an unratified entry is fine --
    # only depends_on is load-bearing.
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.DRAFT, "pre_book"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "mentions")]},
    )
    assert transition(repo, "chronicle", EntryStatus.RATIFIED) == EntryStatus.RATIFIED


def test_ratify_blocked_by_missing_dependency():
    repo = make_repo(
        entries={"chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book")},
        references={"chronicle": [ReferenceRecord("ghost", "depends_on")]},
    )
    try:
        transition(repo, "chronicle", EntryStatus.RATIFIED)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "missing_dependency"


def test_ratify_blocked_by_book_placement_conflict():
    # A pre-book entry cannot depend on Book 3 content -- that's later in the
    # series than the entry citing it.
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.RATIFIED, "book_3"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "pre_book"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "depends_on")]},
    )
    try:
        transition(repo, "chronicle", EntryStatus.RATIFIED)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "book_placement_conflict"


def test_ratify_allows_dependency_from_earlier_book():
    repo = make_repo(
        entries={
            "weapon": EntryRecord("weapon", EntryStatus.RATIFIED, "pre_book"),
            "chronicle": EntryRecord("chronicle", EntryStatus.UNDER_REVIEW, "book_2"),
        },
        references={"chronicle": [ReferenceRecord("weapon", "depends_on")]},
    )
    assert transition(repo, "chronicle", EntryStatus.RATIFIED) == EntryStatus.RATIFIED


def test_transition_on_unknown_entry_raises_not_found():
    repo = make_repo()
    try:
        transition(repo, "does-not-exist", EntryStatus.UNDER_REVIEW)
        assert False, "expected RatificationError"
    except RatificationError as e:
        assert e.code == "not_found"
