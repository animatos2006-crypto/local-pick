import { API_ENDPOINTS, apiJson } from './apiClient';

const first = (value) => Array.isArray(value) ? value[0] : value;
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
const number = (value) => Number(value) || 0;

export async function fetchSeoulCityData(areaName) {
  let data;
  try {
    data = await apiJson(API_ENDPOINTS.seoul.cityData(areaName), '서울 통합 도시데이터를 불러오지 못했습니다.');
  } catch {
    return fetchPopulationFallback(areaName);
  }
  const city = data.CITYDATA;
  if (!city) return fetchPopulationFallback(areaName);

  const population = first(city.LIVE_PPLTN_STTS) || {};
  const commercial = first(city.LIVE_CMRCL_STTS) || {};
  const subway = first(city.LIVE_SUB_PPLTN) || {};
  const bus = first(city.LIVE_BUS_PPLTN) || {};
  const events = list(city.EVENT_STTS).filter((event) => event.EVENT_NM);
  const subwayArrivals = number(subway.SUB_30WTHN_GTOFF_PPLTN_MAX);
  const busArrivals = number(bus.BUS_30WTHN_GTOFF_PPLTN_MAX);
  const transitArrivals = subwayArrivals + busArrivals;
  const reasons = [];

  if (events.length) reasons.push({ type: 'confirmed', title: `인근 행사 ${events.length}건 확인`, detail: events.slice(0, 3).map((event) => event.EVENT_NM).join(' · ') });
  if (['바쁨', '분주'].includes(commercial.AREA_CMRCL_LVL)) reasons.push({ type: 'inferred', title: `상권이 ${commercial.AREA_CMRCL_LVL} 시간대입니다`, detail: '최근 카드 소비 활동이 평소보다 활발한 지역입니다.' });
  if (transitArrivals >= 1000) reasons.push({ type: 'inferred', title: '대중교통 유입이 많습니다', detail: `최근 30분 하차 추정 최대 ${transitArrivals.toLocaleString()}명` });
  if (!reasons.length) reasons.push({ type: 'neutral', title: '뚜렷한 행사·상권 원인은 확인되지 않았습니다', detail: '시간대와 일상적인 지역 유동인구의 영향일 수 있습니다.' });

  return {
    areaName: city.AREA_NM,
    level: population.AREA_CONGEST_LVL,
    message: population.AREA_CONGEST_MSG,
    updatedAt: population.PPLTN_TIME,
    reasons,
    events: events.slice(0, 3).map((event) => ({ name: event.EVENT_NM, place: event.EVENT_PLACE, period: event.EVENT_PERIOD, url: event.EVENT_URL })),
  };
}

async function fetchPopulationFallback(areaName) {
  const data = await apiJson(API_ENDPOINTS.seoul.population(areaName), '혼잡 원인 데이터를 불러오지 못했습니다.');
  const rows = data['SeoulRtd.citydata_ppltn'];
  const population = Array.isArray(rows) ? rows[0] : rows;
  if (!population) throw new Error(data.RESULT?.MESSAGE || '혼잡 원인 정보가 없습니다.');
  return {
    areaName: population.AREA_NM,
    level: population.AREA_CONGEST_LVL,
    message: population.AREA_CONGEST_MSG,
    updatedAt: population.PPLTN_TIME,
    reasons: [{ type: 'neutral', title: '통합 데이터 대신 인구 혼잡도로 확인했습니다', detail: '행사·상권·교통 원인은 일시적으로 확인할 수 없습니다.' }],
    events: [],
    fallback: true,
  };
}
