"""Admin-only Knowledge Core routes: ratification transitions and
extraction commits. Both wrap their pure logic module (app.ratification /
app.extraction -- already unit-tested in isolation) in one Postgres
transaction via psycopg_pool's connection() context manager: it commits on
a clean exit and rolls back on any exception, so a validation failure
(RatificationError / ExtractionError) leaves nothing partially written.

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
