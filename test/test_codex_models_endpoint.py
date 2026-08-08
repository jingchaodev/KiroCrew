"""Regression coverage for the Codex ACP model picker.

The Codex backend advertises one legacy ACP model id per reasoning effort
(``gpt-5.6-sol[low]``, ``gpt-5.6-sol[high]``, ...), but Kiro Crew switches the
model and effort through separate ``session/set_config_option`` calls.  The
dashboard endpoint must therefore expose deduplicated base model ids and must
never fall through to ``kiro-cli --list-models`` when Codex is selected.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from kiro_crew.dashboard.handlers import agents


class _CodexProvider:
    def available_models(self) -> list[dict[str, str]]:
        return [
            {
                "modelId": "gpt-5.6-sol[low]",
                "name": "GPT-5.6-Sol (low)",
                "description": "Frontier model. Fast responses with lighter reasoning",
            },
            {
                "modelId": "gpt-5.6-sol[high]",
                "name": "GPT-5.6-Sol (high)",
                "description": "Frontier model. Greater reasoning depth",
            },
            {
                "modelId": "gpt-5.6-terra[medium]",
                "name": "GPT-5.6-Terra (medium)",
                "description": "Balanced model. Everyday reasoning",
            },
        ]


def _request(providers: list[object]) -> MagicMock:
    sessions = SimpleNamespace(active_providers=lambda: providers)
    request = MagicMock()
    request.app = {"state": SimpleNamespace(sessions=sessions)}
    return request


def _cfg() -> SimpleNamespace:
    return SimpleNamespace(agent=SimpleNamespace(provider="codex_acp", model="auto"))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_codex_models_use_live_acp_list_without_kiro_cli() -> None:
    request = _request([_CodexProvider()])
    with (
        patch.object(agents.KiroCrewConfig, "load", return_value=_cfg()),
        patch.object(
            agents,
            "reject_if_kiro_unverified",
            side_effect=AssertionError(
                "Codex model discovery must not enter the Kiro readiness gate"
            ),
        ),
    ):
        response = _run(agents.api_models(request))

    assert response.status == 200
    rows = json.loads(response.body)
    assert [row["model_name"] for row in rows] == [
        "auto",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
    ]
    assert rows[1]["context_window"] == 272_000


def test_codex_models_return_503_until_a_session_advertises_entitlements() -> None:
    request = _request([])
    with (
        patch.object(agents.KiroCrewConfig, "load", return_value=_cfg()),
        patch.object(
            agents,
            "reject_if_kiro_unverified",
            side_effect=AssertionError(
                "Codex model discovery must not enter the Kiro readiness gate"
            ),
        ),
    ):
        response = _run(agents.api_models(request))

    assert response.status == 503
    assert json.loads(response.body) == {
        "error": "codex model list not ready",
        "code": "codex_models_not_ready",
    }
