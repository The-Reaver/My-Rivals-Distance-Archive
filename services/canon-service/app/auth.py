"""Supabase JWT verification.

Every route canon-service exposes beyond /health is gated by this dependency.
Tokens are verified against Supabase's JWKS endpoint (asymmetric signing
keys), not a shared secret -- so canon-service never needs to hold the
project's JWT secret, only trust its public keys.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else ""


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None


@lru_cache(maxsize=1)
def _jwk_client() -> PyJWKClient:
    if not JWKS_URL:
        raise RuntimeError("SUPABASE_URL is not configured -- cannot fetch JWKS.")
    # PyJWKClient caches keys internally and refetches on an unknown kid,
    # which is exactly the behavior wanted across a Supabase signing-key rotation.
    return PyJWKClient(JWKS_URL, cache_keys=True)


def verify_token(token: str) -> AuthenticatedUser:
    signing_key = _jwk_client().get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        audience="authenticated",
        options={"require": ["exp", "sub"]},
    )
    return AuthenticatedUser(id=claims["sub"], email=claims.get("email"))


async def require_user(authorization: str = Header(default="")) -> AuthenticatedUser:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    try:
        return verify_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc
