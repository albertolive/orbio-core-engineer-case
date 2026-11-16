from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import ValidationError

from support_agent.api import Settings, build_live_engine
from support_agent.domain import (
    ConversationSummary,
    EscalationReason,
    Language,
    LlmTurnOutput,
    Phase,
    ProblemCategory,
    UrgencyLevel,
    load_orders,
)
from support_agent.engine import ConversationEngine
from support_agent.rag import RagIndex, parse_kb_directory
from support_agent.store import JsonConversationStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _turn_out(**overrides: object) -> LlmTurnOutput:
    base: dict[str, object] = {
        "reply_text": "Tell me more so I can help.",
        "kb_answer": None,
        "language": Language.EN,
        "order_number": None,
        "problem_category": None,
        "problem_description": None,
        "urgency_level": None,
        "frustration_score": 15,
        "cited_kb_ids": [],
        "customer_confirmed": False,
        "customer_canceled": False,
        "requests_human": False,
    }
    base.update(overrides)
    return LlmTurnOutput.model_validate(base)


@dataclass(frozen=True)
class ScriptedStep:
    user_text: str
    mock_llm: LlmTurnOutput


@dataclass(frozen=True)
class EvalScenario:
    name: str
    initial_language: Language
    steps: list[ScriptedStep]
    expected_phase: Phase
    expected_order: str | None = None
    expected_escalation: EscalationReason | None = None
    expected_language: Language | None = None
    must_cite_prefix: str | None = None


