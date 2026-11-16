from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from openai.lib._pydantic import to_strict_json_schema

from support_agent.domain import (
    ConversationSession,
    EscalationReason,
    Language,
    LlmSummaryOutput,
    LlmTurnOutput,
    OrderInfo,
    Phase,
    ProblemCategory,
    RetrievedChunk,
    TicketDraft,
    TurnMetrics,
    UrgencyLevel,
    apply_turn,
    build_prompt,
    fallback_summary,
    load_orders,
    normalize_order_code,
    strip_questions,
)

ORDERS_PATH = Path(__file__).resolve().parents[1] / "data" / "orders.json"


@pytest.fixture
def orders() -> dict[str, OrderInfo]:
    return load_orders(ORDERS_PATH)


def _new_session(lang: Language = Language.EN) -> ConversationSession:
    return ConversationSession(
        session_id=uuid4(),
        created_at="2026-11-16T12:00:00+00:00",
        updated_at="2026-11-16T12:00:00+00:00",
        language=lang,
    )


def _llm_out(**overrides: object) -> LlmTurnOutput:
    base: dict[str, object] = {
        "reply_text": "What seems to be the issue with that order?",
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


def test_strict_json_schemas_have_closed_objects() -> None:
    for cls in (LlmTurnOutput, LlmSummaryOutput):
        schema = to_strict_json_schema(cls)
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ORD-48291", "ORD-48291"),
        ("ord 48 291", "ORD-48291"),
        ("pedido número 48291", "ORD-48291"),
        ("my order is 48291", "ORD-48291"),
        ("O R D dash four eight two nine one", "ORD-48291"),
        ("pedido cuatro ocho dos nueve uno", "ORD-48291"),
        ("comanda quatre vuit dos nou u", "ORD-48291"),
        ("comanda quatre vuit dos nou un", "ORD-48291"),
        ("48291", "ORD-48291"),
        ("123", None),
        ("123456", None),
    ],
)
def test_normalize_order_code(raw: str, expected: str | None) -> None:
    assert normalize_order_code(raw) == expected


def test_session_phase_invariants() -> None:
    with pytest.raises(ValueError, match="validated_ticket"):
        ConversationSession(
            session_id=uuid4(),
            created_at="2026-11-16T12:00:00+00:00",
            updated_at="2026-11-16T12:00:00+00:00",
            phase=Phase.COMPLETED,
        )


