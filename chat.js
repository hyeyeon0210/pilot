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
//    그래서 클립보드 붙여넣기(스크린샷)나 📎 버튼으로 고른 파일 모두
//    WebChat 내부의 (불안정한) 파일첨부 경로를 거치지 않고, 먼저 화면 아래
//    tray에 "담아 미리보기"만 한 뒤 — 이미지는 <canvas>로 압축까지 마친 뒤 —
//    학생/교사가 "전송"을 눌렀을 때 Direct Line JS의 안정적인 postActivity
//    API로 직접 보낸다. PDF/DOCX 등 이미지가 아닌 파일은 클라이언트에서
//    압축할 방법이 없어, base64 인코딩 오버헤드까지 감안한 더 낮은 용량
//    한도(MAX_RAW_FILE_BYTES)를 넘으면 애초에 담지 못하게 막는다.

const PILOT_CONTEXT_MARKER = '[PILOT_WEBAPP_CONTEXT]';
const PILOT_STAGE_PATTERN = /\s*\[PILOT_STAGE:(\d)\]\s*$/;
// Direct Line의 실제 한도(약 4MB)보다 여유를 둔 안전선 — 압축 가능한 이미지의 목표 상한.
const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;
// 압축이 불가능한 일반 파일(PDF·DOCX 등)의 안전 상한. data URI(base64)로
// 감싸면 원본보다 약 37% 커지므로, 원본 기준으로는 더 보수적으로 잡는다.
const MAX_RAW_FILE_BYTES = 2.5 * 1024 * 1024;

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// 파일 확장자/타입에 따라 미리보기용 아이콘을 고른다 (이미지가 아닌 파일 전용).
function fileIconFor(name, contentType) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if ((contentType || '').includes('pdf') || ext === 'pdf') return '📄';
  if (['doc', 'docx', 'hwp', 'hwpx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  return '📎';
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

// 채팅창에 이미지를 붙여넣으면(스크린샷 캡처 등) 자동으로 압축한다 —
// Direct Line에 직접 전송하는 시점은 아래 attachment tray의 "전송" 클릭 시점이다
// (WebChat 기본 첨부 경로인 WEB_CHAT/SEND_FILES는 최신 CDN 빌드에서 동작이
// 불안정하다는 보고가 있어 우회하고, Direct Line JS의 postActivity로 직접 보낸다).
//
// 주의: WebChat의 입력창(SendBox)은 자체적으로 paste 이벤트를 처리해
// (그리고 그 처리가 앞서 확인한 대로 조용히 실패한다) 이벤트 전파를 막아버린다.
// 그래서 일반적인 방식(bubble 단계에서 상위 container에 리스너를 다는 것)으로는
// 우리 핸들러가 아예 호출되지 않는다 — capture 단계에서 먼저 가로채야
// WebChat이 이벤트를 받기 전에 우리가 먼저 처리하고 전파를 끊을 수 있다.
function extractImageFileFromClipboard(clipboardData) {
  if (!clipboardData) return null;

  const items = Array.from(clipboardData.items || []);
  const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (file) return file;
  }

  // 일부 브라우저/상황에서는 items가 아니라 files에만 들어있는 경우가 있다.
  const files = Array.from(clipboardData.files || []);
  return files.find((f) => f.type.startsWith('image/')) || null;
}

// 붙여넣은 이미지를 바로 전송하지 않고 "담아두는" 화면(tray)을 관리한다.
// 스크린샷을 여러 장 이어 붙여도 한 장씩 즉시 전송되지 않고, 학생이 원하는
// 만큼 모았다가 "전송" 버튼을 눌렀을 때 한 번에(여러 장 첨부로) 보낼 수 있다.
function createAttachmentTray(container, directLine, userId, agent) {
  const pending = [];
  let trayEl = null;

  function setReservedSpace(active) {
    // tray가 떠 있는 동안, WebChat이 그 자리를 침범하지 않도록 아래쪽에
    // 여백을 확보해둔다 (tray는 container 안에 absolute로 겹쳐 그린다).
    container.style.paddingBottom = active ? '132px' : '';
  }

  function render() {
    if (pending.length === 0) {
      if (trayEl) {
        trayEl.remove();
        trayEl = null;
      }
      setReservedSpace(false);
      return;
    }

    setReservedSpace(true);

    if (!trayEl) {
      trayEl = document.createElement('div');
      trayEl.className = 'pilot-attach-tray';
      container.appendChild(trayEl);
    }
    trayEl.innerHTML = '';

    const thumbs = document.createElement('div');
    thumbs.className = 'pilot-attach-thumbs';
    pending.forEach((item) => {
      const thumb = document.createElement('div');

      if (item.kind === 'image') {
        thumb.className = 'pilot-attach-thumb';
        const img = document.createElement('img');
        img.src = item.previewUrl;
        img.alt = '첨부할 이미지 미리보기';
        thumb.appendChild(img);
      } else {
        thumb.className = 'pilot-attach-file-chip';

        const icon = document.createElement('span');
        icon.className = 'pilot-attach-file-icon';
        icon.textContent = fileIconFor(item.name, item.contentType);
        thumb.appendChild(icon);

        const meta = document.createElement('span');
        meta.className = 'pilot-attach-file-meta';

        const nameEl = document.createElement('span');
        nameEl.className = 'pilot-attach-file-name';
        nameEl.textContent = item.name;
        nameEl.title = item.name;
        meta.appendChild(nameEl);

        const sizeEl = document.createElement('span');
        sizeEl.className = 'pilot-attach-file-size';
        sizeEl.textContent = formatBytes(item.size);
        meta.appendChild(sizeEl);

        thumb.appendChild(meta);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pilot-attach-remove';
      removeBtn.setAttribute('aria-label', '이 첨부 빼기');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        const idx = pending.findIndex((p) => p.id === item.id);
        if (idx >= 0) pending.splice(idx, 1);
        render();
      });
      thumb.appendChild(removeBtn);

      thumbs.appendChild(thumb);
    });
    trayEl.appendChild(thumbs);

    const actions = document.createElement('div');
    actions.className = 'pilot-attach-actions';

    const countLabel = document.createElement('span');
    countLabel.className = 'pilot-attach-count';
    countLabel.textContent = `첨부 ${pending.length}개 담김`;
    actions.appendChild(countLabel);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'pilot-attach-clear';
    clearBtn.textContent = '모두 빼기';
    clearBtn.addEventListener('click', () => {
      pending.length = 0;
      render();
    });
    actions.appendChild(clearBtn);

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'pilot-attach-send';
    sendBtn.textContent = '전송';
    sendBtn.addEventListener('click', sendAll);
    actions.appendChild(sendBtn);

    trayEl.appendChild(actions);
  }

  async function addImage(file) {
    showPasteToast(container, '이미지를 준비하고 있어요…');
    try {
      let blob = file;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        blob = await shrinkImageUnderLimit(file);
      }
      if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
        showPasteToast(container, '이미지 용량이 너무 커서 담을 수 없어요. 더 작은 이미지로 시도해 주세요.', 'error');
        return;
      }
      const dataUri = await blobToDataUri(blob);
      pending.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'image',
        previewUrl: dataUri,
        name: `screenshot-${Date.now()}.jpg`,
        size: blob.size,
        contentType: 'image/jpeg',
      });
      showPasteToast(container, '');
      render();
    } catch (err) {
      showPasteToast(container, '이미지를 처리하는 중 문제가 발생했어요.', 'error');
    }
  }

  // 이미지가 아닌 일반 파일(PDF·DOCX 등)은 클라이언트에서 압축할 방법이 없으므로,
  // 더 낮은 한도(MAX_RAW_FILE_BYTES)를 넘으면 애초에 담지 않고 바로 안내한다.
  async function addGenericFile(file) {
    showPasteToast(container, '파일을 준비하고 있어요…');
    try {
      if (file.size > MAX_RAW_FILE_BYTES) {
        showPasteToast(
          container,
          `"${file.name}" 파일이 너무 커서(${formatBytes(file.size)}) 담을 수 없어요. 문서·PDF 파일은 압축할 수 없어서 ${formatBytes(MAX_RAW_FILE_BYTES)} 이하만 첨부할 수 있어요.`,
          'error'
        );
        return;
      }
      const dataUri = await blobToDataUri(file);
      pending.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'file',
        previewUrl: dataUri,
        name: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      });
      showPasteToast(container, '');
      render();
    } catch (err) {
      showPasteToast(container, '파일을 처리하는 중 문제가 발생했어요.', 'error');
    }
  }

  // 붙여넣기·📎 버튼 어느 경로로 들어오든 이 함수 하나로 받는다 — 이미지면
  // 압축 경로(addImage)로, 그 외 파일이면 addGenericFile로 나눠 보낸다.
  function addFile(file) {
    if (file.type && file.type.startsWith('image/')) {
      return addImage(file);
    }
    return addGenericFile(file);
  }

  function sendAll() {
    if (pending.length === 0) return;

    const attachments = pending.map((item) => ({
      contentType: item.contentType,
      contentUrl: item.previewUrl,
      name: item.name,
    }));
    const snapshot = pending.slice();
    pending.length = 0;
    render();
    showPasteToast(container, `첨부 ${attachments.length}개를 보내고 있어요…`);

    directLine
      .postActivity({
        type: 'message',
        from: { id: userId, name: agent === 'teacher' ? '교사' : '학생' },
        text: '',
        attachments,
      })
      .subscribe(
        () => showPasteToast(container, `첨부 ${attachments.length}개 전송 완료`, 'success'),
        () => {
          showPasteToast(container, '전송에 실패했어요. 다시 시도해 주세요.', 'error');
          // 실패하면 다시 tray에 되돌려서 재시도할 수 있게 한다.
          pending.push(...snapshot);
          render();
        }
      );
  }

  return { addFile };
}

