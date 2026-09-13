"""Admin-only Knowledge Core routes.

GET /entries and GET /entries/{id} are plain reads backing the admin
browser UI in apps/web (list by status, one entry's full detail plus its
outgoing references).

POST /entries/{id}/transition and POST /extractions wrap their pure logic
module (app.ratification / app.extraction -- already unit-tested in
isolation) in one Postgres transaction via psycopg_pool's connection()
context manager: it commits on a clean exit and rolls back on any
exception, so a validation failure (RatificationError / ExtractionError)
leaves nothing partially written.

These are the "real admin/ratification routes" main.py's own module
docstring said would "land in a later pass" -- this is that pass.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.admin import require_admin
from app.auth import AuthenticatedUser
from app.db import get_pool
from app.extraction import (
    ExtractionError,
    ExtractionRequest,
    TargetType,
    commit_extraction,
)
from app.ratification import EntryStatus, RatificationError, transition
from app.repositories import PostgresExtractionRepository, PostgresKnowledgeCoreRepository

router = APIRouter(prefix="/knowledge-core", tags=["knowledge-core"])


class EntrySummaryResponse(BaseModel):
    id: str
    entry_type: str
    title: str
    status: EntryStatus
    book_placement: str
    created_at: str


@router.get("/entries", response_model=list[EntrySummaryResponse])
def list_entries(
    status: EntryStatus | None = None,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> list[EntrySummaryResponse]:
    pool = get_pool()
    with pool.connection() as conn:
        repo = PostgresKnowledgeCoreRepository(conn)
        entries = repo.list_entries(status)

    return [EntrySummaryResponse(**entry) for entry in entries]


class ReferenceResponse(BaseModel):
    to_entry_id: str
    relationship_type: str


class EntryDetailResponse(BaseModel):
    id: str
    entry_type: str
    title: str
    body: dict
    status: EntryStatus
    book_placement: str
    character_ids: list[str]
    created_at: str
    updated_at: str
    ratified_at: str | None
    outgoing_references: list[ReferenceResponse]


@router.get("/entries/{entry_id}", response_model=EntryDetailResponse)
def get_entry(
    entry_id: str,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> EntryDetailResponse:
    pool = get_pool()
    with pool.connection() as conn:
        repo = PostgresKnowledgeCoreRepository(conn)
        entry = repo.get_entry_full(entry_id)

    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    return EntryDetailResponse(**entry)


class TransitionRequest(BaseModel):
    new_status: EntryStatus


class TransitionResponse(BaseModel):
    entry_id: str
    status: EntryStatus


@router.post("/entries/{entry_id}/transition", response_model=TransitionResponse)
def transition_entry(
    entry_id: str,
    body: TransitionRequest,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> TransitionResponse:
    pool = get_pool()
    with pool.connection() as conn:
        repo = PostgresKnowledgeCoreRepository(conn)
        try:
            new_status = transition(repo, entry_id, body.new_status)
        except RatificationError as exc:
            raise HTTPException(
                status_code=409, detail={"code": exc.code, "message": str(exc)}
            ) from exc
        repo.set_status(entry_id, new_status)

    return TransitionResponse(entry_id=entry_id, status=new_status)


class ExtractionCommitRequest(BaseModel):
    source_entry_id: str
    target_type: TargetType
    extracted_content: dict
    clearance_level: int = Field(ge=0, le=3)
    book_placement: str


class ExtractionCommitResponse(BaseModel):
    kc_extraction_id: str
    operational_table: str
    operational_row_id: str


@router.post("/extractions", response_model=ExtractionCommitResponse)
def commit_extraction_route(
    body: ExtractionCommitRequest,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> ExtractionCommitResponse:
    pool = get_pool()
    with pool.connection() as conn:
        repo = PostgresExtractionRepository(conn)
        try:
            result = commit_extraction(
                repo,
                ExtractionRequest(
                    source_entry_id=body.source_entry_id,
                    target_type=body.target_type,
                    extracted_content=body.extracted_content,
                    clearance_level=body.clearance_level,
                    book_placement=body.book_placement,
                ),
            )
        except ExtractionError as exc:
            raise HTTPException(
                status_code=409, detail={"code": exc.code, "message": str(exc)}
            ) from exc

    return ExtractionCommitResponse(
        kc_extraction_id=result.kc_extraction_id,
        operational_table=result.operational_table,
        operational_row_id=result.operational_row_id,
    )
