# Pilot

**Pilot**은 초·중·고 학생의 프로젝트 학습을 소크라테스식으로 돕는 AI 코치와, 그 결과물을
교사가 성취기준에 근거해 정리·기록할 수 있도록 돕는 AI 보조 도구로 구성된 학습 플랫폼입니다.
Microsoft Copilot Studio로 만든 두 개의 AI 에이전트를, 이 저장소의 정적 웹앱이 브라우저
채팅 화면으로 감싸서 제공합니다.

## 왜 만들었나

학생 주도 프로젝트 학습(EDA, 프로그래밍, 사회문제탐구 등)은 교사 한 명이 학급 전체를
1:1로 밀착 지도하기 어렵고, 결과물을 2022 개정 교육과정 성취기준과 정확히 연결해
생활기록부에 반영하는 작업도 손이 많이 갑니다. Pilot은 이 두 지점을 각각 담당하는
AI 에이전트를 두어 문제를 나눠서 풀되, **정답을 대신 주는 도구가 아니라 학생이 스스로
사고하도록 유도하는 도구**라는 원칙을 처음부터 끝까지 지키도록 설계했습니다.

## 구성 요소

Pilot은 하나의 에이전트가 아니라, 역할이 분리된 세 개의 Copilot Studio 에이전트가
서로 연결되어 동작합니다.

### 1. Pilot Learning Coach (학생용)

학생과 1:1로 대화하며 프로젝트를 진행시키는 소크라테스식 멘토입니다. 절대로 코드나
분석, 완성된 글을 대신 써주지 않고, 학생이 스스로 답을 찾도록 질문으로 되돌립니다.

- **수업모드**: 교사가 지정한 교과·프로젝트 유형에 맞춰, 그 유형 전용 **Skill**이
  단계별로 진행을 이끕니다. 현재 3개의 Skill이 연결되어 있습니다.
  - `eda-project-skill` — 데이터 탐색·분석(인공지능기초 교과)
  - `programming-project-skill` — 프로그래밍 설계·구현(정보 교과)
  - `elementary-social-problem-inquiry-skill` — 사회문제탐구(초등 5~6학년군 사회 교과)
- **탐구모드**: 특정 교과에 매이지 않고 학생이 정한 자유 주제를 Core가 직접 진행합니다.
- 어느 모드든 **문제 발견 → 정의 → 분해 → 해결 전략 → 정리**라는 동일한 공통 흐름을
  따르며, 학년대(초/중/고)에 따라 질문의 톤과 힌트 수준을 다르게 조절합니다.
- 진행 상황은 대화가 끝날 때 `.md` 파일로 내보낼 수 있고, 이 파일을 다음 세션에
  다시 첨부하면 이어서 진행하거나, 교사에게 그대로 제출할 수 있습니다.

### 2. Pilot Management Coach (교사용)

교사가 채팅에 올린 학생 산출물(PDF·Word·텍스트·이미지 등, 형식 무관)을 읽고
성취기준에 근거한 피드백 **초안**을 작성합니다. 합격·불합격이나 점수를 매기지 않고,
항상 교사의 검토·수정을 전제로 한 참고 자료를 만드는 것이 역할입니다. 여러 학생
산출물을 한 번에 올리면 학생별로 파일을 따로따로 주지 않고 통합된 CSV 한 개로
정리해 주며, 이 CSV는 생활기록부 작성 등에 바로 활용할 수 있게 학번·교과·문제정의
요약·관련 성취기준 코드·잘한 점·보완점·다음 단계 제안 등의 컬럼으로 구성됩니다.

### 3. Curriculum Alignment Agent (공용 Connected Agent)

위 두 에이전트가 공통으로 호출하는 세 번째 에이전트로, 2022 개정 교육과정 성취기준의
**단일 소스(Single Source of Truth)** 역할을 합니다. 학생·교사 두 에이전트 모두 성취기준
코드나 문구를 직접 지어내지 않고, 반드시 이 에이전트를 호출해 확인합니다. Knowledge에
새 학교급·교과 문서를 추가하기만 하면(각 문서 첫 줄의 제목과 파일명으로 스스로 인식하는
방식) 별도로 Instruction을 수정할 필요 없이 조회 대상이 자동으로 늘어나도록 설계했습니다.

### 설계 원칙

- **Tool 미연결** — 세 에이전트 모두 OneDrive 같은 외부 저장소 Tool에 연결되어 있지
  않습니다. 파일은 항상 채팅 첨부로 주고받고, 다운로드 파일은 Copilot Studio 내장
  파일 생성 기능으로만 만듭니다. 연결·인증이 필요한 지점을 아예 없애 학교 현장에서
  계정별 저장 용량이나 커넥터 인증 문제로 막히지 않게 했습니다.
- **정답 대신 질문** — 두 에이전트 모두 최종 결과물을 대신 작성하지 않고, 학생이
  직접 시도해보도록 유도하는 것을 최우선 원칙으로 둡니다.
