import json
import logging
import os
from typing import Any, Dict, List, Literal, Optional
from urllib import error, request

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .objects import get_storage
from .simulation import analyze_city_state, build_transport_snapshot

router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты ИИ-помощник цифрового двойника города. "
    "Отвечай на русском языке, кратко и практично. "
    "Структура ответа: Прогноз, Риски, Действия (3 конкретных шага). "
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
    storage = get_storage()
    vehicles = storage.get("vehicles", [])
    delivery_points = storage.get("delivery_points", [])

    bridge_id = None
    if isinstance(client_context.get("bridge_id"), str):
        bridge_id = client_context["bridge_id"]

    transport_snapshot = build_transport_snapshot(bridge_id=bridge_id)
    city_metrics = analyze_city_state(vehicles, delivery_points)

    return {
        "runtime": {
            "vehicles_count": len(vehicles),
            "delivery_points_count": len(delivery_points),
        },
        "transport_overview": transport_snapshot,
        "city_metrics": city_metrics,
        "client_context": client_context,
    }


def build_local_fallback(prompt: str, context: Dict[str, Any]) -> str:
    text = str(prompt or "").lower()
    transport = context.get("transport_overview", {})
    city = context.get("city_metrics", {})

    flow = transport.get("base_flow_vehicles_per_hour")
    detour = transport.get("detour_increase_percent")
    ecology = city.get("ecology")
    traffic = city.get("traffic_load")

    if "мост" in text or "bridge" in text:
        if flow is not None and detour is not None:
            return (
                f"Прогноз: поток около {flow} авто/ч, при ограничениях рост нагрузки на объезды ~{detour}%. "
                "Риски: локальные заторы и задержки доставки. "
                "Действия: реверсивное движение, временные окна для грузовиков, ручная перенастройка светофоров."
            )
        return (
            "Прогноз: при перекрытии моста трафик сместится на объездные маршруты. "
            "Риски: рост времени в пути и перегрузка соседних улиц. "
            "Действия: реверсивное движение, ограничение грузового потока в пик, приоритет ОТ."
        )

    if "трафик" in text or "traffic" in text or "пробк" in text:
        if traffic is not None:
            return (
                f"Прогноз: текущая нагрузка около {traffic}%. "
                "Риски: ухудшение пропускной способности на магистралях в часы пик. "
                "Действия: адаптивные циклы светофоров, приоритет ОТ, распределение рейсов вне пика."
            )
        return (
            "Прогноз: трафик вырастет на ключевых узлах в пиковые часы. "
            "Риски: задержки в доставке и перерасход топлива. "
            "Действия: адаптивные светофоры, выделение коридоров, сдвиг части рейсов вне пика."
        )

    if "эколог" in text or "air" in text or "выброс" in text:
        if ecology is not None:
            return (
                f"Прогноз: индекс экологии сейчас около {ecology}. "
                "Риски: локальные превышения загрязнения в перегруженных зонах. "
                "Действия: ограничение транзита через жилые кварталы, мониторинг промзон, перераспределение потоков."
            )
        return (
            "Прогноз: без допмер экологическая нагрузка может вырасти. "
            "Риски: рост выбросов в районах с плотным трафиком. "
            "Действия: ограничить транзит, усилить контроль промзон, перераспределить маршруты."
        )

    return (
        "Прогноз: при текущей конфигурации узкие места связаны с транспортной нагрузкой. "
        "Риски: рост времени доставки и локальные перегрузки сети. "
        "Действия: уточни объект/район/горизонт расчета, затем я дам численный план с приоритетами."
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
