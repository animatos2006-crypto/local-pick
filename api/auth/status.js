import { isAuthenticated } from '../../server/auth.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
  const authenticated = isAuthenticated(req);
  return res.status(authenticated ? 200 : 401).json({ authenticated });
}

