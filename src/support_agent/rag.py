from __future__ import annotations

import asyncio
import logging
import math
import re
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path

from support_agent.domain import KbChunk, RetrievedChunk

logger = logging.getLogger(__name__)

type EmbedFn = Callable[[list[str]], Awaitable[list[list[float]]]]


def _should_retrieve(query: str) -> bool:
    return len(query.split()) >= 3 or "?" in query


def _slugify(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug or "section"


def parse_kb_directory(kb_dir: Path) -> list[KbChunk]:
    chunks: list[KbChunk] = []
    for path in sorted(kb_dir.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        parts = re.split(r"(?m)^##\s+", raw)
        for section in parts[1:]:
            lines = section.strip().splitlines()
            if not lines:
                continue
            title = lines[0].strip()
            body = " ".join(line.strip() for line in lines[1:] if line.strip())
            if not body:
                continue
            chunks.append(
                KbChunk(
                    chunk_id=f"{path.stem}#{_slugify(title)}",
                    title=title,
                    content=body,
                )
            )
    return chunks


def _cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=True))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class RagIndex:
    def __init__(self, chunks: Sequence[KbChunk], embed_fn: EmbedFn) -> None:
        self._chunks = list(chunks)
        self._embed_fn = embed_fn
        self._vectors: list[list[float]] | None = None
        self._warm_lock = asyncio.Lock()

    async def warm(self) -> bool:
        if not self._chunks:
            self._vectors = []
            return True
        async with self._warm_lock:
            if self._vectors is not None:
                return True
            try:
                texts = [f"{c.title}\n{c.content}" for c in self._chunks]
                vectors = await self._embed_fn(texts)
                if len(vectors) != len(self._chunks):
                    logger.warning("KB embedding count mismatch; leaving index cold")
                    return False
                self._vectors = vectors
                return True
            except Exception as exc:
                logger.warning(
                    "KB embedding warm failed (%s); will retry lazily",
                    exc.__class__.__name__,
                )
                return False

    async def retrieve(
        self, query: str, *, top_k: int = 3, min_score: float = 0.40
    ) -> list[RetrievedChunk]:
        if not self._chunks or not _should_retrieve(query):
            return []
        if self._vectors is None and not await self.warm():
            return []
        assert self._vectors is not None
        try:
            query_vecs = await self._embed_fn([query])
        except Exception as exc:
            logger.warning(
                "KB query embedding failed (%s); continuing without RAG",
                exc.__class__.__name__,
            )
            return []
        if not query_vecs:
            return []
        q_vec = query_vecs[0]
        scored = [
            RetrievedChunk(
                chunk_id=chunk.chunk_id,
                title=chunk.title,
                content=chunk.content,
                score=round(_cosine_similarity(q_vec, doc_vec), 4),
            )
            for chunk, doc_vec in zip(self._chunks, self._vectors, strict=True)
        ]
        scored.sort(key=lambda item: item.score, reverse=True)
        return [item for item in scored[:top_k] if item.score >= min_score]
