"""
SafeSync Backend — CLOVA Studio API 연동 서비스
NCP CLOVA Studio HyperCLOVA X(HCX-003) 모델을 사용한 재난 행동 요령 생성
공식 문서: https://api.ncloud-docs.com/docs/ai-naver-clovastudio-chatcompletions
"""
import httpx
import json
from typing import List, Optional
from datetime import datetime
from config import get_settings

settings = get_settings()


# ── 시스템 프롬프트 ──
SYSTEM_PROMPT = """당신은 국가 재난안전 전문가입니다.
사용자가 설명하는 재난 상황을 분석하고, 
즉시 실행 가능한 행동 요령을 5~7단계로 명확하게 제시하세요.

규칙:
1. 각 단계는 간결하고 구체적으로 작성하세요 (1~2문장).
2. 반드시 행동 가능한 동사로 시작하세요 (예: "즉시 ~하십시오", "~를 피하십시오").
3. 전문 용어보다 일반 시민이 이해할 수 있는 표현을 사용하세요.
4. 가장 긴급하고 중요한 행동부터 순서대로 나열하세요.
5. 응답은 번호 매긴 목록 형태로만 제공하세요."""


class ClovaStudioService:
    """CLOVA Studio API 클라이언트"""

    BASE_URL = "https://clovastudio.stream.ntruss.com"
    CHAT_API = "/testapp/v1/chat-completions/HCX-003"

    def __init__(self):
        self.api_key    = settings.clova_studio_api_key
        self.request_id = settings.clova_studio_request_id
        self.enabled    = bool(self.api_key)

    def _get_headers(self) -> dict:
        return {
            "X-NCP-CLOVASTUDIO-API-KEY":        self.api_key,
            "X-NCP-APIGW-API-KEY":              self.api_key,
            "X-NCP-CLOVASTUDIO-REQUEST-ID":     self.request_id,
            "Content-Type":                     "application/json",
            "Accept":                           "application/json",
        }

    async def generate_guide(self, situation: str) -> dict:
        """
        재난 상황을 입력받아 CLOVA Studio에서 행동 요령을 생성합니다.
        API Key가 없으면 규칙 기반 폴백 응답을 반환합니다.
        """
        if not self.enabled:
            # ── 폴백: API Key 없을 때 규칙 기반 응답 ──
            return self._fallback_guide(situation)

        payload = {
            "messages": [
                {"role": "system",    "content": SYSTEM_PROMPT},
                {"role": "user",      "content": f"재난 상황: {situation}"},
            ],
            "topP":        0.8,
            "topK":        0,
            "maxTokens":   512,
            "temperature": 0.5,
            "repeatPenalty": 5.0,
            "stopBefore":  [],
            "includeAiFilters": True,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.BASE_URL}{self.CHAT_API}",
                    headers=self._get_headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

                # 응답 파싱
                content = (
                    data.get("result", {})
                        .get("message", {})
                        .get("content", "")
                )
                steps = self._parse_steps(content)

                return {
                    "steps":       steps,
                    "raw_text":    content,
                    "model":       "HCX-003",
                    "generated_at": datetime.now(),
                }

        except httpx.HTTPStatusError as e:
            print(f"[CLOVA] HTTP Error {e.response.status_code}: {e.response.text}")
            return self._fallback_guide(situation)
        except Exception as e:
            print(f"[CLOVA] Unexpected error: {e}")
            return self._fallback_guide(situation)

    def _parse_steps(self, text: str) -> List[str]:
        """번호 매긴 목록 텍스트를 리스트로 파싱"""
        lines = text.strip().split("\n")
        steps = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # "1. " 또는 "1) " 패턴 제거
            import re
            cleaned = re.sub(r"^\d+[\.\)]\s*", "", line)
            if cleaned:
                steps.append(cleaned)
        return steps if steps else [text]

    def _fallback_guide(self, situation: str) -> dict:
        """API Key 없이 동작하는 규칙 기반 폴백"""
        situation_lower = situation.lower()

        rules = {
            ("화재", "불", "fire"):           FIRE_GUIDE,
            ("지진", "흔들", "earthquake"):   EARTHQUAKE_GUIDE,
            ("홍수", "침수", "flood"):        FLOOD_GUIDE,
            ("가스", "chemical", "누출"):     GAS_GUIDE,
            ("태풍", "typhoon", "바람"):      TYPHOON_GUIDE,
            ("산불", "산"):                   WILDFIRE_GUIDE,
        }

        for keywords, guide in rules.items():
            if any(kw in situation_lower for kw in keywords):
                return {
                    "steps":       guide,
                    "raw_text":    "\n".join(f"{i+1}. {s}" for i, s in enumerate(guide)),
                    "model":       "rule-based-fallback",
                    "generated_at": datetime.now(),
                }

        return {
            "steps":       DEFAULT_GUIDE,
            "raw_text":    "\n".join(f"{i+1}. {s}" for i, s in enumerate(DEFAULT_GUIDE)),
            "model":       "rule-based-fallback",
            "generated_at": datetime.now(),
        }