SCENARIOS: list[EvalScenario] = [
    EvalScenario(
        name="happy_path_two_step_confirmation",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="Hi, my espresso machine from order ORD-48291 arrived with a cracked tank and leaks water. High urgency.",
                mock_llm=_turn_out(
                    order_number="ORD-48291",
                    problem_category=ProblemCategory.DAMAGED_ITEM,
                    problem_description="Espresso machine arrived with a cracked water tank and leaks.",
                    urgency_level=UrgencyLevel.HIGH,
                    frustration_score=25,
                ),
            ),
            ScriptedStep(
                user_text="Yes, please submit the ticket.",
                mock_llm=_turn_out(customer_confirmed=True, frustration_score=10),
            ),
        ],
        expected_phase=Phase.COMPLETED,
        expected_order="ORD-48291",
    ),
    EvalScenario(
        name="invalid_order_recovery_to_confirming",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="My order ORD-00000 has been delayed in shipping for days, medium urgency.",
                mock_llm=_turn_out(
                    order_number="ORD-00000",
                    problem_category=ProblemCategory.SHIPPING_DELAY,
                    problem_description="Package has been delayed in transit for days.",
                    urgency_level=UrgencyLevel.MEDIUM,
                    frustration_score=30,
                ),
            ),
            ScriptedStep(
                user_text="Sorry, I meant order five one nine zero four.",
                mock_llm=_turn_out(order_number="five one nine zero four", frustration_score=20),
            ),
        ],
        expected_phase=Phase.CONFIRMING,
        expected_order="ORD-51904",
    ),
    EvalScenario(
        name="question_during_confirming_stays_in_confirming",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="Order ORD-48291 arrived broken with a cracked lid, high urgency.",
                mock_llm=_turn_out(
                    order_number="ORD-48291",
                    problem_category=ProblemCategory.DAMAGED_ITEM,
                    problem_description="Arrived broken with a cracked lid.",
                    urgency_level=UrgencyLevel.HIGH,
                    frustration_score=20,
                ),
            ),
            ScriptedStep(
                user_text="Before I confirm, how fast do damaged item replacements ship?",
                mock_llm=_turn_out(
                    kb_answer="NovaMart ships a free express replacement within 48 hours.",
                    cited_kb_ids=["damaged_or_wrong_item#damaged-item-replacement-sla"],
                    frustration_score=15,
                ),
            ),
        ],
        expected_phase=Phase.CONFIRMING,
        expected_order="ORD-48291",
        must_cite_prefix="damaged_or_wrong_item#",
    ),
    EvalScenario(
        name="high_frustration_escalates_deterministically",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="This is completely unacceptable! My standing desk ORD-60372 arrived scratched everywhere and your service is a total disaster!",
                mock_llm=_turn_out(
                    order_number="ORD-60372",
                    problem_category=ProblemCategory.DAMAGED_ITEM,
                    problem_description="Standing desk arrived scratched.",
                    urgency_level=UrgencyLevel.HIGH,
                    frustration_score=88,
                ),
            ),
        ],
        expected_phase=Phase.ESCALATED,
        expected_order="ORD-60372",
        expected_escalation=EscalationReason.HIGH_FRUSTRATION,
    ),
    EvalScenario(
        name="firm_complaint_does_not_escalate",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="The delay is unacceptable, please check order ORD-51904.",
                mock_llm=_turn_out(
                    order_number="ORD-51904",
                    problem_category=ProblemCategory.SHIPPING_DELAY,
                    frustration_score=45,
                ),
            ),
        ],
        expected_phase=Phase.COLLECTING,
        expected_order="ORD-51904",
    ),
    EvalScenario(
        name="order_cancellation_request_does_not_abort_session",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="I want to cancel my order ORD-51904.",
                mock_llm=_turn_out(
                    order_number="ORD-51904",
                    problem_category=ProblemCategory.RETURN_REFUND,
                    customer_canceled=True,
                ),
            ),
        ],
        expected_phase=Phase.COLLECTING,
        expected_order="ORD-51904",
    ),
    EvalScenario(
        name="catalan_switch_and_sticky_short_reply",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="Bon dia, tinc un problema amb la meva comanda ORD-77418 perquè els auriculars no carreguen.",
                mock_llm=_turn_out(
                    reply_text="Entesos, quina urgència té aquest cas?",
                    language=Language.CA,
                    order_number="ORD-77418",
                    problem_category=ProblemCategory.DAMAGED_ITEM,
                    problem_description="Els auriculars sense fils no carreguen.",
                    frustration_score=20,
                ),
            ),
            ScriptedStep(
                user_text="Urgència mitjana",
                mock_llm=_turn_out(
                    reply_text="Perfecte.",
                    language=Language.ES,
                    urgency_level=UrgencyLevel.MEDIUM,
                    frustration_score=10,
                ),
            ),
        ],
        expected_phase=Phase.CONFIRMING,
        expected_order="ORD-77418",
        expected_language=Language.CA,
    ),
    EvalScenario(
        name="customer_cancels_during_confirming",
        initial_language=Language.EN,
        steps=[
            ScriptedStep(
                user_text="My monitor stand on order ORD-93015 is missing a bolt, low urgency.",
                mock_llm=_turn_out(
                    order_number="ORD-93015",
                    problem_category=ProblemCategory.DAMAGED_ITEM,
                    problem_description="Monitor arm is missing a mounting bolt.",
                    urgency_level=UrgencyLevel.LOW,
                ),
            ),
            ScriptedStep(
                user_text="Actually no, cancel the ticket, I just found the bolt in the box.",
                mock_llm=_turn_out(customer_canceled=True),
            ),
        ],
        expected_phase=Phase.CANCELED,
        expected_order="ORD-93015",
    ),
]


def _assert_scenario_outcome(session: object, scenario: EvalScenario) -> None:
    from support_agent.domain import ConversationSession

    assert isinstance(session, ConversationSession)
    assert session.phase == scenario.expected_phase
    if scenario.expected_order is not None:
        assert session.draft.order_number == scenario.expected_order
    if scenario.expected_escalation is not None:
        assert session.escalation_reason == scenario.expected_escalation
    if scenario.expected_language is not None:
        assert session.language == scenario.expected_language
    if scenario.must_cite_prefix is not None:
        assert any(
            cid.startswith(scenario.must_cite_prefix) for cid in session.turns[-1].cited_kb_ids
        )


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
async def test_offline_eval_scenarios(scenario: EvalScenario, tmp_path: Path) -> None:
    orders = load_orders(DATA_DIR / "orders.json")
    chunks = parse_kb_directory(DATA_DIR / "kb")

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [[1.0 if "48 hours" in t or "damaged" in t.lower() else 0.2, 0.5] for t in texts]

    step_iter = iter(scenario.steps)

    async def fake_parse(_prompt: str) -> tuple[LlmTurnOutput | None, int, int, str | None]:
        return next(step_iter).mock_llm, 90, 30, None

    async def fake_sum(_sess: object) -> ConversationSummary | None:
        return None

    async def unused_stt(_f: str, _b: bytes, _m: str) -> str:
        return ""

    async def unused_tts(_t: str, _l: Language) -> tuple[bytes | None, str, str | None]:
        return None, "browser_speech_synthesis", "test"

    engine = ConversationEngine(
        store=JsonConversationStore(tmp_path / "sessions"),
        rag=RagIndex(chunks, fake_embed),
        orders=orders,
        parse_turn_fn=fake_parse,
        summarize_fn=fake_sum,
        transcribe_fn=unused_stt,
        synthesize_fn=unused_tts,
    )
    session = engine.start_session(scenario.initial_language)
    for idx, step in enumerate(scenario.steps):
        session = await engine.handle_text(
            session.session_id,
            client_turn_id=f"c-{idx}",
            text=step.user_text,
        )
    _assert_scenario_outcome(session, scenario)


