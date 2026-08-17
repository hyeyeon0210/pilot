// chat.js
// Direct Line Web Chat 공통 부트스트랩. student.html / teacher.html이 함께 사용합니다.
//
// 흐름:
// 1) /api/token?agent=... 을 호출해 (Vercel 서버리스 함수가 대신) 짧은 수명의
//    Direct Line 토큰을 발급받는다 — 진짜 Secret은 브라우저에 절대 내려오지 않는다.
// 2) Bot Framework Web Chat을 그 토큰으로 렌더링한다.
// 3) 연결이 완료되면(DIRECT_LINE/CONNECT_FULFILLED) startConversation 이벤트를
//    initialValue와 함께 전송해, Copilot Studio의 대화 시작 로직이 mode·schoolLevel 등
//    초기 변수를 받아 쓸 수 있게 한다.
//    (참고: Copilot Studio 쪽에서 Global 변수를 만들고 "외부에서 값 설정 가능"을
//     켜둬야 이 값들이 실제로 채워집니다 — README 참고)

async function startPilotChat({ agent, container, initialValue = {}, locale = 'ko-KR' }) {
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

  const store = window.WebChat.createStore({}, ({ dispatch }) => (next) => (action) => {
    if (action.type === 'DIRECT_LINE/CONNECT_FULFILLED') {
      dispatch({
        type: 'DIRECT_LINE/POST_ACTIVITY',
        meta: { method: 'keyboard' },
        payload: {
          activity: {
            type: 'event',
            name: 'startConversation',
            value: initialValue,
          },
        },
      });
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
    },
    container
  );
}
