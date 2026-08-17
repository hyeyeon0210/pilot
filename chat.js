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
// 6) Direct Line은 첨부파일 용량이 약 4MB를 넘으면 업로드가 그냥 실패한다
//    (Bot Framework 쪽 플랫폼 자체 한도 — Copilot Studio 설정으로 바꿀 수 없음).
//    그래서 클립보드에서 붙여넣은 이미지(스크린샷 등)는 <canvas>로 미리
//    압축·축소한 뒤, WebChat 내부의 파일첨부 경로 대신 Direct Line JS의
//    안정적인 postActivity API로 직접 전송한다. PDF/DOCX 등 이미지가 아닌
//    파일(📎 버튼으로 첨부)은 클라이언트에서 압축할 방법이 없어 이 우회가
//    적용되지 않으며, 여전히 4MB 아래여야 전송된다.

const PILOT_CONTEXT_MARKER = '[PILOT_WEBAPP_CONTEXT]';
const PILOT_STAGE_PATTERN = /\s*\[PILOT_STAGE:(\d)\]\s*$/;
// Direct Line의 실제 한도(약 4MB)보다 여유를 둔 안전선.
const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;

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

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

function drawImageToCanvas(bitmap, maxDimension) {
  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// 원본 이미지를 해상도·화질을 단계적으로 낮춰가며 MAX_ATTACHMENT_BYTES
// 아래로 줄어들 때까지 압축한다. (Direct Line의 ~4MB 첨부 한도 우회용)
async function shrinkImageUnderLimit(file) {
  const bitmap = await createImageBitmap(file);
  const dimensionSteps = [1600, 1200, 900, 700, 500];
  const qualitySteps = [0.8, 0.6, 0.45, 0.3];

  let smallestBlob = null;
  for (const maxDimension of dimensionSteps) {
    const canvas = drawImageToCanvas(bitmap, maxDimension);
    for (const quality of qualitySteps) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (!blob) continue;
      if (!smallestBlob || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }
      if (blob.size <= MAX_ATTACHMENT_BYTES) {
        return blob;
      }
    }
  }
  // 그래도 한도 아래로 못 줄이면, 지금까지 시도한 것 중 가장 작은 결과라도 반환한다.
  return smallestBlob;
}

// 붙여넣기(paste) 중이라는 상태를 채팅창 위에 잠깐 띄워준다 — 지금은 아무 표시가
// 없어서 "무슨 파일이 들어갔는지 안 보인다"는 문제도 함께 해결한다.
function showPasteToast(container, message, variant) {
  let toast = container.querySelector('.pilot-paste-toast');
  if (!message) {
    if (toast) toast.remove();
    return;
  }
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'pilot-paste-toast';
    container.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('is-error', variant === 'error');
  toast.classList.toggle('is-success', variant === 'success');
  if (variant !== 'error') {
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.remove(), 2600);
  }
}

// 채팅창에 이미지를 붙여넣으면(스크린샷 캡처 등) 자동으로 압축한 뒤
// Direct Line에 직접 전송한다 — WebChat 기본 첨부 경로(WEB_CHAT/SEND_FILES)는
// 최신 CDN 빌드에서 동작이 불안정하다는 보고가 있어 우회한다.
function setupImagePasteHandler(container, directLine, userId, agent) {
  container.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData && event.clipboardData.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return; // 이미지가 아니면 원래 붙여넣기 동작(텍스트 등)을 막지 않는다

    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();

    (async () => {
      showPasteToast(container, '이미지를 준비하고 있어요…');
      try {
        let blob = file;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          blob = await shrinkImageUnderLimit(file);
        }
        if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
          showPasteToast(container, '이미지 용량이 너무 커서 보낼 수 없어요. 더 작은 이미지로 시도해 주세요.', 'error');
          return;
        }

        const dataUri = await blobToDataUri(blob);
        const fileName = `screenshot-${Date.now()}.jpg`;

        directLine.postActivity({
          type: 'message',
          from: { id: userId, name: agent === 'teacher' ? '교사' : '학생' },
          text: '',
          attachments: [
            {
              contentType: 'image/jpeg',
              contentUrl: dataUri,
              name: fileName,
            },
          ],
        }).subscribe(
          () => showPasteToast(container, `${fileName} 전송 완료`, 'success'),
          () => showPasteToast(container, '이미지 전송에 실패했어요. 다시 시도해 주세요.', 'error')
        );
      } catch (err) {
        showPasteToast(container, '이미지를 처리하는 중 문제가 발생했어요.', 'error');
      }
    })();
  });
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

  const directLine = window.WebChat.createDirectLine({ token });

  container.innerHTML = '';
  window.WebChat.renderWebChat(
    {
      directLine,
      store,
      userID: userId,
      locale,
      styleOptions,
      activityMiddleware: hideContextMessageMiddleware,
    },
    container
  );

  // 채팅창(파일 첨부 영역 포함)에 이미지를 붙여넣으면 자동 압축 후 전송되도록 연결한다.
  container.style.position = 'relative';
  setupImagePasteHandler(container, directLine, userId, agent);
}