// 붙여넣기(스크린샷)와 📎 버튼(파일 선택) 두 경로 모두, WebChat 기본 처리로
// 넘어가기 전에 가로채서 같은 tray로 모은다 — student.html/teacher.html
// 둘 다 startPilotChat을 통해 이 함수를 쓰므로 두 페이지 모두 동일하게 적용된다.
function setupAttachmentInterception(container, directLine, userId, agent) {
  const tray = createAttachmentTray(container, directLine, userId, agent);

  const handlePaste = (event) => {
    const file = extractImageFileFromClipboard(event.clipboardData);
    if (!file) return; // 이미지가 아니면 원래 붙여넣기 동작(텍스트 등)을 막지 않는다

    // WebChat 자체의 (불안정한) 첨부 처리가 이 이벤트를 먼저 가져가지 못하도록
    // 여기서 완전히 막고 우리가 대신 처리한다.
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    tray.addFile(file);
  };

  // 📎 버튼을 누르면 WebChat이 숨겨진 <input type="file">을 열고, 파일을
  // 고르면 그 input에서 change 이벤트가 발생한다. WebChat 자신도 이 이벤트를
  // 들어서 (불안정한) 자체 업로드를 시도하므로, paste와 마찬가지로 capture
  // 단계에서 먼저 가로채 우리 tray로 돌린다.
  const handleFileInputChange = (event) => {
    const target = event.target;
    if (!target || target.tagName !== 'INPUT' || target.type !== 'file') return;
    const files = Array.from(target.files || []);
    if (files.length === 0) return;

    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    files.forEach((file) => tray.addFile(file));
    // 같은 파일을 다시 골라도 change가 다시 발생하도록 값을 비워둔다.
    target.value = '';
  };

  // capture: true — WebChat의 입력창/파일input이 이벤트를 받기 전에, 상위
  // container 단계에서 먼저 가로챈다. (bubble 단계에 달면 WebChat이 이미
  // 전파를 막아버려 우리 핸들러가 호출조차 되지 않았다.)
  container.addEventListener('paste', handlePaste, true);
  container.addEventListener('change', handleFileInputChange, true);
  // 혹시 포커스/파일input이 container 트리 바깥에 있을 때도 동작하도록 보강.
  document.addEventListener('paste', handlePaste, true);
  document.addEventListener('change', handleFileInputChange, true);
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

  const store = window.WebChat.createStore({}, ({ dispatch }) => (next) => (action) => {
    // 항상(초기값이 비어 있어도) 연결 직후 숨김 컨텍스트 메시지를 보낸다 — 교사용처럼
    // 별도 설정 화면이 없어 initialValue가 {}인 경우에도 이 메시지가 "사용자의 첫
    // 메시지" 역할을 해서 에이전트가 Instruction의 시작 인사/맥락 확인 로직을 바로
    // 시작한다. 예전에는 initialValue가 비어 있으면 이 메시지 자체를 안 보냈는데,
    // 그러면 교사가 먼저 뭔가 보내기 전까지 에이전트가 전혀 응답하지 않았다
    // (Direct Line/Copilot Studio는 사용자 메시지 없이 먼저 말을 걸지 않는다).
    if (action.type === 'DIRECT_LINE/CONNECT_FULFILLED') {
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
      '"Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',

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

  // 채팅창에 스크린샷을 붙여넣거나 📎 버튼으로 파일을 고르면, 바로 전송하지 않고
  // 미리보기 tray에 담았다가 학생/교사가 확인 후 보낼 수 있도록 연결한다.
  container.style.position = 'relative';
  setupAttachmentInterception(container, directLine, userId, agent);

  return {
    // 웹앱 UI(예: 진행 상황 패널의 "파일로 저장하기" 버튼)에서 호출한다.
    // Instruction 9번 규칙대로 "저장해줘"에 해당하는 문장을 학생이 직접 보낸
    // 것처럼 실제 메시지로 보내, 에이전트가 진행 상황 요약(.md) 파일을 만들어
    // 채팅으로 돌려주게 한다 — 화면에서 숨기지 않고 평소 메시지처럼 보인다.
    requestProgressFile() {
      store.dispatch({
        type: 'WEB_CHAT/SEND_MESSAGE',
        payload: { text: '지금까지 진행 상황을 파일로 저장해줘.' },
      });
    },
  };
}
