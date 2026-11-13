import { API_ENDPOINTS, apiJson } from './apiClient';

export async function fetchRealtimeSubwayPositions(lineName) {
  if (!lineName) return [];
  const data = await apiJson(API_ENDPOINTS.transit.subwayPositions(lineName), '실시간 지하철 조회 실패');
  if (data.errorMessage?.code !== 'INFO-000') throw new Error(data.errorMessage?.message || '실시간 지하철 정보를 불러오지 못했습니다.');
  return (data.realtimePositionList || []).map((item) => ({
    trainNo: item.trainNo,
    station: item.statnNm,
    destination: item.statnTnm,
    direction: item.updnLine,
    status: item.trainSttus,
    receivedAt: item.recptnDt,
  }));
}