def _load_live_settings() -> Settings:
    try:
        settings = Settings()
    except ValidationError:
        pytest.skip("OPENAI_API_KEY not configured for live eval")
    if not settings.openai_api_key.get_secret_value().strip():
        pytest.skip("OPENAI_API_KEY is empty")
    return settings


@pytest.mark.live
@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
async def test_live_scenarios_table(scenario: EvalScenario, tmp_path: Path) -> None:
    settings = _load_live_settings()
    oa_client = AsyncOpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        max_retries=1,
        timeout=15.0,
    )
    async with httpx.AsyncClient(timeout=12.0) as http_client:
        try:
            engine = await build_live_engine(
                settings, oa_client, http_client, sessions_dir=tmp_path / "sessions"
            )
            session = engine.start_session(scenario.initial_language)
            for idx, step in enumerate(scenario.steps):
                session = await engine.handle_text(
                    session.session_id,
                    client_turn_id=f"live-{idx}",
                    text=step.user_text,
                )
            _assert_scenario_outcome(session, scenario)
        finally:
            await oa_client.close()


@pytest.mark.live
async def test_live_multilingual_rag_grounding_en_es_ca(tmp_path: Path) -> None:
    settings = _load_live_settings()
    oa_client = AsyncOpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        max_retries=1,
        timeout=15.0,
    )
    async with httpx.AsyncClient(timeout=12.0) as http_client:
        try:
            engine = await build_live_engine(
                settings, oa_client, http_client, sessions_dir=tmp_path / "sessions"
            )
            cases: list[tuple[Language, str, str, tuple[str, ...], tuple[str, ...]]] = [
                (
                    Language.EN,
                    "Warranty on headphones?",
                    "warranty_and_repairs#",
                    ("2", "two"),
                    ("warranty", "covered"),
                ),
                (
                    Language.ES,
                    "Hola, ¿cuál es el plazo de devolución estándar en NovaMart?",
                    "returns_and_refunds#",
                    ("30", "treinta"),
                    ("días", "devolución", "devolverse"),
                ),
                (
                    Language.CA,
                    "Bon dia, quina garantia tenen els productes electrònics a NovaMart?",
                    "warranty_and_repairs#",
                    ("2", "dos", "dues"),
                    ("anys", "garantia"),
                ),
            ]
            for lang, prompt_text, expected_prefix, expected_tokens, lang_markers in cases:
                s = engine.start_session(lang)
                s = await engine.handle_text(s.session_id, client_turn_id="q1", text=prompt_text)
                last = s.turns[-1]
                assert any(cid.startswith(expected_prefix) for cid in last.cited_kb_ids), (
                    f"{lang}: expected {expected_prefix}, got {last.cited_kb_ids}"
                )
                low = last.reply_text.lower()
                assert any(tok in low for tok in expected_tokens), (
                    f"{lang}: expected one of {expected_tokens} in {last.reply_text!r}"
                )
                assert any(m in low for m in lang_markers), (
                    f"{lang}: expected language marker {lang_markers!r} in {last.reply_text!r}"
                )
        finally:
            await oa_client.close()