- **성취기준은 한 곳에서만** — Curriculum Alignment Agent 외에는 어떤 에이전트도
  성취기준 원문을 Knowledge로 갖지 않습니다.

## 이 저장소는 무엇을 하나

Copilot Studio에서 만든 위 에이전트들은 그 자체로는 Copilot Studio 안(또는 Teams 등)에서만
대화할 수 있습니다. 이 저장소는 그 에이전트들을 **학교 밖에서도 쓸 수 있는 웹페이지**로
꺼내오는 역할만 합니다 — 구체적으로는:

1. 학생/교사가 접속할 랜딩 페이지와, 학생이 시작 전 자기 정보(학교급·학년·반·교과 등)를
   고르는 화면, 그리고 실제 대화가 오가는 채팅 화면(HTML/CSS/JS, 별도 프레임워크 없음)
2. Copilot Studio 에이전트와 실시간으로 대화를 주고받는 [Direct Line](https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts) 연결
3. 그 연결에 필요한 **비밀 키(Direct Line Secret)를 브라우저에 노출시키지 않고** 숨겨주는
   Vercel 서버리스 함수

즉 "Copilot Studio 에이전트 + 이 저장소(정적 웹앱) + Vercel(서버리스 함수·호스팅) +
GitHub(코드 저장·자동 배포)"가 합쳐져야 완성되는 구조입니다. 에이전트의 대화 로직·
페르소나·규칙은 전부 Copilot Studio의 Instruction에 있고, 이 저장소는 그 화면과
연결 통로만 담당합니다.

## 폴더 구조

```
pilot-webapp/
├── index.html          학생/교사 선택 랜딩 페이지
├── student.html        학생용 — 시작 전 설정 화면 + 채팅
├── teacher.html         교사용 — 바로 채팅
├── style.css            공통 스타일(파스텔 톤)
├── chat.js              Direct Line Web Chat 연결 공통 로직
├── api/
│   └── token.js         Vercel 서버리스 함수 — Direct Line 토큰 발급 프록시
├── .env.example         필요한 환경변수 이름만 적어둔 예시 (실제 값 X)
└── .gitignore
```

## 동작 순서 (한눈에)

```
[학생/교사 브라우저]
     │  1) 페이지 접속
     ▼
[student.html / teacher.html]
     │  2) /api/token?agent=student|teacher 호출
     ▼
[Vercel 서버리스 함수 api/token.js]
     │  3) Vercel 환경변수에 저장된 Direct Line Secret으로
     │     Microsoft Direct Line 서버에 "토큰 발급" 요청
     ▼
[Direct Line 서버] ── 1시간짜리 1회용 토큰만 브라우저로 반환
     │  4) 그 토큰으로 Web Chat이 대화 연결
     ▼
[Copilot Studio 에이전트: Pilot Learning/Management Coach]
     │  5) 필요할 때 Curriculum Alignment Agent를 내부적으로 호출
     ▼
[학생/교사 화면에 응답·다운로드 파일 표시]
```

브라우저는 2)와 4)만 직접 하고, 진짜 비밀 키는 3)의 서버 안에만 머뭅니다.

## 배포 방법

### 1. Copilot Studio에서 Direct Line Secret 발급받기

각 에이전트(Pilot Learning Coach / Pilot Management Coach)마다 따로 진행합니다.

1. Copilot Studio에서 해당 에이전트 열기 → **Settings(설정) → Channels(채널)**
2. **Direct Line** 채널을 추가/열기
3. 표시되는 **Secret key**(Secret 1 또는 Secret 2)를 복사

> 참고: 화면에 따라 "Mobile app" 채널의 **Token Endpoint**(URL 형태)가 먼저 보일 수도
> 있습니다. 이 프로젝트는 "진짜 키를 서버 뒤에 숨기는" 구조를 쓰므로, 문자열 형태의
> **Secret key**가 보이는 화면을 사용해주세요.

### 2. GitHub에 올리기

```bash
cd pilot-webapp
git init
git add .
git commit -m "Pilot 웹앱 초기 구성"
git branch -M main
git remote add origin https://github.com/<본인계정>/pilot-webapp.git
git push -u origin main
```

`.env` 파일은 만들지 않았고 `.gitignore`에도 막아뒀으니 실수로 키를 커밋할 일은 없습니다.
`.env.example`은 변수 **이름**만 있고 실제 값은 비어 있어 그대로 올려도 안전합니다.

### 3. Vercel에 배포하기

1. [vercel.com](https://vercel.com)에서 이 GitHub 저장소를 **Import**
2. Framework Preset은 자동 감지된 대로(또는 "Other") 두면 됩니다 — 별도 빌드 설정 없이도
   정적 HTML + `/api` 폴더를 그대로 인식합니다.
3. 배포 전에 **Settings → Environment Variables**에서 아래 두 개를 등록:

   | Name | Value |
   |---|---|
   | `pilot_learning_coach_agent` | 1번에서 복사한 Pilot Learning Coach Secret |
   | `pilot_management_coach_agent` | 1번에서 복사한 Pilot Management Coach Secret |

4. Deploy. 완료되면 `https://<프로젝트명>.vercel.app` 주소가 생깁니다.
5. 이후 GitHub `main` 브랜치에 push할 때마다 Vercel이 자동 재배포합니다. 환경변수를
   나중에 추가·수정했다면 반드시 **Redeploy**를 한 번 눌러줘야 반영됩니다.

### 4. 초기 변수는 어떻게 에이전트에 전달되나

`student.html`은 시작 화면에서 입력받은 `mode`·`schoolLevel`·`grade`·`classId`·`studentId`·
`subject`·`projectType`·`achievementStandards`·`learningGoals` 값을 대화가 연결되자마자
**보이지 않는 첫 번째 채팅 메시지**로 보냅니다(`[PILOT_WEBAPP_CONTEXT] {...JSON...}`
형태, `chat.js` 참고). `activityMiddleware`로 이 메시지만 화면 렌더링에서 걸러내기
때문에 학생 눈에는 보이지 않지만, 에이전트에게는 정상적인 채팅 메시지로 전달됩니다.

처음에는 Copilot Studio의 "Global 변수 + 이벤트 액티비티" 방식(Topics 화면에서
Question 노드로 변수를 받는 고전적인 방식)으로 시도했는데, 지금 사용 중인
단순화된 에이전트 빌더(Topics/Global 변수 편집 화면이 없는, Instruction 한 칸으로
동작을 정의하는 빌더)에는 그 UI 자체가 없어서 값이 전달되지 않는 문제가 있었습니다.
그래서 **이벤트가 아니라 실제 메시지로 보내고, 에이전트의 Instruction이 그 메시지를
직접 해석**하도록 방식을 바꿨습니다. Copilot Studio 쪽에서 별도로 변수를 만들거나
설정할 필요가 없고, **Pilot Learning Coach Instruction 3번**에 이 메시지를 읽는
규칙이 이미 반영되어 있습니다 — Instruction을 이 버전으로 맞춰만 두면 됩니다.

**첫 인사말이 두 번 뜨거나(오래된 이름이 섞여 나오는 등) mode가 계속 탐구모드로만
나온다면**, 아래를 확인해보세요.

- Instruction 3번이 최신 버전(`[PILOT_WEBAPP_CONTEXT]` 메시지를 읽는 규칙 포함)으로
  저장·게시되어 있는지
- Conversation Start와는 별개로 **기본 제공되는 "Greeting" 프롬프트**가 따로 남아
  있어 그쪽도 같이 응답하고 있지 않은지 — 있다면 하나로 정리해주세요.
- 브라우저 캐시 — 강력 새로고침(`Ctrl/Cmd+Shift+R`) 또는 시크릿 창으로 재시도

### 5. 로컬에서 먼저 테스트하고 싶다면

```bash
npm install -g vercel
cd pilot-webapp
vercel dev
```

`vercel dev`를 실행하면 `.env.local` 파일에 넣어둔 값으로 `/api/token`이 로컬에서도
동작합니다(`.env.local`도 `.gitignore`에 포함되어 있어 커밋되지 않습니다).

## 배포 후 확인 체크리스트

- [ ] `index.html`에서 "학생으로 시작하기" → 설정 화면 → 시작하기 → 채팅창이 뜨는지
- [ ] `teacher.html`에 바로 채팅창이 뜨는지
- [ ] 채팅창 하단의 첨부(📎) 버튼으로 파일을 올렸을 때 에이전트가 정상적으로 읽는지
- [ ] 에이전트가 만들어주는 파일(CSV/.md)이 채팅에 다운로드 카드로 뜨는지
- [ ] 학생 설정 화면에서 입력한 값(교과·프로젝트유형 등)이 실제로 에이전트 첫 응답에
      반영되는지 — 반영되지 않으면 4번의 Conversation Start 변수 설정을 다시 확인

## 보안 메모

- `pilot_learning_coach_agent` / `pilot_management_coach_agent`은 Vercel 대시보드에만
  존재하고, GitHub 저장소 어디에도 들어가지 않습니다.
- `/api/token`이 반환하는 것은 짧은 수명(기본 1시간)의 1회용 토큰뿐이라, 이 토큰이 노출돼도
  Secret 자체가 유출되는 것보다 훨씬 안전합니다.
- 필요하면 위 4번 문서의 "Configure web and Direct Line channel security"로 아예 Vercel
  배포 도메인 외에서는 토큰이 안 먹히게 추가로 잠글 수 있습니다.

## 확장하는 방법

- **성취기준 추가**: Curriculum Alignment Agent의 Knowledge에 새 학교급·교과 문서를
  올리기만 하면 됩니다. 문서 자체가 자기 제목으로 스스로를 설명하는 방식이라
  Instruction을 고칠 필요가 없습니다.
- **새 교과/프로젝트 유형 추가**: 그 교과 전용 Skill을 새로 만들어 Pilot Learning Coach에
  연결하면, Core는 그 시점에 연결된 모든 Skill의 Description을 기준으로 자동 라우팅합니다.