def test_collecting_preserves_kb_answer_and_strips_trailing_questions(
    orders: dict[str, OrderInfo],
) -> None:
    chunk = RetrievedChunk(
        chunk_id="returns#window",
        title="Return window",
        content="Returns are accepted within 30 days of delivery.",
        score=0.82,
    )
    session = _new_session()
    updated = apply_turn(
        session,
        "What is your return window? My order is ORD-48291",
        _llm_out(
            order_number="o r d 48 291",
            kb_answer="We accept returns within 30 days of delivery. Would you like to start one?",
            cited_kb_ids=["returns#window", "hallucinated#id"],
            reply_text="Tell me what went wrong and how urgent this is.",
        ),
        [chunk],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    assert updated.phase == Phase.COLLECTING
    assert updated.draft.order_number == "ORD-48291"
    assert updated.turns[-1].cited_kb_ids == ["returns#window"]
    assert "We accept returns within 30 days of delivery." in updated.turns[-1].reply_text
    assert "Would you like to start one?" not in updated.turns[-1].reply_text
    assert "Tell me what went wrong" in updated.turns[-1].reply_text


def test_two_step_confirmation_ignores_paraphrased_description_and_beats_high_frustration(
    orders: dict[str, OrderInfo],
) -> None:
    session = _new_session()
    s1 = apply_turn(
        session,
        "Order ORD-48291 arrived with a cracked water tank, high urgency.",
        _llm_out(
            order_number="ORD-48291",
            problem_category=ProblemCategory.DAMAGED_ITEM,
            problem_description="Espresso machine arrived with a cracked water tank.",
            urgency_level=UrgencyLevel.HIGH,
            customer_confirmed=True,
        ),
        [],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    assert s1.phase == Phase.CONFIRMING
    assert s1.validated_ticket is None

    chunk = RetrievedChunk(
        chunk_id="damaged#sla",
        title="Damaged replacements",
        content="Damaged items ship a free replacement within 48 hours.",
        score=0.79,
    )
    s2 = apply_turn(
        s1,
        "Wait, how fast do replacements ship?",
        _llm_out(
            kb_answer="Damaged items ship a free replacement within 48 hours.",
            cited_kb_ids=["damaged#sla"],
            customer_confirmed=False,
        ),
        [chunk],
        orders,
        turn_id="t2",
        client_turn_id="c2",
        payload_sha256="h2",
        metrics=TurnMetrics(),
    )
    assert s2.phase == Phase.CONFIRMING
    assert "48 hours" in s2.turns[-1].reply_text
    assert "Say yes to submit" in s2.turns[-1].reply_text

    s3 = apply_turn(
        s2,
        "Yes, submit it please.",
        _llm_out(
            problem_description="Water tank was cracked on arrival.",
            customer_confirmed=True,
            frustration_score=85,
        ),
        [],
        orders,
        turn_id="t3",
        client_turn_id="c3",
        payload_sha256="h3",
        metrics=TurnMetrics(),
    )
    assert s3.phase == Phase.COMPLETED
    assert s3.validated_ticket is not None
    assert s3.validated_ticket.order_number == "ORD-48291"
    assert s3.draft.problem_description == "Espresso machine arrived with a cracked water tank."


def test_first_turn_spanish_escalation_switches_language_and_keeps_slots(
    orders: dict[str, OrderInfo],
) -> None:
    session = _new_session(Language.EN)
    updated = apply_turn(
        session,
        "Quiero hablar con una persona ahora por el pedido ORD-51904",
        _llm_out(
            language=Language.ES,
            order_number="ORD-51904",
            requests_human=True,
            frustration_score=90,
        ),
        [],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    assert updated.phase == Phase.ESCALATED
    assert updated.escalation_reason == EscalationReason.USER_REQUESTED
    assert updated.language == Language.ES
    assert updated.draft.order_number == "ORD-51904"
    assert "especialista humano" in updated.turns[-1].reply_text


def test_field_error_clears_next_turn_and_yes_with_edit_reconfirms_or_cancels(
    orders: dict[str, OrderInfo],
) -> None:
    s1 = apply_turn(
        _new_session(),
        "Order ORD-48291 arrived with a cracked water tank, high urgency.",
        _llm_out(
            order_number="ORD-48291",
            problem_category=ProblemCategory.DAMAGED_ITEM,
            problem_description="Espresso machine arrived with a cracked water tank.",
            urgency_level=UrgencyLevel.HIGH,
        ),
        [],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    assert s1.phase == Phase.CONFIRMING

    s2 = apply_turn(
        s1,
        "Wait, maybe it was ORD-99999?",
        _llm_out(order_number="ORD-99999"),
        [],
        orders,
        turn_id="t2",
        client_turn_id="c2",
        payload_sha256="h2",
        metrics=TurnMetrics(),
    )
    assert s2.phase == Phase.COLLECTING
    assert "order_number" in s2.draft.field_errors

    s3 = apply_turn(
        s2,
        "Never mind, keep ORD-48291.",
        _llm_out(),
        [],
        orders,
        turn_id="t3",
        client_turn_id="c3",
        payload_sha256="h3",
        metrics=TurnMetrics(),
    )
    assert s3.phase == Phase.CONFIRMING
    assert s3.draft.field_errors == {}

    s4 = apply_turn(
        s3,
        "Yes, and the wand is bent.",
        _llm_out(
            problem_description="Espresso machine arrived with a cracked tank and bent steam wand.",
            customer_confirmed=True,
        ),
        [],
        orders,
        turn_id="t4",
        client_turn_id="c4",
        payload_sha256="h4",
        metrics=TurnMetrics(),
    )
    assert s4.phase == Phase.CONFIRMING
    assert "bent steam wand" in (s4.draft.problem_description or "")

    s_cancel = apply_turn(
        s4,
        "Actually no, cancel the ticket.",
        _llm_out(customer_canceled=True),
        [],
        orders,
        turn_id="t5",
        client_turn_id="c5",
        payload_sha256="h5",
        metrics=TurnMetrics(),
    )
    assert s_cancel.phase == Phase.CANCELED
    assert s_cancel.validated_ticket is None
    assert "no ticket was created" in s_cancel.turns[-1].reply_text

    s_done = apply_turn(
        s4,
        "Yes, submit it.",
        _llm_out(customer_confirmed=True),
        [],
        orders,
        turn_id="t5b",
        client_turn_id="c5b",
        payload_sha256="h5b",
        metrics=TurnMetrics(),
    )
    assert s_done.phase == Phase.COMPLETED
    assert s_done.validated_ticket is not None


def test_sustained_frustration_60_twice_and_collecting_cancel_guard(
    orders: dict[str, OrderInfo],
) -> None:
    s0 = _new_session()
    s_order_cancel = apply_turn(
        s0,
        "I want to cancel my order ORD-51904",
        _llm_out(order_number="ORD-51904", customer_canceled=True, frustration_score=62),
        [],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    assert s_order_cancel.phase == Phase.COLLECTING
    assert s_order_cancel.draft.order_number == "ORD-51904"

    s_escalated = apply_turn(
        s_order_cancel,
        "Still waiting on this mess and getting really annoyed",
        _llm_out(frustration_score=62),
        [],
        orders,
        turn_id="t2",
        client_turn_id="c2",
        payload_sha256="h2",
        metrics=TurnMetrics(),
    )
    assert s_escalated.phase == Phase.ESCALATED
    assert s_escalated.escalation_reason == EscalationReason.HIGH_FRUSTRATION


def test_sticky_language_ignores_short_ambiguous_replies(orders: dict[str, OrderInfo]) -> None:
    session = _new_session(Language.ES)
    s1 = apply_turn(
        session,
        "Hola necesito ayuda con mi pedido",
        _llm_out(language=Language.ES, reply_text="Claro, dime el codigo."),
        [],
        orders,
        turn_id="t1",
        client_turn_id="c1",
        payload_sha256="h1",
        metrics=TurnMetrics(),
    )
    s2 = apply_turn(
        s1,
        "Si, ORD-48291",
        _llm_out(language=Language.CA, order_number="ORD-48291"),
        [],
        orders,
        turn_id="t2",
        client_turn_id="c2",
        payload_sha256="h2",
        metrics=TurnMetrics(),
    )
    assert s2.language == Language.ES


def test_invalid_order_resets_before_third_strike_and_escalates_on_third(
    orders: dict[str, OrderInfo],
) -> None:
    s = _new_session()
    for i in range(2):
        s = apply_turn(
            s,
            f"ORD-0000{i}",
            _llm_out(order_number=f"ORD-0000{i}"),
            [],
            orders,
            turn_id=f"t{i}",
            client_turn_id=f"c{i}",
            payload_sha256=f"h{i}",
            metrics=TurnMetrics(),
        )
    assert s.phase == Phase.COLLECTING
    assert s.invalid_order_attempts == 2

    s_valid = apply_turn(
        s,
        "Sorry, it is ORD-48291",
        _llm_out(order_number="ORD-48291"),
        [],
        orders,
        turn_id="t_ok",
        client_turn_id="c_ok",
        payload_sha256="h_ok",
        metrics=TurnMetrics(),
    )
    assert s_valid.invalid_order_attempts == 0
    assert s_valid.phase == Phase.COLLECTING

    s_third = apply_turn(
        s,
        "ORD-99999",
        _llm_out(order_number="ORD-99999"),
        [],
        orders,
        turn_id="t3",
        client_turn_id="c3",
        payload_sha256="h3",
        metrics=TurnMetrics(),
    )
    assert s_third.phase == Phase.ESCALATED
    assert s_third.escalation_reason == EscalationReason.REPEATED_INVALID_ORDER


def test_build_prompt_and_fallback_summary(orders: dict[str, OrderInfo]) -> None:
    s = _new_session()
    s.draft = TicketDraft(order_number="ORD-48291")
    prompt = build_prompt(s, "My espresso machine is leaking", [], orders)
    assert "Barista Pro Espresso Machine" in prompt
    assert "Missing slots: problem_category, problem_description, urgency_level" in prompt
    assert "<user_message>\nMy espresso machine is leaking\n</user_message>" in prompt

    summary = fallback_summary(s)
    assert summary.generated_by == "fallback"
    assert "Order: ORD-48291" in summary.key_points
    assert strip_questions("Returns take 5 days. Need anything else?") == "Returns take 5 days."
