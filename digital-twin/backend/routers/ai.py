import json
import logging
import os
from typing import Any, Dict, List, Literal, Optional
from urllib import error, request

from fastapi import APIRouter
from pydantic import BaseModel, Field


router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты ИИ-помощник цифрового двойника города. "
    "Отвечай на русском языке, кратко и практично. "
    "Структура ответа: Прогноз, Риски, Действия (3 конкретных шага). Не в одну строчку а со структурой."
    "Если в контексте есть числа по трафику/экологии/логистике, обязательно используй их."
)


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"] = Field(..., description="Роль сообщения")
    content: str = Field(..., min_length=1, max_length=4000, description="Текст сообщения")


class AiPredictRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000, description="Запрос пользователя")
    history: List[AiChatMessage] = Field(default_factory=list, description="История диалога")
    context: Dict[str, Any] = Field(default_factory=dict, description="Контекст от клиента")


class AiPredictResponse(BaseModel):
    answer: str
    provider: str
    model: str
    fallback_used: bool = False
    context_used: Dict[str, Any] = Field(default_factory=dict)


def get_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def get_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def build_runtime_context(client_context: Dict[str, Any]) -> Dict[str, Any]:
    """Build context from client-provided data (2GIS map data, user selections, etc.)"""
    return {
        "client_context": client_context,
    }


def build_local_fallback(prompt: str, context: Dict[str, Any]) -> str:
    """Simple fallback response when xAI API is unavailable"""
    text = str(prompt or "").lower()
    client_context = context.get("client_context", {})

    # Basic responses based on common queries
    if "мост" in text or "bridge" in text:
        return (
            "Прогноз: при перекрытии моста трафик сместится на объездные маршруты. "
            "Риски: рост времени в пути и перегрузка соседних улиц. "
            "Действия: реверсивное движение, ограничение грузового потока в пик, приоритет ОТ."
        )

    if "трафик" in text or "traffic" in text or "пробк" in text:
        return (
            "Прогноз: трафик может вырасти на ключевых узлах в пиковые часы. "
            "Риски: задержки и перерасход топлива. "
            "Действия: адаптивные светофоры, выделение коридоров, оптимизация маршрутов."
        )

    if "эколог" in text or "air" in text or "выброс" in text:
        return (
            "Прогноз: экологическая нагрузка зависит от транспортного потока. "
            "Риски: рост выбросов в районах с плотным трафиком. "
            "Действия: ограничить транзит через жилые зоны, контроль промзон, перераспределение потоков."
        )

    return (
        "Я помогу проанализировать городскую инфраструктуру. "
        "Уточни объект/район/параметр для детального анализа."
    )


def extract_content(payload: Dict[str, Any]) -> Optional[str]:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    message = choices[0].get("message", {})
    raw_content = message.get("content")

    if isinstance(raw_content, str):
        content = raw_content.strip()
        return content or None

    if isinstance(raw_content, list):
        text_parts = []
        for item in raw_content:
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
                text_parts.append(item["text"])
        content = "\n".join(text_parts).strip()
        return content or None

    return None


def call_xai(request_payload: AiPredictRequest) -> AiPredictResponse:
    context_used = build_runtime_context(request_payload.context or {})

    api_key = os.getenv("XAI_API_KEY", "").strip()
    api_url = os.getenv("XAI_API_URL", "https://api.x.ai/v1/chat/completions").strip()
    model = os.getenv("XAI_MODEL", "grok-2-latest").strip() or "grok-2-latest"
    timeout_seconds = get_float_env("XAI_TIMEOUT_SECONDS", 25.0)
    temperature = get_float_env("XAI_TEMPERATURE", 0.25)
    max_tokens = get_int_env("XAI_MAX_TOKENS", 700)

    if not api_key:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )

    messages: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append(
        {
            "role": "system",
            "content": f"Контекст (JSON): {json.dumps(context_used, ensure_ascii=False)}",
        }
    )

    for message in request_payload.history[-8:]:
        messages.append({"role": message.role, "content": message.content})
    messages.append({"role": "user", "content": request_payload.prompt})

    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
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
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )
    except error.URLError as exc:
        logger.warning("xAI network error: %s", exc.reason)
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("xAI request failed: %s", exc)
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )

    content = extract_content(parsed)
    if not content:
        return AiPredictResponse(
            answer=build_local_fallback(request_payload.prompt, context_used),
            provider="local",
            model="fallback",
            fallback_used=True,
            context_used=context_used,
        )

    return AiPredictResponse(
        answer=content,
        provider="xai",
        model=model,
        fallback_used=False,
        context_used=context_used,
    )


@router.post("/predict", response_model=AiPredictResponse)
def predict(payload: AiPredictRequest):
    return call_xai(payload)
