from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest

from support_agent.domain import ConversationSession, ConversationTurn, Language
from support_agent.store import (
    IdempotencyConflictError,
    JsonConversationStore,
    SessionNotFoundError,
    check_idempotency,
    sha256_bytes,
)


def _make_session() -> ConversationSession:
    return ConversationSession(
        session_id=uuid4(),
        created_at="2026-11-16T12:00:00+00:00",
        updated_at="2026-11-16T12:00:00+00:00",
        language=Language.EN,
    )


def test_atomic_save_and_load_round_trip(tmp_path: Path) -> None:
    store = JsonConversationStore(tmp_path / "sessions")
    session = _make_session()
    store.save(session)

    loaded = store.load(session.session_id)
    assert loaded == session
    assert list((tmp_path / "sessions").glob("*.tmp")) == []


def test_missing_session_raises_not_found(tmp_path: Path) -> None:
    store = JsonConversationStore(tmp_path)
    with pytest.raises(SessionNotFoundError):
        store.load(uuid4())


def test_idempotency_replay_and_conflict() -> None:
    session = _make_session()
    digest = sha256_bytes(b"hello")
    turn = ConversationTurn(
        turn_id="t1",
        client_turn_id="req-1",
        payload_sha256=digest,
        created_at="2026-11-16T12:00:01+00:00",
        user_text="hello",
        reply_text="hi",
        language=Language.EN,
    )
    session.turns.append(turn)

    assert check_idempotency(session, "req-1", digest) == turn
    assert check_idempotency(session, "req-2", digest) is None
    with pytest.raises(IdempotencyConflictError):
        check_idempotency(session, "req-1", sha256_bytes(b"different"))


async def test_per_session_lock_serializes_concurrent_updates(tmp_path: Path) -> None:
    store = JsonConversationStore(tmp_path)
    session = _make_session()
    store.save(session)

    async def append_turn(idx: int) -> None:
        async with store.lock_for(session.session_id):
            cur = store.load(session.session_id)
            await asyncio.sleep(0.01)
            cur.turns.append(
                ConversationTurn(
                    turn_id=f"t{idx}",
                    client_turn_id=f"c{idx}",
                    payload_sha256=sha256_bytes(f"m{idx}".encode()),
                    created_at="2026-11-16T12:00:01+00:00",
                    user_text=f"msg {idx}",
                    reply_text=f"reply {idx}",
                    language=Language.EN,
                )
            )
            store.save(cur)

    await asyncio.gather(append_turn(1), append_turn(2), append_turn(3))
    final = store.load(session.session_id)
    assert len(final.turns) == 3
