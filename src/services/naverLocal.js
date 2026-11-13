import { API_ENDPOINTS, apiJson } from './apiClient';

function stripHtml(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
}

function coordinate(value, longitude = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = Math.abs(number) > (longitude ? 180 : 90) ? number / 10000000 : number;
  return normalized;
}

export async function searchNaverLocal(query, sort = 'random') {
  if (query.trim().length < 2) return [];
  const params = new URLSearchParams({ query: query.trim(), display: '5', start: '1', sort, format: 'json' });
  const data = await apiJson(API_ENDPOINTS.naver.localSearch(params), '네이버 지역 검색 실패');
  return (data.items || []).map((item, index) => ({
    id: `naver-${index}-${item.mapx}-${item.mapy}`,
    name: stripHtml(item.title),
    category: stripHtml(item.category),
    address: item.roadAddress || item.address || '',
    lat: coordinate(item.mapy),
    lng: coordinate(item.mapx, true),
    link: item.link || `https://search.naver.com/search.naver?query=${encodeURIComponent(stripHtml(item.title))}`,
  }));
}
