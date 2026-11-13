import { clearSessionCookie } from '../../server/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
  clearSessionCookie(res);
  return res.status(200).json({ authenticated: false });
}

