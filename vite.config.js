import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/kakao': {
          target: 'https://dapi.kakao.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/kakao/, ''),
          headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
        },
        '/api/public': {
          target: 'https://apis.data.go.kr',
          changeOrigin: true,
          rewrite: (path) => {
            const upstreamPath = path.replace(/^\/api\/public/, '');
            return `${upstreamPath}${upstreamPath.includes('?') ? '&' : '?'}serviceKey=${encodeURIComponent(env.PUBLIC_DATA_SERVICE_KEY)}`;
          },
        },
        '/api/naver': {
          target: 'https://naverapihub.apigw.ntruss.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/naver/, ''),
          headers: {
            'X-NCP-APIGW-API-KEY-ID': env.NAVER_API_HUB_CLIENT_ID,
            'X-NCP-APIGW-API-KEY': env.NAVER_API_HUB_CLIENT_SECRET,
          },
        },
        '/api/seoul-subway': {
          target: 'http://swopenapi.seoul.go.kr',
          changeOrigin: true,
          rewrite: (path) => {
            const lineName = path.replace(/^\/api\/seoul-subway\/realtimePosition\//, '');
            return `/api/subway/${env.SEOUL_SUBWAY_API_KEY}/json/realtimePosition/0/100/${lineName}`;
          },
        },
        '/api/seoul-bus-route': {
          target: 'http://ws.bus.go.kr',
          changeOrigin: true,
          rewrite: (path) => `${path.replace(/^\/api\/seoul-bus-route/, '/api/rest/busRouteInfo/getBusRouteList')}&serviceKey=${encodeURIComponent(env.SEOUL_BUS_API_KEY)}`,
        },
        '/api/seoul-bus-position': {
          target: 'http://ws.bus.go.kr',
          changeOrigin: true,
          rewrite: (path) => `${path.replace(/^\/api\/seoul-bus-position/, '/api/rest/buspos/getBusPosByRtid')}&serviceKey=${encodeURIComponent(env.SEOUL_BUS_API_KEY)}`,
        },
        '/api/seoul-rtd': {
          target: 'https://data.seoul.go.kr',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/seoul-rtd/, '/SeoulRtd/api'),
          headers: {
            Referer: 'https://data.seoul.go.kr/SeoulRtd/map',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
          },
        },
        '/api/seoul-citydata': {
          target: 'http://openapi.seoul.go.kr:8088',
          changeOrigin: true,
          rewrite: (path) => {
            const areaName = path.replace(/^\/api\/seoul-citydata\//, '');
            return `/${env.SEOUL_CITYDATA_INTEGRATED_API_KEY}/json/citydata/1/5/${areaName}`;
          },
        },
        '/api/seoul-population': {
          target: 'http://openapi.seoul.go.kr:8088',
          changeOrigin: true,
          rewrite: (path) => {
            const areaName = path.replace(/^\/api\/seoul-population\//, '');
            return `/${env.SEOUL_CITYDATA_API_KEY}/json/citydata_ppltn/1/5/${areaName}`;
          },
        },
        '/api/road-traffic': {
          target: 'https://openapi.its.go.kr:9443',
          changeOrigin: true,
          rewrite: (path) => `${path.replace(/^\/api\/road-traffic/, '')}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(env.NATIONAL_ROAD_API_KEY)}`,
        },
      },
    },
  };
});
