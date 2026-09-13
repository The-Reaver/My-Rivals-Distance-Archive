"""Route-level integration tests for routes_knowledge_core.py.

test_repositories_integration.py already exercises the underlying SQL in
depth; this file proves the thin FastAPI layer on top of it -- URL paths,
request/response shapes, status codes, and the admin gate -- actually
works end to end against a real Postgres instance. Same TEST_DATABASE_URL
requirement and skip condition as that file.
"""

from __future__ import annotations

import os

import psycopg
import pytest
from fastapi.testclient import TestClient

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set -- these integration tests need a real, migrated Postgres.",
)


def insert_kc_entry(status: str = "draft") -> str:
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        row = conn.execute(
            "insert into knowledge_core.kc_entries (entry_type, title, status) "
            "values ('test_entry', 'Route Test Entry', %s) returning id",
            (status,),
        ).fetchone()
        return str(row[0])


def insert_character() -> str:
    import uuid

    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        row = conn.execute(
            "insert into public.characters (slug, name) values (%s, 'Route Test Character') "
            "returning id",
            (f"route-test-{uuid.uuid4()}",),
        ).fetchone()
        return str(row[0])


@pytest.fixture
def app_with_admin_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    from app.admin import require_admin
    from app.auth import AuthenticatedUser
    from app.main import app

    app.dependency_overrides[require_admin] = lambda: AuthenticatedUser(
        id="test-admin", email="admin@example.com"
    )
    yield app
    app.dependency_overrides.clear()


def test_transition_route_persists_the_new_status(app_with_admin_override):
    entry_id = insert_kc_entry(status="under_review")

    with TestClient(app_with_admin_override) as client:
        response = client.post(
            f"/knowledge-core/entries/{entry_id}/transition", json={"new_status": "ratified"}
        )

    assert response.status_code == 200
    assert response.json() == {"entry_id": entry_id, "status": "ratified"}


def test_transition_route_returns_409_on_invalid_transition(app_with_admin_override):
    entry_id = insert_kc_entry(status="draft")

    with TestClient(app_with_admin_override) as client:
        # draft can't jump straight to ratified -- must pass through under_review.
        response = client.post(
            f"/knowledge-core/entries/{entry_id}/transition", json={"new_status": "ratified"}
        )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_transition"


def test_extraction_route_commits_and_returns_ids(app_with_admin_override):
    source_id = insert_kc_entry(status="ratified")
    character_id = insert_character()

    with TestClient(app_with_admin_override) as client:
        response = client.post(
            "/knowledge-core/extractions",
            json={
                "source_entry_id": source_id,
                "target_type": "archive_document",
                "extracted_content": {
                    "document_type": "arsenal_dossier",
                    "title": "Route Test Weapon",
                    "character_id": character_id,
                    "body_markdown": "Body.",
                },
                "clearance_level": 1,
                "book_placement": "pre_book",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["operational_table"] == "archive_documents"
    assert body["operational_row_id"]
    assert body["kc_extraction_id"]


def test_knowledge_core_routes_require_admin(monkeypatch):
    # No dependency override here -- require_user itself will reject the
    # missing bearer token before require_admin's DB check ever runs.
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge-core/entries/some-id/transition", json={"new_status": "ratified"}
        )

    assert response.status_code == 401
