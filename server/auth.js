import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'localpick_session';
const SESSION_SUBJECT = 'localpick-owner';

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`서버 환경변수 ${name}이 설정되지 않았습니다.`);
  return value;
};

const digest = (value) => createHash('sha256').update(String(value)).digest();
const sessionToken = () => createHmac('sha256', requireEnv('LOCALPICK_AUTH_SECRET')).update(SESSION_SUBJECT).digest('hex');

export function passwordMatches(input) {
  return timingSafeEqual(digest(input), digest(requireEnv('LOCALPICK_PASSWORD')));
}

export function isAuthenticated(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([name, value]) => name && value));
  const actual = cookies[COOKIE_NAME];
  const expected = sessionToken();
  if (!actual || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function setSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

