import { API_ENDPOINTS, apiJson } from './apiClient';

export async function fetchSeoulCongestionAreas(query = '') {
  const params = new URLSearchParams({ hotspotNm: query });
  const data = await apiJson(API_ENDPOINTS.seoul.congestion(params), '서울 실시간 혼잡도를 불러오지 못했습니다.');
  return (data.row || []).map((item) => ({
    name: item.area_nm,
    level: item.area_congest_lvl,
    color: item.congestion_color,
    category: item.category,
    lat: Number(item.x),
    lng: Number(item.y),
    rank: Number(item.area_congest_num),
  })).filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function findNearbyCongestion(store, areas, maxDistance = 1200) {
  if (store.region !== '서울' || !areas.length) return null;
  const nearest = areas.reduce((best, area) => {
    const distance = distanceMeters(store, area);
    return !best || distance < best.distance ? { ...area, distance } : best;
  }, null);
  return nearest && nearest.distance <= maxDistance ? nearest : null;
}