# ── 규칙 기반 폴백 가이드 ──
FIRE_GUIDE = [
    "즉시 화재경보기를 울리고 큰 소리로 주변에 알리십시오.",
    "젖은 수건으로 코와 입을 막고 낮은 자세로 대피하십시오.",
    "엘리베이터 사용을 금지하고 비상구 계단을 이용하십시오.",
    "문손잡이가 뜨거우면 문을 열지 말고 다른 탈출 경로를 찾으십시오.",
    "건물 밖으로 대피 후 집결지에서 인원을 확인하십시오.",
    "119에 신고하고 절대 건물 안으로 다시 들어가지 마십시오.",
]

EARTHQUAKE_GUIDE = [
    "책상 아래나 튼튼한 구조물 옆에 엎드려 머리와 목을 보호하십시오.",
    "흔들림이 완전히 멈출 때까지 이동을 자제하십시오.",
    "흔들림이 멈추면 가스 밸브를 잠그고 전기 차단기를 내리십시오.",
    "건물 밖으로 나갈 때는 낙하물에 주의하며 머리를 보호하십시오.",
    "야외에서는 건물, 전신주, 담장, 옹벽에서 멀리 이동하십시오.",
    "지정된 대피소로 이동하여 여진에 대비하십시오.",
]

FLOOD_GUIDE = [
    "즉시 높은 지대로 이동하십시오. 지하층·반지하는 즉시 탈출하십시오.",
    "하수구, 맨홀 근처와 침수된 도로 접근을 금지하십시오.",
    "전기 제품 및 가스 기기 사용을 즉시 중단하십시오.",
    "차량은 침수 위험 지역에서 즉시 이동하십시오.",
    "기상청 재난 안전 문자와 행정기관 안내에 따라 행동하십시오.",
    "구조 요청 시 밝은 색 옷이나 손전등으로 위치를 알리십시오.",
]

GAS_GUIDE = [
    "즉시 가스 밸브를 잠그십시오.",
    "전기 스위치, 콘센트, 전자 기기를 절대 건드리지 마십시오.",
    "창문을 열어 환기하고 문을 열어 놓은 채 대피하십시오.",
    "엘리베이터를 이용하지 말고 계단으로 건물 밖으로 대피하십시오.",
    "이웃에게 위험을 알리고 해당 구역에서 멀리 이동하십시오.",
    "119 및 한국가스안전공사(1544-4500)에 즉시 신고하십시오.",
]

TYPHOON_GUIDE = [
    "외출을 삼가고 튼튼한 건물 안에 머무르십시오.",
    "창문을 테이프로 보강하고 유리창 근처를 피하십시오.",
    "침수 위험 지역 주민은 사전에 지정 대피소로 이동하십시오.",
    "해안가, 하천변, 절벽 근처 접근을 절대 금지하십시오.",
    "비상용품(물, 식량, 손전등, 구급약, 보조배터리)을 준비하십시오.",
    "기상청·지자체 공식 안내를 수시로 확인하십시오.",
]

WILDFIRE_GUIDE = [
    "바람이 불어오는 반대 방향으로 즉시 대피하십시오.",
    "연기를 피해 최대한 낮은 자세로 이동하십시오.",
    "젖은 수건으로 코와 입을 막으십시오.",
    "산림청 119에 즉시 신고하고 지시에 따르십시오.",
    "차량으로 대피 시 창문을 닫고 에어컨은 실내 순환 모드로 설정하십시오.",
    "주변 공터나 시야가 트인 장소로 이동하여 구조를 기다리십시오.",
]

DEFAULT_GUIDE = [
    "즉시 안전한 장소로 이동하십시오.",
    "주변 사람들에게 위험 상황을 알리십시오.",
    "119에 신고하고 전문 구조대의 지시에 따르십시오.",
    "귀중품보다 인명 대피를 최우선으로 하십시오.",
    "재난 문자 및 공식 기관의 안내를 수시로 확인하십시오.",
    "부상자 발생 시 가능한 범위에서 응급처치를 실시하십시오.",
]


# 싱글턴 인스턴스
clova_service = ClovaStudioService()
