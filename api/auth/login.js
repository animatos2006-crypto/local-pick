import { passwordMatches, setSessionCookie } from '../../server/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
  try {
    if (!passwordMatches(req.body?.password || '')) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    setSessionCookie(res);
    return res.status(200).json({ authenticated: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

