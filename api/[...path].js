import { isAuthenticated } from '../server/auth.js';

const requestWindows = new Map();
const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`서버 환경변수 ${name}이 설정되지 않았습니다.`);
  return value;
};
const addParam = (url, name, value) => { url.searchParams.set(name, value); return url; };

function isRateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestWindows.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  requestWindows.set(ip, recent);
  return recent.length > 120;
}

function resolveUpstream(requestUrl) {
  const incoming = new URL(requestUrl, 'https://localpick.invalid');
  const { pathname, search } = incoming;
  const headers = { Accept: 'application/json, application/xml, text/xml, */*' };
  if (pathname.startsWith('/api/kakao/')) {
    headers.Authorization = `KakaoAK ${requireEnv('KAKAO_REST_API_KEY')}`;
    return { url: new URL(`${pathname.replace('/api/kakao', 'https://dapi.kakao.com')}${search}`), headers };
  }
  if (pathname.startsWith('/api/public/')) {
    const url = new URL(`${pathname.replace('/api/public', 'https://apis.data.go.kr')}${search}`);
    return {
      url: addParam(
        url,
        'serviceKey',
        process.env.DATA_SERVICE_KEY || requireEnv('PUBLIC_DATA_SERVICE_KEY'),
      ),
      headers,
    };
  }
  if (pathname.startsWith('/api/naver/')) {
    headers['X-NCP-APIGW-API-KEY-ID'] = requireEnv('NAVER_API_HUB_CLIENT_ID');
    headers['X-NCP-APIGW-API-KEY'] = requireEnv('NAVER_API_HUB_CLIENT_SECRET');
    return { url: new URL(`${pathname.replace('/api/naver', 'https://naverapihub.apigw.ntruss.com')}${search}`), headers };
  }
  if (pathname.startsWith('/api/seoul-subway/realtimePosition/')) {
    const lineName = pathname.replace('/api/seoul-subway/realtimePosition/', '');
    return { url: new URL(`http://swopenapi.seoul.go.kr/api/subway/${requireEnv('SEOUL_SUBWAY_API_KEY')}/json/realtimePosition/0/100/${lineName}${search}`), headers };
  }
  if (pathname === '/api/seoul-bus-route') {
    const url = new URL(`http://ws.bus.go.kr/api/rest/busRouteInfo/getBusRouteList${search}`);
    return { url: addParam(url, 'serviceKey', requireEnv('SEOUL_BUS_API_KEY')), headers };
  }
  if (pathname === '/api/seoul-bus-position') {
    const url = new URL(`http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid${search}`);
    return { url: addParam(url, 'serviceKey', requireEnv('SEOUL_BUS_API_KEY')), headers };
  }
  if (pathname.startsWith('/api/seoul-rtd/')) {
    headers.Referer = 'https://data.seoul.go.kr/SeoulRtd/map';
    headers['X-Requested-With'] = 'XMLHttpRequest';
    return { url: new URL(`${pathname.replace('/api/seoul-rtd', 'https://data.seoul.go.kr/SeoulRtd/api')}${search}`), headers };
  }
  if (pathname.startsWith('/api/seoul-citydata/')) {
    const areaName = pathname.replace('/api/seoul-citydata/', '');
    return { url: new URL(`http://openapi.seoul.go.kr:8088/${requireEnv('SEOUL_CITYDATA_INTEGRATED_API_KEY')}/json/citydata/1/5/${areaName}${search}`), headers };
  }
  if (pathname.startsWith('/api/seoul-population/')) {
    const areaName = pathname.replace('/api/seoul-population/', '');
    return { url: new URL(`http://openapi.seoul.go.kr:8088/${requireEnv('SEOUL_CITYDATA_API_KEY')}/json/citydata_ppltn/1/5/${areaName}${search}`), headers };
  }
  if (pathname.startsWith('/api/road-traffic/')) {
    const url = new URL(`${pathname.replace('/api/road-traffic', 'https://openapi.its.go.kr:9443')}${search}`);
    return { url: addParam(url, 'apiKey', requireEnv('NATIONAL_ROAD_API_KEY')), headers };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
  if (!isAuthenticated(req)) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (isRateLimited(req)) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
  try {
    const upstream = resolveUpstream(req.url);
    if (!upstream) return res.status(404).json({ error: '알 수 없는 API 경로입니다.' });
    const response = await fetch(upstream.url, { headers: upstream.headers, redirect: 'follow' });
    const body = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(500).json({ error: '외부 API 연결에 실패했습니다.', message: error.message });
  }
}

