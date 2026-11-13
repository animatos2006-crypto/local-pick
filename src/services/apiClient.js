const withQuery = (path, params) => {
  if (!params) return path;
  const search = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

export const API_ENDPOINTS = {
  kakao: {
    local: (path, params) => withQuery(`/api/kakao${path}`, params),
    route: (mode, params) => withQuery(`/api/kakao/v2/routing/${mode}`, params),
    regionSearch: (params) => withQuery('/api/kakao/v2/local/search/keyword.json', params),
    reverseGeocode: (params) => withQuery('/api/kakao/v2/local/geo/coord2regioncode.json', params),
  },
  naver: {
    localSearch: (params) => withQuery('/api/naver/search/v1/local', params),
  },
  publicData: {
    nearbyStores: (params) => withQuery('/api/public/B553077/api/open/sdsc2/storeListInRadius', params),
  },
  transit: {
    subwayPositions: (lineName) => `/api/seoul-subway/realtimePosition/${encodeURIComponent(lineName)}`,
    busRoutes: (routeName) => withQuery('/api/seoul-bus-route', { strSrch: routeName }),
    busPositions: (routeId) => withQuery('/api/seoul-bus-position', { busRouteId: routeId }),
  },
  seoul: {
    congestion: (params) => withQuery('/api/seoul-rtd/hotspot', params),
    cityData: (areaName) => `/api/seoul-citydata/${encodeURIComponent(areaName)}`,
    population: (areaName) => `/api/seoul-population/${encodeURIComponent(areaName)}`,
  },
  road: {
    traffic: (params) => withQuery('/api/road-traffic/trafficInfo', params),
  },
};

export async function apiRequest(url, { format = 'json', errorMessage = 'API 요청에 실패했습니다.' } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`${errorMessage} (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return format === 'text' ? response.text() : response.json();
}

export const apiJson = (url, errorMessage) => apiRequest(url, { errorMessage });
export const apiText = (url, errorMessage) => apiRequest(url, { format: 'text', errorMessage });
