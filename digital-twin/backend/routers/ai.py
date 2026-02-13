import json
import logging
import os
from typing import Any, Dict, List, Literal
from urllib import error, request

from fastapi import APIRouter
from pydantic import BaseModel, Field


router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты ИИ-помощник цифрового двойника города. "
    "Отвечай кратко, по делу, с практическими рекомендациями для трафика, экологии и логистики, как изменения в городской инфраструктуре могут повлиять на эти аспекты, например если закрыть дорогу на ремонт то трафик может вырасти на соседних улицах, экологическая нагрузка может снизиться, а логистика может потребовать перенастройки маршрутов. "
)


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"] = Field(..., description="Роль сообщения")
    content: str = Field(..., min_length=1, max_length=4000, description="Текст сообщения")


class AiPredictRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000, description="Запрос пользователя")
    history: List[AiChatMessage] = Field(default_factory=list, description="История диалога")
    context: Dict[str, Any] = Field(default_factory=dict, description="Контекст симуляции")


class AiPredictResponse(BaseModel):
    answer: str
    provider: str
    model: str
    fallback_used: bool = False


def build_local_fallback(prompt: str) -> str:
    text = prompt.lower()

    if "мост" in text or "bridge" in text:
        return (
            "При перекрытии моста нагрузка на объездные маршруты вырастет. "
            "Рекомендация: реверсивное движение и ограничение грузового потока в час пик."
        )

    if "трафик" in text or "traffic" in text or "пробк" in text:
        return (
            "Ожидается рост трафика на ключевых узлах в пиковые часы. "
            "Рекомендация: перенастроить светофоры и временно повысить приоритет общественного транспорта."
        )

    if "эколог" in text or "air" in text or "выброс" in text:
        return (
            "Экологическая нагрузка может вырасти без дополнительных мер. "
            "Рекомендация: ограничить транзит через перегруженные районы и усилить контроль на промзонах."
        )

    return (
        "Могу оценить влияние на трафик, экологию и логистику. "
        "Уточни сценарий: какой объект меняется и на какой срок."
    )


def get_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def call_xai(request_payload: AiPredictRequest) -> AiPredictResponse:
    api_key = os.getenv("XAI_API_KEY", "").strip()
    api_url = os.getenv("XAI_API_URL", "https://api.x.ai/v1/chat/completions").strip()
    model = os.getenv("XAI_MODEL", "grok-2-latest").strip() or "grok-2-latest"
    timeout_seconds = get_float_env("XAI_TIMEOUT_SECONDS", 25.0)
    temperature = get_float_env("XAI_TEMPERATURE", 0.3)

    if not api_key:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )

    messages: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if request_payload.context:
        context_json = json.dumps(request_payload.context, ensure_ascii=False)
        messages.append(
            {
                "role": "system",
                "content": f"Контекст симуляции (JSON): {context_json}",
            }
        )

    for message in request_payload.history[-8:]:
        messages.append({"role": message.role, "content": message.content})

    messages.append({"role": "user", "content": request_payload.prompt})

    body = {
        "model": model,
        "temperature": temperature,
        "messages": messages,
    }

    http_request = request.Request(
        api_url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with request.urlopen(http_request, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        logger.warning("xAI HTTP error: %s %s", exc.code, detail[:400])
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )
    except error.URLError as exc:
        logger.warning("xAI network error: %s", exc.reason)
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("xAI request failed: %s", exc)
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )

    content = (
        parsed.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not content:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt),
            provider="local",
            model="fallback",
            fallback_used=True,
        )

    return AiPredictResponse(
        answer=content,
        provider="xai",
        model=model,
        fallback_used=False,
    )


@router.post("/predict", response_model=AiPredictResponse)
def predict(payload: AiPredictRequest):
    return call_xai(payload)
