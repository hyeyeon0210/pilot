// api/token.js
// Vercel Serverless Function
//
// 브라우저는 이 엔드포인트만 호출합니다. 실제 Direct Line Secret은
// Vercel 프로젝트의 Environment Variables에만 저장되고, 이 함수(서버)
// 안에서만 사용되므로 GitHub 저장소나 클라이언트 JS에는 절대 노출되지 않습니다.
//
// 사용법: /api/token?agent=student  또는  /api/token?agent=teacher
//
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables에 등록):
//   pilot_learning_coach_agent    — Pilot Learning Coach의 Direct Line Secret
//   pilot_management_coach_agent — Pilot Management Coach의 Direct Line Secret

const SECRET_ENV_BY_AGENT = {
  student: 'pilot_learning_coach_agent',
  teacher: 'pilot_management_coach_agent',
};

module.exports = async function handler(req, res) {
  const agent = req.query.agent;

  if (agent !== 'student' && agent !== 'teacher') {
    res.status(400).json({ error: 'agent 파라미터는 student 또는 teacher여야 합니다.' });
    return;
  }

  const envName = SECRET_ENV_BY_AGENT[agent];
  const secret = process.env[envName];

  if (!secret) {
    res.status(500).json({
      error: `${envName} 환경변수가 설정되지 않았습니다. Vercel 프로젝트 > Settings > Environment Variables에서 등록한 뒤 다시 배포해주세요.`,
    });
    return;
  }

  try {
    const dlResponse = await fetch('https://directline.botframework.com/v3/directline/tokens/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });

    if (!dlResponse.ok) {
      const detail = await dlResponse.text();
      res.status(dlResponse.status).json({ error: 'Direct Line 토큰 발급에 실패했습니다.', detail });
      return;
    }

    const data = await dlResponse.json();

    // 토큰은 짧은 수명(기본 1시간)의 1회성 자격이라 캐시하지 않습니다.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ token: data.token, expires_in: data.expires_in });
  } catch (err) {
    res.status(500).json({ error: '토큰 발급 중 오류가 발생했습니다.', detail: String(err) });
  }
};
