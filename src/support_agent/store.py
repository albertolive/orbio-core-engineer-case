from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from pathlib import Path
from uuid import UUID

from support_agent.domain import ConversationSession, ConversationTurn


class SessionNotFoundError(LookupError):
    pass


class IdempotencyConflictError(ValueError):
    pass


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def check_idempotency(
    session: ConversationSession,
    client_turn_id: str,
    payload_sha256: str,
) -> ConversationTurn | None:
    for turn in session.turns:
        if turn.client_turn_id == client_turn_id:
            if turn.payload_sha256 != payload_sha256:
                raise IdempotencyConflictError(
                    f"client_turn_id {client_turn_id!r} already used with a different payload"
                )
            return turn
    return None


class JsonConversationStore:
    def __init__(self, sessions_dir: Path) -> None:
        self._dir = sessions_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        # ponytail: single-worker in-process lock dict; replace with a Postgres optimistic
        # version check and unique (session_id, client_turn_id) constraint for multi-worker scale.
        self._locks: dict[UUID, asyncio.Lock] = {}

    def lock_for(self, session_id: UUID) -> asyncio.Lock:
        return self._locks.setdefault(session_id, asyncio.Lock())

    def path_for(self, session_id: UUID) -> Path:
        return self._dir / f"{session_id}.json"

    def load(self, session_id: UUID) -> ConversationSession:
        path = self.path_for(session_id)
        if not path.is_file():
            raise SessionNotFoundError(f"session {session_id} not found")
        return ConversationSession.model_validate_json(path.read_text(encoding="utf-8"))

    def save(self, session: ConversationSession) -> None:
        payload = (session.model_dump_json(indent=2) + "\n").encode("utf-8")
        fd, tmp_name = tempfile.mkstemp(
            dir=self._dir,
            prefix=f".{session.session_id}.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.path_for(session.session_id))
        except BaseException:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise
