# Pilot 웹앱

Pilot Learning Coach(학생용)·Pilot Management Coach(교사용) Copilot Studio 에이전트를
브라우저 채팅 화면으로 감싸는 정적 웹앱입니다. 실제 Direct Line Secret은 브라우저에
전혀 내려가지 않고, Vercel 서버리스 함수(`/api/token.js`) 안에서만 사용됩니다.

## 폴더 구조

```
pilot-webapp/
├── index.html        학생/교사 선택 랜딩 페이지
├── student.html       학생용 — 시작 전 설정 화면 + 채팅
├── teacher.html        교사용 — 바로 채팅
├── style.css          공통 스타일
├── chat.js            Direct Line Web Chat 연결 공통 로직
├── api/
│   └── token.js       Vercel 서버리스 함수 — Direct Line 토큰 발급 프록시
├── .env.example       필요한 환경변수 이름만 적어둔 예시 (실제 값 X)
└── .gitignore
```

## 1. Copilot Studio에서 Direct Line Secret 발급받기

각 에이전트(Pilot Learning Coach / Pilot Management Coach)마다 따로 진행합니다.

1. Copilot Studio에서 해당 에이전트 열기 → **Settings(설정) → Channels(채널)**
2. **Direct Line** 채널을 추가/열기
3. 표시되는 **Secret key**(Secret 1 또는 Secret 2)를 복사

> 참고: Copilot Studio 화면에 따라 "Mobile app" 채널의 **Token Endpoint**(URL 형태)가
> 먼저 보일 수도 있습니다. 이 URL은 Microsoft가 이미 안전하게 프록시해주는 형태라
> 원칙적으로 클라이언트에서 바로 호출해도 되지만, 이 프로젝트는 처음 말씀하신 대로
> "진짜 키를 서버 뒤에 숨기는" 구조로 통일했습니다. 두 화면 중 **Secret key(문자열)**가
> 보이는 쪽을 사용해주세요. 어떤 화면이 보이는지 헷갈리면 스크린샷을 공유해주시면
> 바로 확인해드릴게요.

## 2. GitHub에 올리기

```bash
cd pilot-webapp
git init
git add .
git commit -m "Pilot 웹앱 초기 구성"
git branch -M main
git remote add origin https://github.com/<본인계정>/pilot-webapp.git
git push -u origin main
```

`.env` 파일은 만들지 않았고 `.gitignore`에도 막아뒀으니, 실수로 키를 커밋할 일은 없습니다.
`.env.example`은 변수 **이름**만 있고 실제 값은 비어 있어 그대로 올려도 안전합니다.

## 3. Vercel에 배포하기

1. [vercel.com](https://vercel.com) 에서 방금 만든 GitHub 저장소를 **Import**
2. Framework Preset은 자동 감지된 대로(또는 "Other") 두면 됩니다 — 빌드 설정 없이도
   정적 HTML + `/api` 폴더를 그대로 인식합니다.
3. 배포 전에 **Settings → Environment Variables**에서 아래 두 개를 등록:

   | Name | Value |
   |---|---|
   | `pilot_learning_coach_agent` | 1번에서 복사한 Pilot Learning Coach Secret |
   | `pilot_management_coach_agent` | 1번에서 복사한 Pilot Management Coach Secret |

4. Deploy. 완료되면 `https://<프로젝트명>.vercel.app` 주소가 생깁니다.
5. 이후 GitHub `main` 브랜치에 push할 때마다 Vercel이 자동 재배포합니다.

환경변수를 나중에 추가/수정한 경우, 반드시 **Redeploy**를 한 번 눌러줘야 반영됩니다.

## 4. Copilot Studio 쪽에서 초기 변수 받기

`student.html`은 시작 화면에서 입력받은 `mode`·`schoolLevel`·`grade`·`classId`·`studentId`·
`subject`·`projectType`·`achievementStandards`·`learningGoals` 값을, 대화가 연결되자마자
`startConversation`이라는 이벤트 액티비티에 담아 에이전트로 보냅니다(`chat.js` 참고).

Copilot Studio 쪽에서 이 값을 받으려면 (Learning Coach Instruction 3번 표에 있는 변수명과
정확히 일치해야 합니다):

1. Pilot Learning Coach → **Topics → System topics → Conversation Start**
2. 각 변수마다 **Question 노드**를 추가하고 질문 문구는 비워둔 채:
   - Identify: **User's entire response**
   - Variable 이름을 `mode`, `schoolLevel`, `grade` 등 **웹앱이 보내는 이름과 동일하게** 지정
   - Variable 속성에서 **Scope: Global**, **"External sources can set values"** 켜기
3. 저장 후 게시(Publish)

이 부분은 Copilot Studio 화면 구성이 버전마다 조금씩 달라질 수 있어, 정확한 최신 절차는
아래 공식 문서로 한 번 더 확인해보시는 걸 권장드립니다.

- [Pass context variables from a webpage to an agent](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/pass-context-variables-from-webpage-to-copilot)
- [Publish an agent to mobile or custom apps](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-connect-bot-to-custom-application)
- [Automatically start an agent conversation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-bot-greeting)
- [Configure web and Direct Line channel security](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-web-security) — Direct Line을 특정 도메인(배포된 Vercel 주소)에서만 쓰도록 추가로 제한하고 싶을 때 참고

## 5. 로컬에서 먼저 테스트하고 싶다면

```bash
npm install -g vercel
cd pilot-webapp
vercel dev
```

`vercel dev`를 실행하면 `.env.local` 파일에 넣어둔 값으로 `/api/token`이 로컬에서도
동작합니다(`.env.local`도 `.gitignore`에 포함되어 있어 커밋되지 않습니다).

## 6. 배포 후 확인 체크리스트

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
