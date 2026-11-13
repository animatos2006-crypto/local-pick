import { API_ENDPOINTS, apiText } from './apiClient';

const normalizeRouteName = (value = '') => String(value)
  .replace(/^(서울|간선|지선|마을|광역|순환|심야|공항)(버스)?\s*[:·-]?\s*/g, '')
  .replace(/^버스\s*[:·-]?\s*/g, '')
  .replace(/\s*번(?:\s*버스)?$/g, '')
  .replace(/\s+/g, '')
  .toUpperCase();

function parseXmlItems(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('서울 버스 응답을 해석하지 못했습니다.');
  const code = document.querySelector('headerCd')?.textContent?.trim();
  const message = document.querySelector('headerMsg')?.textContent?.trim();
  if (code && !['0', '00'].includes(code)) throw new Error(message || '서울 버스 정보를 불러오지 못했습니다.');
  return [...document.querySelectorAll('itemList')];
}

const text = (item, name) => item.querySelector(name)?.textContent?.trim() || '';

async function fetchXml(url) {
  return parseXmlItems(await apiText(url, '서울 버스 조회 실패'));
}

export async function fetchRealtimeBusPositions(routeName) {
  const query = normalizeRouteName(routeName);
  if (!query) return [];

  const routes = await fetchXml(API_ENDPOINTS.transit.busRoutes(query));
  const candidates = routes.map((item) => ({
    id: text(item, 'busRouteId'),
    name: text(item, 'busRouteNm'),
    start: text(item, 'stStationNm'),
    end: text(item, 'edStationNm'),
  })).filter((route) => route.id);
  const route = candidates.find((item) => normalizeRouteName(item.name) === query)
    || candidates.find((item) => normalizeRouteName(item.name).includes(query) || query.includes(normalizeRouteName(item.name)))
    || candidates[0];
  if (!route) throw new Error(`${routeName} 노선은 서울시 실시간 버스에서 찾지 못했습니다.`);

  const positions = await fetchXml(API_ENDPOINTS.transit.busPositions(route.id));
  return positions.map((item) => ({
    vehicleId: text(item, 'vehId') || text(item, 'plainNo'),
    plateNumber: text(item, 'plainNo'),
    lat: Number(text(item, 'gpsY') || text(item, 'tmY')),
    lng: Number(text(item, 'gpsX') || text(item, 'tmX')),
    stopFlag: text(item, 'stopFlag') === '1',
    lastVehicle: text(item, 'islastyn') === '1',
    receivedAt: text(item, 'dataTm'),
    routeName: route.name,
    routeStart: route.start,
    routeEnd: route.end,
  })).filter((bus) => Number.isFinite(bus.lat) && Number.isFinite(bus.lng) && bus.lat > 30 && bus.lng > 120);
}
