// chat.js
// Direct Line Web Chat 공통 부트스트랩. student.html / teacher.html이 함께 사용합니다.
//
// 흐름:
// 1) /api/token?agent=... 을 호출해 (Vercel 서버리스 함수가 대신) 짧은 수명의
//    Direct Line 토큰을 발급받는다 — 진짜 Secret은 브라우저에 절대 내려오지 않는다.
// 2) Bot Framework Web Chat을 그 토큰으로 렌더링한다.
// 3) 연결이 완료되면(DIRECT_LINE/CONNECT_FULFILLED) initialValue를 "첫 번째 사용자
//    메시지"로 보낸다. Copilot Studio의 지금 에이전트 빌더(Topics/Global 변수 화면이
//    없는 단순화된 빌더)는 별도 변수 바인딩 UI가 없어서, 이벤트 액티비티나
//    pvaSetContext 같은 예약 이벤트로는 값이 전달되지 않았다 — 그래서 대신 실제
//    메시지로 보내고, 그 안의 값은 Instruction이 직접 읽어서 해석하도록 했다
//    (Learning Coach Instruction 3번 참고).
// 4) 이 메시지는 학생에게는 보이면 안 되므로, activityMiddleware로 화면에서만
//    숨긴다 — 봇에게는 정상적으로 전달되고, 학생 눈에만 안 보인다.
// 5) 에이전트가 매 응답 끝에 붙이는 "[PILOT_STAGE:n]" 태그(n=1~5, 공통 백본 단계
//    번호)를 들어오는 활동에서 읽어 onStageChange로 넘기고, 학생에게 보이는
//    텍스트에서는 그 태그를 잘라낸다 — 진행 상황 사이드바가 이 콜백으로 갱신된다.

const PILOT_CONTEXT_MARKER = '[PILOT_WEBAPP_CONTEXT]';
const PILOT_STAGE_PATTERN = /\s*\[PILOT_STAGE:(\d)\]\s*$/;

// 우리가 보낸 컨텍스트 메시지를 화면(transcript)에서만 제거한다.
function hideContextMessageMiddleware() {
  return (next) => (card) => {
    const { activity } = card;
    if (
      activity &&
      activity.from &&
      activity.from.role === 'user' &&
      typeof activity.text === 'string' &&
      activity.text.startsWith(PILOT_CONTEXT_MARKER)
    ) {
      return () => false;
    }
    return next(card);
  };
}

async function startPilotChat({ agent, container, initialValue = {}, locale = 'ko-KR', onStageChange }) {
  container.innerHTML = '<div class="pilot-loading">대화를 준비하고 있어요…</div>';

  let token;
  try {
    const tokenRes = await fetch(`/api/token?agent=${encodeURIComponent(agent)}`);
    const body = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(body.error || `토큰 발급 실패 (${tokenRes.status})`);
    }
    token = body.token;
  } catch (err) {
    container.innerHTML = `<div class="pilot-loading">채팅을 시작하지 못했습니다.<br>${err.message}</div>`;
    return;
  }

  const hasInitialValue = Object.values(initialValue).some((v) => v !== '' && v != null);

  const store = window.WebChat.createStore({}, ({ dispatch }) => (next) => (action) => {
    if (action.type === 'DIRECT_LINE/CONNECT_FULFILLED' && hasInitialValue) {
      dispatch({
        type: 'WEB_CHAT/SEND_MESSAGE',
        payload: {
          text: `${PILOT_CONTEXT_MARKER} ${JSON.stringify(initialValue)}`,
        },
      });
    }

    if (action.type === 'DIRECT_LINE/INCOMING_ACTIVITY' && typeof onStageChange === 'function') {
      const { activity } = action.payload;
      if (activity && activity.type === 'message' && typeof activity.text === 'string') {
        const match = activity.text.match(PILOT_STAGE_PATTERN);
        if (match) {
          onStageChange(Number(match[1]));
          // 학생에게는 태그 없이 깔끔한 텍스트만 보이도록, 여기서 잘라낸 뒤 전달한다.
          action = {
            ...action,
            payload: {
              ...action.payload,
              activity: {
                ...activity,
                text: activity.text.slice(0, match.index).trim(),
              },
            },
          };
        }
      }
    }

    return next(action);
  });

  const userIdKey = `pilot-user-id-${agent}`;
  let userId = localStorage.getItem(userIdKey);
  if (!userId) {
    userId = `pilot-${agent}-${crypto.randomUUID()}`;
    localStorage.setItem(userIdKey, userId);
  }

  // 채팅창 내부도 랜딩·설정 화면과 같은 파스텔 톤으로 맞춘다.
  const styleOptions = {
    accent: '#6C5DD3',
    backgroundColor: '#FFFFFF',
    primaryFont:
      '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',

    bubbleBackground: '#F3F1FC',
    bubbleTextColor: '#322F3D',
    bubbleBorderRadius: 14,
    bubbleFromUserBackground: '#6C5DD3',
    bubbleFromUserTextColor: '#FFFFFF',
    bubbleFromUserBorderRadius: 14,

    botAvatarBackgroundColor: '#EEEAFB',
    botAvatarInitials: 'AI',
    userAvatarBackgroundColor: '#F0B199',
    userAvatarInitials: agent === 'teacher' ? '교사' : '학생',

    sendBoxBackground: '#FFFFFF',
    sendBoxBorderTop: '1px solid #EAE5F6',
    sendBoxTextColor: '#322F3D',
    sendBoxButtonColorDefault: '#7B7689',
    sendBoxButtonColorOnHover: '#6C5DD3',

    suggestedActionBackgroundColor: '#F3F1FC',
    suggestedActionBorderColor: '#6C5DD3',
    suggestedActionTextColor: '#5A4DBF',
  };

  container.innerHTML = '';
  window.WebChat.renderWebChat(
    {
      directLine: window.WebChat.createDirectLine({ token }),
      store,
      userID: userId,
      locale,
      styleOptions,
      activityMiddleware: hideContextMessageMiddleware,
    },
    container
  );
}
