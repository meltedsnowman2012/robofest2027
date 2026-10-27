# NEXTBOT HYPER · Grok 연결
사이트의 [설치 도우미](./grok-setup.html)에서 SQL과 함수 코드를 복사할 수 있습니다.

## 1. 사용량 보호 SQL
Supabase JUSTWEB 프로젝트 → SQL Editor → 새 쿼리에서 supabase/grok.sql 전체를 실행하세요.
기존 회원·채널·채팅은 유지됩니다. AI 요청 시각·성공 여부·토큰 수만 비공개 테이블에 기록하며 질문 내용은 기록하지 않습니다.
개인 기본 한도 20회/일, 프로젝트 전체 100회/일. 한국 시간 자정 초기화. 실패·중단한 시도도 횟수에 포함됩니다.

## 2. 서버 함수
Supabase 왼쪽 Edge Functions → Deploy a new function → Via Editor.
함수 이름은 정확히 nextbot-grok.
index.ts의 예제 코드를 전부 지우고 supabase/functions/nextbot-grok/index.ts 전체를 붙여 넣어 Deploy function을 누릅니다.
함수 설정의 **Verify JWT with legacy secret**은 OFF로 설정합니다.
이는 로그인 검사를 없애는 설정이 아닙니다. 함수 코드가 Supabase Auth의 getUser로 JWT를 검증하고, nb_identity로 인증된 활성 회원인지 검사합니다. 사용량 함수는 service_role만 실행할 수 있습니다.

## 3. xAI 키
https://console.x.ai/ 에서 API Keys로 들어가 새 API 키를 만듭니다.
API 사용은 Grok 앱 구독과 별개입니다. xAI 계정에서 API 크레딧·사용 한도를 확인하세요.
키는 이 채팅이나 GitHub에 올리지 마세요.
Supabase → Edge Functions → Secrets → 새 secret:
- Name: XAI_API_KEY
- Value: xAI에서 만든 키
저장하세요. Supabase에 기본 제공되는 SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY는 직접 HTML에 복사하지 않습니다.

선택 환경 변수:
- XAI_MODEL: 기본 grok-4.7. 계정에 사용 가능한 모델 ID를 설정할 수 있습니다.
- AI_DAILY_LIMIT: 기본20, 최대200
- AI_PROJECT_DAILY_LIMIT: 기본100, 최대2000
- ALLOWED_ORIGINS: 기본 https://meltedsnowman2012.github.io (경로와 끝 슬래시 없이). 여러 출처는 쉼표로 구분.
최대 출력은 요청당 2,048토큰. 최대 서버 대기 70초. 원가의 절대 금액 한도가 아니므로 xAI 콘솔에서도 지출 한도를 설정하세요.
사용자가 질문할 때만 유료 API가 호출됩니다. 연결 확인은 xAI에 요청하지 않습니다.

## 사용
로그인 → 상단 ✦ HYPER → Grok AI.
일반/코딩/디버깅/전략/회의 요약/번역을 고르고 질문합니다.
참고할 채널은 기본 '없음'. 선택하면 서버에서 권한을 확인한 최근40개 이내 메시지(총 최대16,000자)가 xAI로 전송됩니다.
최대12개 이전 개인 대화가 맥락에 포함될 수 있습니다. '새 대화'로 초기화하세요.
AI 답변은 개인 작업창에 표시되며 '채팅 초안으로'를 누른 뒤 직접 전송해야 공유됩니다.
AI는 외부 검색·실행·DB 수정 도구가 없고, 작업 제안을 직접 등록하지 않습니다.
'작업으로 추가'는 제목 편집 후 추가 버튼을 눌러 저장합니다.
대화는 기본 메모리에만 유지되고 로그아웃/새로고침 시 초기화됩니다. '이 기기에 대화 기록 저장'은 선택 사항입니다.
xAI 요청은 store:false를 사용합니다. 제공사의 모든 데이터 처리 정책이 사라진다는 뜻은 아닙니다.
작업 보드·집중 타이머·개인 설정은 계정별 현재 브라우저에 저장되며 기기 간 자동 동기화되지 않습니다.

## 문제 해결
- 서버 설치 대기: 함수 이름 nextbot-grok과 배포 프로젝트를 확인.
- 사용량 SQL 설정 필요: 1번 SQL을 같은 프로젝트에서 실행.
- 키 설정 대기: Secrets의 XAI_API_KEY 이름과 값 확인.
- 401: 로그아웃 후 재로그인. 함수 내부 Auth 검증은 유지.
- xAI 계정 오류: API 키 권한, 크레딧, XAI_MODEL을 콘솔에서 확인.
- 요청 과다: 동시 요청 차단과 10초 간격 제한이 있습니다. 실패도 하루 시도 횟수에 포함.
- 선택 채널 검색: 최근500개만 검색, 일반 채팅은 최근200개가 표시되며 검색 결과로 이동하면 최근500개를 불러와 해당 메시지를 표시합니다.

공식 문서: [xAI 모델](https://docs.x.ai/developers/models), [Responses API](https://docs.x.ai/developers/model-capabilities/text/generate-text), [Supabase Dashboard 함수 배포](https://supabase.com/docs/guides/functions/quickstart-dashboard), [함수 인증](https://supabase.com/docs/guides/functions/auth-headers).
