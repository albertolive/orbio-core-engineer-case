from __future__ import annotations

from pathlib import Path

from support_agent.rag import RagIndex, parse_kb_directory

KB_DIR = Path(__file__).resolve().parents[1] / "data" / "kb"


def test_parse_kb_directory_extracts_sections() -> None:
    chunks = parse_kb_directory(KB_DIR)
    ids = {c.chunk_id for c in chunks}
    assert len(chunks) >= 12
    assert "returns_and_refunds#return-window" in ids
    assert "damaged_or_wrong_item#damaged-item-replacement-sla" in ids


async def test_rag_skips_short_queries_and_ranks_by_cosine() -> None:
    chunks = parse_kb_directory(KB_DIR)
    calls: list[list[str]] = []

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        calls.append(texts)
        out: list[list[float]] = []
        for t in texts:
            low = t.lower()
            out.append(
                [
                    1.0 if "30 calendar" in low else 0.05,
                    1.0 if "3 to 5 business" in low else 0.05,
                    1.0 if "preference" in low or "4.90" in low else 0.05,
                ]
            )
        return out

    index = RagIndex(chunks, fake_embed)
    assert await index.warm() is True
    assert len(calls) == 1

    assert await index.retrieve("yes ORD-48291") == []
    assert len(calls) == 1

    short_q_hits = await index.retrieve("Preference return?")
    assert len(short_q_hits) >= 1
    assert len(calls) == 2

    hits = await index.retrieve("What is the fee for a preference return?")
    assert len(hits) >= 1
    assert hits[0].chunk_id == "returns_and_refunds#return-shipping-fees"


async def test_rag_survives_startup_failure_and_recovers_lazily() -> None:
    chunks = parse_kb_directory(KB_DIR)[:2]
    should_fail = True

    async def flaky_embed(texts: list[str]) -> list[list[float]]:
        if should_fail:
            raise RuntimeError("transient 503")
        return [[1.0, 0.5] for _ in texts]

    index = RagIndex(chunks, flaky_embed)
    assert await index.warm() is False
    assert await index.retrieve("How long does a refund take to arrive?") == []

    should_fail = False
    hits = await index.retrieve("How long does a refund take to arrive?")
    assert len(hits) == 2
