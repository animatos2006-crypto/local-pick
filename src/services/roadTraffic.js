import { API_ENDPOINTS, apiJson } from './apiClient';

export async function fetchRoadTraffic(bounds) {
  const params = new URLSearchParams({
    type: 'all',
    minX: String(bounds.getWest()),
    maxX: String(bounds.getEast()),
    minY: String(bounds.getSouth()),
    maxY: String(bounds.getNorth()),
    getType: 'json',
  });
  const data = await apiJson(API_ENDPOINTS.road.traffic(params), '도로 소통정보를 불러오지 못했습니다.');
  if (String(data.header?.resultCode) !== '0') throw new Error(data.header?.resultMsg || '도로 소통정보 오류');
  const items = Array.isArray(data.body?.items) ? data.body.items : data.body?.items ? [data.body.items] : [];
  const measured = items.filter((item) => Number(item.speed) > 0);
  if (!measured.length) return { status: '정보 없음', averageSpeed: null, count: 0, slowRoads: [] };
  const averageSpeed = Math.round(measured.reduce((sum, item) => sum + Number(item.speed), 0) / measured.length);
  const status = averageSpeed < 20 ? '정체' : averageSpeed < 35 ? '서행' : '원활';
  const slowRoads = [...new Map(measured.filter((item) => item.roadName).sort((a, b) => Number(a.speed) - Number(b.speed)).map((item) => [item.roadName, item])).values()]
    .slice(0, 3)
    .map((item) => ({ name: item.roadName, speed: Math.round(Number(item.speed)) }));
  return { status, averageSpeed, count: measured.length, slowRoads };
}
