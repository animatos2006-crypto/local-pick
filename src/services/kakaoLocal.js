import { API_ENDPOINTS, apiJson } from './apiClient';

const REGION_NAMES = {
  서울특별시: '서울', 서울: '서울', 경기도: '경기', 경기: '경기',
  부산광역시: '부산', 부산: '부산', 대구광역시: '대구', 대구: '대구',
  대전광역시: '대전', 대전: '대전', 광주광역시: '광주', 광주: '광주',
  제주특별자치도: '제주', 제주: '제주', 인천광역시: '인천', 인천: '인천',
  울산광역시: '울산', 울산: '울산', 세종특별자치시: '세종', 세종: '세종',
  강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북', 충청남도: '충남',
  전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
};

function normalizePlace(place) {
  const address = place.road_address_name || place.address_name || '';
  const parts = address.split(' ').filter(Boolean);
  const categoryPath = place.category_name?.split(' > ') || [];
  const detailCategory = categoryPath.at(-1) || place.category_group_name || '음식점';
  const isCafe = place.category_group_code === 'CE7';
  const broadCategory = ['한식', '중식', '일식', '양식', '분식'].find((item) => categoryPath.some((part) => part.includes(item)));
  const brandPattern = /(스타벅스|투썸플레이스|메가MGC|메가커피|이디야|컴포즈커피|빽다방|파리바게뜨|뚜레쥬르|맥도날드|롯데리아|버거킹|서브웨이|교촌치킨|BBQ|BHC|굽네치킨)/i;
  return {
    id: `kakao-${place.id}`, externalId: place.id, name: place.place_name,
    region: REGION_NAMES[parts[0]] || parts[0] || '기타', district: parts[1] || '전체',
    lat: Number(place.y), lng: Number(place.x), category: isCafe ? '카페' : broadCategory || detailCategory,
    type: brandPattern.test(place.place_name) ? 'brand' : 'independent', source: 'place', tags: isCafe ? ['카페'] : [detailCategory],
    menus: [detailCategory], price: 2, address, phone: place.phone || '',
    placeUrl: place.place_url || '', updatedAt: new Date().toISOString().slice(0, 10), isLive: true,
  };
}

async function requestPages(path, params, maxPages = 3) {
  const results = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const search = new URLSearchParams({ ...params, page: String(page), size: '15' });
    const data = await apiJson(API_ENDPOINTS.kakao.local(path, search), '카카오 장소 검색 실패');
    results.push(...(data.documents || []));
    if (data.meta?.is_end) break;
  }
  return results;
}

function boundsToRect(bounds) {
  if (!bounds) return null;
  const sw = bounds.getSouthWest(); const ne = bounds.getNorthEast();
  return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
}

export async function searchKakaoPlaces({ bounds, query, category, nationwide = false }) {
  const viewportRect = boundsToRect(bounds);
  if (!query && !viewportRect) return [];
  let documents = [];
  if (query) {
    const commonParams = {
      query,
      ...(category === '카페' ? { category_group_code: 'CE7' } : {}),
      ...(category === '음식점' ? { category_group_code: 'FD6' } : {}),
    };
    if (nationwide && viewportRect) {
      const [nationwideResults, viewportResults] = await Promise.all([
        requestPages('/v2/local/search/keyword.json', commonParams),
        requestPages('/v2/local/search/keyword.json', { ...commonParams, rect: viewportRect }),
      ]);
      documents = [...viewportResults, ...nationwideResults];
    } else {
      documents = await requestPages('/v2/local/search/keyword.json', { ...commonParams, ...(viewportRect ? { rect: viewportRect } : {}) });
    }
  } else {
    const codes = category === '카페' ? ['CE7'] : category === '음식점' ? ['FD6'] : ['FD6', 'CE7'];
    const pages = await Promise.all(codes.map((code) => requestPages('/v2/local/search/category.json', { category_group_code: code, rect: viewportRect, sort: 'accuracy' }, 2)));
    documents = pages.flat();
  }
  return [...new Map(documents.map((item) => [item.id, item])).values()].map(normalizePlace).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export async function searchRegionLocations(region, query) {
  const search = new URLSearchParams({ query: `${region === '전국' ? '' : region} ${query}`.trim(), page: '1', size: '10' });
  const data = await apiJson(API_ENDPOINTS.kakao.regionSearch(search), '세부 지역 검색에 실패했습니다.');
  return (data.documents || []).map((item) => {
    const address = item.road_address_name || item.address_name || '';
    const parts = address.split(' ').filter(Boolean);
    return { id: item.id, name: item.place_name, address, lat: Number(item.y), lng: Number(item.x), district: parts[1] || '전체' };
  }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export async function reverseGeocodeKakao(lat, lng) {
  const search = new URLSearchParams({ x: String(lng), y: String(lat) });
  const data = await apiJson(API_ENDPOINTS.kakao.reverseGeocode(search), '현재 지도 위치를 확인하지 못했습니다.');
  const region = (data.documents || []).find((item) => item.region_type === 'H') || data.documents?.[0];
  if (!region) return null;
  const firstDepth = REGION_NAMES[region.region_1depth_name] || region.region_1depth_name;
  return {
    region: firstDepth,
    district: region.region_2depth_name || '',
    neighborhood: region.region_3depth_name || '',
    label: [firstDepth, region.region_2depth_name, region.region_3depth_name].filter(Boolean).join(' '),
  };
}
