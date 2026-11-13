import { API_ENDPOINTS, apiJson } from './apiClient';

function collectPoints(route, mode) {
  const steps = mode === 'publictraffic'
    ? route?.steps || []
    : (route?.legs || []).flatMap((leg) => leg.steps || []);
  return steps.flatMap((step) => step.path?.points || []).map(([lng, lat]) => [lat, lng]);
}

function collectSegments(route, mode) {
  const steps = mode === 'publictraffic'
    ? route?.steps || []
    : (route?.legs || []).flatMap((leg) => leg.steps || []);
  return steps.map((step) => {
    const properties = step.properties || {};
    const vehicles = (properties.vehicles || []).map((vehicle) => vehicle.name).filter(Boolean);
    const stops = properties.stops || [];
    return {
      type: mode === 'publictraffic' ? properties.type : mode === 'bicycle' ? 'BICYCLE' : 'WALKING',
      guidance: properties.guidance || '',
      vehicles,
      from: stops[0]?.name,
      to: stops.at(-1)?.name,
      stops: stops.map((stop) => stop.name).filter(Boolean),
      points: (step.path?.points || []).map(([lng, lat]) => [lat, lng]),
      time: properties.time || 0,
      distance: properties.distance || 0,
    };
  }).filter((segment) => segment.guidance || segment.vehicles.length);
}

function normalizeRoute(route, mode) {
  const properties = route.properties || {};
  return {
    points: collectPoints(route, mode),
    distance: properties.totalDistance || 0,
    time: properties.totalTime || 0,
    transfers: properties.transfers,
    fare: properties.fare?.value,
    routeType: properties.type,
    segments: collectSegments(route, mode),
  };
}

export async function findKakaoRoute({ start, end, mode }) {
  const params = new URLSearchParams({
    start_x: String(start.lng), start_y: String(start.lat),
    end_x: String(end.lng), end_y: String(end.lat),
    s_name: '선택한 출발지', e_name: end.name,
    input_coord: 'WGS84', output_coord: 'WGS84',
  });
  const data = await apiJson(API_ENDPOINTS.kakao.route(mode, params), '경로 조회 실패');
  if (data.status !== 'OK') throw new Error(data.status || '경로를 찾을 수 없습니다.');
  const route = mode === 'publictraffic' ? data.routes?.[0] : data.route;
  if (!route) throw new Error('경로를 찾을 수 없습니다.');
  const alternatives = mode === 'publictraffic' ? (data.routes || []).slice(0, 5).map((item) => normalizeRoute(item, mode)) : [];
  return { ...normalizeRoute(route, mode), alternatives };
}
