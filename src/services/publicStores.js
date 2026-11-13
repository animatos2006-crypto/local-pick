import { API_ENDPOINTS, apiJson } from './apiClient';

const REGION_NAMES = {
  서울특별시: '서울', 경기도: '경기', 부산광역시: '부산', 대구광역시: '대구', 대전광역시: '대전',
  광주광역시: '광주', 제주특별자치도: '제주', 인천광역시: '인천', 울산광역시: '울산',
  세종특별자치시: '세종', 강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북',
  충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남',
  경상북도: '경북', 경상남도: '경남',
};
const BRAND_PATTERN = /(스타벅스|투썸플레이스|메가MGC|메가커피|이디야|컴포즈커피|빽다방|파리바게뜨|뚜레쥬르|맥도날드|롯데리아|버거킹|서브웨이|교촌치킨|BBQ|BHC|굽네치킨)/i;

function normalizePublicStore(item) {
  const name = [item.bizesNm, item.brchNm].filter(Boolean).join(' ').trim();
  const categoryText = `${item.indsMclsNm || ''} ${item.indsSclsNm || ''}`;
  const isCafe = /카페|커피|다방|찻집/.test(categoryText);
  const category = isCafe ? '카페' : /한식/.test(categoryText) ? '한식' : /중식/.test(categoryText) ? '중식' : /일식/.test(categoryText) ? '일식' : /서양|양식/.test(categoryText) ? '양식' : /분식/.test(categoryText) ? '분식' : '음식점';
  return {
    id: `public-${item.bizesId}`, externalId: item.bizesId, name,
    region: REGION_NAMES[item.ctprvnNm] || item.ctprvnNm || '기타', district: item.signguNm || '전체',
    lat: Number(item.lat), lng: Number(item.lon), category,
    type: BRAND_PATTERN.test(name) ? 'brand' : 'independent', source: 'hidden',
    tags: [item.indsMclsNm, item.indsSclsNm].filter(Boolean), menus: [item.indsSclsNm || item.indsMclsNm || category],
    price: 2, address: item.rdnmAdr || item.lnoAdr || '', updatedAt: new Date().toISOString().slice(0, 10),
    isLive: true, publicSource: true,
  };
}

export async function searchPublicStores(bounds) {
  if (!bounds) return [];
  const center = bounds.getCenter();
  const radius = Math.max(300, Math.min(20000, Math.round(center.distanceTo(bounds.getNorthEast()))));
  const requestPage = async (pageNo) => {
    const params = new URLSearchParams({ cx: String(center.lng), cy: String(center.lat), radius: String(radius), indsLclsCd: 'I2', numOfRows: '1000', pageNo: String(pageNo), type: 'json' });
    const data = await apiJson(API_ENDPOINTS.publicData.nearbyStores(params), '공공데이터 조회 실패');
    if (data.header?.resultCode !== '00') throw new Error(data.header?.resultMsg || '공공데이터 조회 실패');
    return data;
  };
  const firstPage = await requestPage(1);
  const totalCount = Number(firstPage.body?.totalCount || 0);
  const pageCount = Math.min(3, Math.max(1, Math.ceil(totalCount / 1000)));
  const remainingPages = pageCount > 1 ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => requestPage(index + 2))) : [];
  const items = [firstPage, ...remainingPages].flatMap((data) => {
    const rawItems = data.body?.items;
    return Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  });
  return [...new Map(items.map((item) => [item.bizesId, item])).values()]
    .map(normalizePublicStore)
    .filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function normalizedName(value) {
  return value.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^0-9a-z가-힣]/g, '').replace(/(본점|지점)$/g, '');
}
function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function mergeStoreSources(kakaoStores, publicStores) {
  const matchedPublicIds = new Set();
  const kakaoMerged = kakaoStores.map((kakao) => {
    const kakaoName = normalizedName(kakao.name);
    const match = publicStores.find((publicStore) => {
      if (matchedPublicIds.has(publicStore.id) || distanceMeters(kakao, publicStore) > 80) return false;
      const publicName = normalizedName(publicStore.name);
      return kakaoName === publicName || (kakaoName.length >= 4 && publicName.length >= 4 && (kakaoName.includes(publicName) || publicName.includes(kakaoName)));
    });
    if (!match) return kakao;
    matchedPublicIds.add(match.id);
    return { ...kakao, source: 'verified', publicId: match.externalId, tags: [...new Set([...kakao.tags, ...match.tags])] };
  });
  return [...kakaoMerged, ...publicStores.filter((item) => !matchedPublicIds.has(item.id))];
}
