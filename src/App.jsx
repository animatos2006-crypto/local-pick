import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  ArrowLeft, ArrowLeftRight, Bookmark, Check, ChevronDown, Compass, Dice5, Heart, ListFilter,
  LocateFixed, Map as MapIcon, MapPin, Menu, Navigation, Plus, Search, SlidersHorizontal,
  Sparkles, Star, Store, X,
} from 'lucide-react';
import { districts, regions, sourceLabels, stores } from './data/stores';
import './delete-button.css';
import { useLocalStorage } from './hooks/useLocalStorage';
import { reverseGeocodeKakao, searchKakaoPlaces, searchRegionLocations } from './services/kakaoLocal';
import { mergeStoreSources, searchPublicStores } from './services/publicStores';
import { searchNaverLocal } from './services/naverLocal';
import { findKakaoRoute } from './services/kakaoRouting';
import { fetchRealtimeSubwayPositions } from './services/seoulSubway';
import { fetchRealtimeBusPositions } from './services/seoulBus';
import { fetchSeoulCongestionAreas, findNearbyCongestion } from './services/seoulCongestion';
import { fetchSeoulCityData } from './services/seoulCityData';
import { fetchRoadTraffic } from './services/roadTraffic';
import { getRegionDestinations } from './data/regionDestinations';

const priceText = ['', '₩', '₩₩', '₩₩₩'];
const GENERAL_FOOD_TERMS = /^(음식집|음식점|식당|맛집|먹거리|먹을곳)$/;
const formatRouteTime = (seconds) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${minutes}분`;
  return remainingMinutes ? `${hours}시간 ${remainingMinutes}분` : `${hours}시간`;
};
const SEARCH_ALIASES = {
  치킨집: '치킨', 닭집: '치킨', 빵집: '베이커리', 제과점: '베이커리',
  커피숍: '카페', 찻집: '카페', 술집: '주점', 고깃집: '고기',
};
const LEGACY_COLLECTION_IDS = new Set(['want', 'solo', 'again']);

function getStoreOpenStatus(store, now = new Date()) {
  if (typeof store.isOpen === 'boolean') return store.isOpen ? 'open' : 'closed';
  const schedule = store.openingHours;
  if (!schedule) return 'unknown';
  const daySchedule = Array.isArray(schedule) ? schedule[now.getDay()] : schedule[now.getDay()] ?? schedule[String(now.getDay())];
  if (!daySchedule || daySchedule === 'closed') return 'closed';
  const ranges = Array.isArray(daySchedule) ? daySchedule : [daySchedule];
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const isOpen = ranges.some((range) => {
    const [start, end] = String(range).split('-').map((value) => {
      const [hours, minutes] = value.trim().split(':').map(Number);
      return hours * 60 + minutes;
    });
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return end > start ? minutesNow >= start && minutesNow < end : minutesNow >= start || minutesNow < end;
  });
  return isOpen ? 'open' : 'closed';
}

function normalizedSearchTerm(value) {
  const term = value.trim().toLowerCase().replace(/\s+/g, '');
  return SEARCH_ALIASES[term] || term;
}

function MapController({ region, district, focusStore, focusLocation }) {
  const map = useMap();
  useEffect(() => {
    const target = regions[region] || regions.전국;
    map.flyTo(target.center, district !== '전체' ? Math.max(target.zoom, 12) : target.zoom, { duration: 0.65 });
  }, [map, region, district]);
  useEffect(() => {
    if (focusStore) map.flyTo([focusStore.lat, focusStore.lng], 15, { duration: 0.65 });
  }, [map, focusStore]);
  useEffect(() => {
    if (focusLocation) map.flyTo([focusLocation.lat, focusLocation.lng], 14, { duration: 0.65 });
  }, [map, focusLocation]);
  return null;
}

function NaverResultsController({ stores, focusKey }) {
  const map = useMap();
  const lastFittedKey = useRef('');
  useEffect(() => {
    const points = stores.filter((store) => Number.isFinite(store.lat) && Number.isFinite(store.lng)).map((store) => [store.lat, store.lng]);
    if (points.length === 0) return;
    const nextKey = `${focusKey}|${stores.map((store) => store.id).join(',')}`;
    if (lastFittedKey.current === nextKey) return;
    lastFittedKey.current = nextKey;
    if (points.length === 1) map.flyTo(points[0], 16, { duration: 0.55 });
    if (points.length > 1) map.fitBounds(points, { padding: [55, 55], maxZoom: 16, animate: true, duration: 0.55 });
  }, [map, stores, focusKey]);
  return null;
}

function KakaoSearchResultsController({ stores, query, resultsQuery, onFocused }) {
  const map = useMap();
  const lastMovedQuery = useRef('');
  useEffect(() => {
    const searchKey = query.trim().toLowerCase();
    if (!searchKey) { lastMovedQuery.current = ''; return; }
    if (resultsQuery.trim().toLowerCase() !== searchKey) return;
    if (lastMovedQuery.current === searchKey) return;
    const targets = stores.filter((store) => Number.isFinite(store.lat) && Number.isFinite(store.lng));
    if (targets.length !== 1) return;
    const target = targets[0];
    lastMovedQuery.current = searchKey;
    map.flyTo([target.lat, target.lng], 15, { duration: 0.65 });
    onFocused(target);
  }, [map, stores, query, resultsQuery, onFocused]);
  return null;
}

function MapEvents({ onBusy, onIdle, onBounds, onUserExplore, onMapClick }) {
  const timer = useRef();
  const map = useMapEvents({
    dragstart() { onUserExplore(); },
    zoomstart(event) { if (event.originalEvent) onUserExplore(); },
    click(event) { if (onMapClick) onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng }); },
    movestart() {
      clearTimeout(timer.current);
      onBusy(true);
    },
    moveend() {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const bounds = map.getBounds();
        onBounds(bounds);
        onBusy(false);
        onIdle();
      }, 220);
    },
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}

function RouteController({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length > 1) map.fitBounds(points, { padding: [60, 60], animate: true, duration: 0.55 });
  }, [map, points]);
  return null;
}

function AnimatedRouteVehicle({ segment }) {
  const [pointIndex, setPointIndex] = useState(0);
  const points = segment?.points || [];
  useEffect(() => {
    setPointIndex(0);
    if (points.length < 2) return undefined;
    const step = Math.max(1, Math.ceil(points.length / 140));
    const timer = window.setInterval(() => setPointIndex((index) => (index + step) % points.length), 90);
    return () => window.clearInterval(timer);
  }, [segment, points.length]);
  const icon = useMemo(() => L.divIcon({ className: 'moving-transit-marker', html: `<span>${segment?.type === 'SUBWAY' ? '🚇' : '🚌'}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }), [segment?.type]);
  if (points.length < 2) return null;
  return <Marker position={points[Math.min(pointIndex, points.length - 1)]} icon={icon} interactive={false}/>;
}

function RealtimeSubwayMarker({ train }) {
  const icon = useMemo(() => L.divIcon({ className: 'realtime-subway-marker', html: '<span>🚇</span>', iconSize: [36, 36], iconAnchor: [18, 18] }), []);
  return <Marker position={train.position} icon={icon}><Popup><strong>실시간 열차 {train.trainNo}</strong><br/>{train.station}역 · {train.destination} 방면<br/><small>{train.receivedAt} 기준</small></Popup></Marker>;
}

function RealtimeBusMarker({ bus }) {
  const icon = useMemo(() => L.divIcon({ className: 'realtime-bus-marker', html: '<span>🚌</span>', iconSize: [36, 36], iconAnchor: [18, 18] }), []);
  return <Marker position={[bus.lat, bus.lng]} icon={icon}><Popup><strong>실시간 버스 {bus.routeName}</strong><br/>{bus.plateNumber || '차량번호 정보 없음'}{bus.stopFlag ? ' · 정류소 정차 중' : ' · 운행 중'}<br/><small>{bus.routeStart} → {bus.routeEnd}{bus.receivedAt ? ` · ${bus.receivedAt} 기준` : ''}</small></Popup></Marker>;
}

function StoreMarker({ store, onSelect, faded, congestion }) {
  const hidden = store.source === 'hidden';
  const openStatus = getStoreOpenStatus(store);
  const color = openStatus === 'closed' ? '#4b514e' : hidden ? '#f47b20' : store.type === 'brand' ? '#4864d7' : '#176b4d';
  return (
    <CircleMarker
      center={[store.lat, store.lng]}
      radius={hidden ? 10 : 8}
      pathOptions={{ color: congestion?.color || (openStatus === 'closed' ? '#d5d8d6' : '#fff'), weight: congestion ? 5 : 3, fillColor: color, fillOpacity: faded ? 0.22 : openStatus === 'closed' ? 0.68 : 0.96 }}
      eventHandlers={{ click: () => onSelect(store) }}
    >
      <Popup>
        <strong>{store.name}</strong><br />
        {store.category} · {store.type === 'brand' ? '브랜드' : '개인 가게 추정'}
        {openStatus !== 'unknown' && <><br/><span className={`open-status ${openStatus}`}>{openStatus === 'open' ? '영업 중' : '영업 종료'}</span></>}
        {congestion && <><br/><span className="congestion-popup" style={{ color: congestion.color }}>주변 {congestion.level} · {congestion.name}</span></>}
      </Popup>
    </CircleMarker>
  );
}

function Chip({ active, children, onClick, accent = false }) {
  return <button className={`chip ${active ? 'active' : ''} ${accent ? 'accent' : ''}`} onClick={onClick}>{children}</button>;
}

function StoreCard({ store, saved, onSave, onSelect, congestion }) {
  const openStatus = getStoreOpenStatus(store);
  return (
    <article className={`store-card ${store.source === 'hidden' ? 'hidden-card' : ''} ${openStatus === 'closed' ? 'store-closed' : ''}`} onClick={() => onSelect(store)}>
      <div className="card-topline card-actions-only">
        <button className={`icon-button save ${saved ? 'saved' : ''}`} aria-label="저장" onClick={(e) => { e.stopPropagation(); onSave(store); }}>
          <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <h3>{store.name}{openStatus !== 'unknown' && <span className={`open-status ${openStatus}`}>{openStatus === 'open' ? '영업 중' : '영업 종료'}</span>}</h3>
      {congestion && <div className="congestion-badge" style={{ '--congestion-color': congestion.color }}><span/>{congestion.name} 주변 · {congestion.level}<small>매장 내부가 아닌 지역 기준</small></div>}
      <p className="store-meta">{store.type === 'brand' ? '브랜드' : '개인 가게 추정'} · {store.category} · {priceText[store.price]}</p>
      <p className="store-address"><MapPin size={14} /> {store.region} {store.district}</p>
      <div className="tag-row">{store.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div>
    </article>
  );
}

function RegionPicker({ region, district, onRegion, onDistrict, onClose }) {
  return (
    <div className="region-popover">
      <div className="popover-head"><strong>검색 지역</strong><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
      <div className="region-grid">
        {Object.keys(regions).map((name) => <button className={region === name ? 'selected' : ''} key={name} onClick={() => onRegion(name)}>{name}</button>)}
      </div>
      {region !== '전국' && <>
        <p className="popover-label">세부 지역</p>
        <div className="district-grid">
          {(districts[region] || ['전체']).map((name) => <button className={district === name ? 'selected' : ''} key={name} onClick={() => onDistrict(name)}>{name}</button>)}
        </div>
      </>}
      <button className="wide-secondary" onClick={() => { onRegion('전국'); onClose(); }}>전국으로 검색 범위 넓히기</button>
    </div>
  );
}

function RecommendationModal({ candidates, onClose, onSelect, onSave, onRecommend }) {
  const [mode, setMode] = useState('choose');
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState({ category: '상관없음', companion: '상관없음', mood: '상관없음', independent: false, request: '' });
  const [result, setResult] = useState(null);
  const questions = [
    { key: 'category', title: '오늘 무엇을 먹고 싶나요?', options: ['상관없음','한식','중식','일식','양식','분식','카페'] },
    { key: 'companion', title: '누구와 함께 가나요?', options: ['상관없음','혼밥','데이트','가족','친구'] },
    { key: 'mood', title: '원하는 분위기는?', options: ['상관없음','조용한','감성적인','편안한','활기찬'] },
  ];

  const randomPick = () => candidates[Math.floor(Math.random() * candidates.length)];
  const showResult = (store, method) => {
    if (!store) return;
    setResult(store);
    setMode('result');
    onSave(store);
    onRecommend(store, method);
  };
  const scoreStore = (store) => {
    let score = 0;
    if (prefs.category === '상관없음' || store.category === prefs.category) score += 30;
    if (prefs.companion === '상관없음' || store.tags.includes(prefs.companion)) score += 20;
    if (prefs.mood === '상관없음' || store.tags.includes(prefs.mood)) score += 20;
    if (prefs.independent && store.type === 'independent') score += 15;
    const words = prefs.request.split(/\s+/).filter((x) => x.length > 1);
    score += words.filter((word) => [...store.tags, ...store.menus, store.category, store.name].some((v) => v.includes(word))).length * 5;
    return score;
  };
  const recommend = () => {
    const ranked = candidates.map((store) => ({ store, score: scoreStore(store) })).sort((a,b) => b.score - a.score);
    const top = ranked.filter((item) => item.score >= ranked[0].score - 5);
    showResult(top[Math.floor(Math.random() * top.length)].store, '조건 추천');
  };
  const reasonLines = result ? [
    prefs.category !== '상관없음' && result.category === prefs.category && `${prefs.category} 조건과 일치해요`,
    prefs.companion !== '상관없음' && result.tags.includes(prefs.companion) && `${prefs.companion} 방문에 어울려요`,
    prefs.mood !== '상관없음' && result.tags.includes(prefs.mood) && `${prefs.mood} 분위기 태그가 있어요`,
    prefs.independent && result.type === 'independent' && '개인 가게를 우선했어요',
  ].filter(Boolean) : [];

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="recommend-modal" onMouseDown={(e) => e.stopPropagation()}>
      <button className="modal-close" onClick={onClose}><X/></button>
      {mode === 'choose' && <>
        <div className="modal-hero"><Sparkles/><span>오늘의 한 끼</span></div>
        <h2>결정은 로컬픽에게 맡겨보세요</h2>
        <p>지금 보고 있는 지역의 가게 중 하나를 골라드릴게요.</p>
        <button className="recommend-choice orange" onClick={() => showResult(randomPick(), '완전 랜덤')}><Dice5/><span><strong>그냥 랜덤으로</strong><small>고민 없이 바로 하나 뽑기</small></span></button>
        <button className="recommend-choice green" onClick={() => setMode('guided')}><SlidersHorizontal/><span><strong>내 취향에 맞게</strong><small>몇 가지 질문으로 골라보기</small></span></button>
      </>}
      {mode === 'guided' && <>
        <div className="progress"><span style={{width: `${((step + 1) / 4) * 100}%`}} /></div>
        {step < 3 ? <>
          <p className="eyebrow">질문 {step + 1} / 4</p><h2>{questions[step].title}</h2>
          <div className="option-grid">{questions[step].options.map((item) => <button className={prefs[questions[step].key] === item ? 'selected' : ''} key={item} onClick={() => setPrefs({...prefs, [questions[step].key]: item})}>{item}</button>)}</div>
        </> : <>
          <p className="eyebrow">마지막 질문</p><h2>특별히 원하는 조건이 있나요?</h2>
          <label className="check-line"><input type="checkbox" checked={prefs.independent} onChange={(e) => setPrefs({...prefs, independent: e.target.checked})}/> 개인 가게를 우선 추천해 주세요</label>
          <textarea placeholder="예: 맵지 않고 조용한 곳, 디저트가 맛있는 곳" value={prefs.request} onChange={(e) => setPrefs({...prefs, request: e.target.value})}/>
        </>}
        <div className="modal-actions"><button className="text-button" onClick={() => step === 0 ? setMode('choose') : setStep(step-1)}><ArrowLeft size={17}/> 이전</button><button className="primary-button" onClick={() => step < 3 ? setStep(step+1) : recommend()}>{step < 3 ? '다음' : '추천 받기'}</button></div>
      </>}
      {mode === 'result' && result && <>
        <div className="result-confetti">오늘의 로컬픽</div>
        <h2 className="result-title">{result.name}</h2>
        <p>{result.region} {result.district} · {result.category} · {result.type === 'independent' ? '개인 가게 추정' : '브랜드'}</p>
        <div className="menu-line">{result.menus.join(' · ')}</div>
        {reasonLines.length > 0 && <div className="reason-box"><strong>추천한 이유</strong>{reasonLines.map((line) => <span key={line}><Check size={15}/> {line}</span>)}</div>}
        <div className="modal-actions triple"><button className="text-button" onClick={() => setMode('choose')}><Dice5 size={17}/> 다시 뽑기</button><span className="secondary-button"><Check size={17}/> 랜덤 저장됨</span><button className="primary-button" onClick={() => { onSelect(result); onClose(); }}>지도에서 보기</button></div>
      </>}
    </section>
  </div>;
}

function RandomHistoryView({ history, onBack, onSelect, onRemove, onClear }) {
  return <div className="saved-page">
    <header className="saved-header random-history-header"><button className="icon-button" onClick={onBack}><ArrowLeft/></button><div><p className="eyebrow">RANDOM PICKS</p><h1>랜덤 음식집 기록</h1></div></header>
    <section className="saved-content">
      <div className="section-heading"><div><h2>지금까지 뽑은 가게</h2><p>오늘 어디 가지?에서 나온 결과를 최근 순으로 저장합니다.</p></div><div className="history-summary"><span>{history.length}곳</span>{history.length > 0 && <button onClick={onClear}>전체 삭제</button>}</div></div>
      {history.length === 0 ? <div className="empty-state"><Dice5 size={36}/><h3>아직 뽑은 가게가 없어요</h3><p>지도에서 ‘오늘 어디 가지?’를 눌러 랜덤 가게를 뽑아보세요.</p><button className="primary-button" onClick={onBack}>가게 뽑으러 가기</button></div> : <div className="saved-grid">{history.map((item) => { const store = item.store; return <article key={item.id} onClick={() => { onSelect(store); onBack(); }}><div className={`saved-thumb ${store.source}`}>{sourceLabels[store.source].symbol}</div><div><span className="mini-label">{item.method} · {new Date(item.pickedAt).toLocaleDateString('ko-KR')}</span><h3>{store.name}</h3><p>{store.region} {store.district} · {store.category}</p><div className="saved-status">지도에서 다시 보기</div></div><button className="remove-save" aria-label="기록 삭제" onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}><X size={17}/></button></article>; })}</div>}
    </section>
  </div>;
}

function DetailPanel({ store, savedItem, collections, onClose, onSave, onUpdateSaved, onStartRoute, congestion, congestionInsight, congestionInsightLoading }) {
  const source = sourceLabels[store.source];
  const openStatus = getStoreOpenStatus(store);
  const [memo, setMemo] = useState(savedItem?.memo || '');
  const [rating, setRating] = useState(savedItem?.rating || 0);
  const [collectionId, setCollectionId] = useState(savedItem?.collectionId || 'all');
  useEffect(() => { setMemo(savedItem?.memo || ''); setRating(savedItem?.rating || 0); setCollectionId(savedItem?.collectionId || 'all'); }, [store.id, savedItem, collections]);
  return <aside className="detail-panel">
    <button className="detail-close" onClick={onClose}><X/></button>
    <div className={`detail-cover ${store.source}`}><span>{source.symbol}</span></div>
    <div className="detail-body">
      <h2>{store.name}{openStatus !== 'unknown' && <span className={`open-status ${openStatus}`}>{openStatus === 'open' ? '영업 중' : '영업 종료'}</span>}</h2>
      <p className="store-meta">{store.type === 'brand' ? '브랜드' : '개인 가게 추정'} · {store.category} · {priceText[store.price]}</p>
      {congestion && <div className="detail-congestion" style={{ '--congestion-color': congestion.color }}><span className="congestion-dot"/><div><strong>주변 혼잡도: {congestion.level}</strong><small>{congestion.name} 지역 기준 · 매장 내부 혼잡도가 아닙니다.</small></div></div>}
      {congestion && <section className="congestion-reasons"><h3>왜 붐비나요?</h3>{congestionInsightLoading ? <p>행사·상권·교통 데이터를 분석하는 중…</p> : congestionInsight ? <><p className="congestion-message">{congestionInsight.message}</p>{congestionInsight.reasons.map((reason, index) => <div className={`congestion-reason ${reason.type}`} key={`${reason.title}-${index}`}><span>{reason.type === 'confirmed' ? '확인' : reason.type === 'inferred' ? '추정' : '안내'}</span><div><strong>{reason.title}</strong><small>{reason.detail}</small></div></div>)}<small className="congestion-disclaimer">서울시 지역 단위 데이터의 분석 결과이며 특정 매장 내부 상황을 의미하지 않습니다.</small></> : <p>현재 원인 분석 정보를 확인할 수 없습니다.</p>}</section>}
      <dl className="info-list"><div><dt>주소</dt><dd>{store.address}</dd></div><div><dt>메뉴</dt><dd>{store.menus.join(', ')}</dd></div><div><dt>데이터 확인</dt><dd>{store.updatedAt}</dd></div></dl>
      <p className="store-data-notice">매장 정보는 실제 영업 상태와 다를 수 있으니 방문 전에 확인해 주세요.</p>
      <div className="tag-row large">{store.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
      <button className="route-main-button" onClick={() => onStartRoute(store)}><Navigation size={18}/><span><strong>길찾기</strong><small>지도에서 출발지를 선택합니다</small></span><ChevronDown size={16}/></button>
      {!savedItem ? <button className="full-primary" onClick={() => onSave(store)}><Bookmark size={18}/> 내 컬렉션에 저장</button> : <div className="saved-editor">
        <h3>나의 방문 기록</h3>
        <label>저장 목록<select value={collectionId} onChange={(e) => { const nextId = e.target.value; setCollectionId(nextId); onUpdateSaved(savedItem.id, { collectionId: nextId === 'all' ? null : nextId }); }}><option value="all">🗺️ 전체 저장에만</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>
        <label>별점<div className="stars">{[1,2,3,4,5].map((n) => <button key={n} onClick={() => { setRating(n); onUpdateSaved(savedItem.id, {rating:n}); }}><Star size={21} fill={n <= rating ? '#f47b20' : 'none'} color="#f47b20"/></button>)}</div></label>
        <label>메모<textarea value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => onUpdateSaved(savedItem.id, {memo})} placeholder="다음 방문을 위한 메모를 남겨보세요."/></label>
        <label className="check-line"><input type="checkbox" checked={savedItem.visited} onChange={(e) => onUpdateSaved(savedItem.id, {visited:e.target.checked})}/> 방문 완료</label>
      </div>}
    </div>
  </aside>;
}

function RoutePlanner({ start, destination, waypoints, mode, result, loading, error, selectedAlternativeIndex, selectedSegmentIndex, onStart, onDestination, onWaypoints, onMode, onCurrentLocation, onSwap, onSelectAlternative, onSelectSegment, onClose }) {
  const [startText, setStartText] = useState(start?.name || '');
  const [destinationText, setDestinationText] = useState(destination?.name || '');
  const [searchTarget, setSearchTarget] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => { setStartText(start?.name || ''); }, [start]);
  useEffect(() => { setDestinationText(destination?.name || ''); }, [destination]);
  const searchPlace = async (target) => {
    const text = target === 'start' ? startText : target === 'destination' ? destinationText : waypoints.find((item) => `waypoint:${item.id}` === target)?.text || '';
    if (text.trim().length < 2) return;
    setSearching(true); setSearchTarget(target);
    try { setSearchResults(await searchRegionLocations('전국', text.trim())); }
    catch { setSearchResults([]); }
    finally { setSearching(false); }
  };
  const choosePlace = (place) => {
    const value = { name: place.name, lat: place.lat, lng: place.lng };
    if (searchTarget === 'start') { onStart(value); setStartText(place.name); }
    else if (searchTarget === 'destination') { onDestination(value); setDestinationText(place.name); }
    else {
      const waypointId = searchTarget?.replace('waypoint:', '');
      onWaypoints(waypoints.map((item) => item.id === waypointId ? { ...item, ...value, text: place.name } : item));
    }
    setSearchResults([]); setSearchTarget(null);
  };
  return <div className="route-panel"><div className="route-panel-head"><div><small>로컬픽 길찾기</small><strong>출발지·경유지·도착지</strong></div><button onClick={onClose}><X size={18}/></button></div><div className="route-search-fields"><div><span className="route-point start"/><input value={startText} onChange={(event) => setStartText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchPlace('start')} placeholder="출발지를 검색하세요"/><button onClick={() => searchPlace('start')}><Search size={15}/></button></div><div className="route-field-tools"><button className="use-current-location" onClick={onCurrentLocation}><LocateFixed size={14}/> 현재 위치 사용</button><button className="swap-route-points" disabled={!start && !destination} onClick={onSwap}><ArrowLeftRight size={14}/> 출발·도착 바꾸기</button></div>{waypoints.map((waypoint, index) => <div className="waypoint-field" key={waypoint.id}><span className="route-point waypoint">{index + 1}</span><input value={waypoint.text || ''} onChange={(event) => onWaypoints(waypoints.map((item) => item.id === waypoint.id ? { id: item.id, text: event.target.value } : item))} onKeyDown={(event) => event.key === 'Enter' && searchPlace(`waypoint:${waypoint.id}`)} placeholder={`경유지 ${index + 1} 검색`}/><button onClick={() => searchPlace(`waypoint:${waypoint.id}`)}><Search size={15}/></button><span className="waypoint-tools"><button disabled={index === 0} title="위로 이동" onClick={() => { const next = [...waypoints]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onWaypoints(next); }}>↑</button><button disabled={index === waypoints.length - 1} title="아래로 이동" onClick={() => { const next = [...waypoints]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onWaypoints(next); }}>↓</button><button title="경유지 삭제" onClick={() => onWaypoints(waypoints.filter((item) => item.id !== waypoint.id))}><X size={13}/></button></span></div>)}{waypoints.length < 3 && <button className="add-waypoint" onClick={() => onWaypoints([...waypoints, { id: crypto.randomUUID(), text: '' }])}><Plus size={15}/> 경유지 추가</button>}<div><span className="route-point end"/><input value={destinationText} onChange={(event) => setDestinationText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchPlace('destination')} placeholder="도착지를 검색하세요"/><button onClick={() => searchPlace('destination')}><Search size={15}/></button></div></div>{searching && <p className="route-state">장소를 검색하는 중…</p>}{searchResults.length > 0 && <div className="route-place-results">{searchResults.map((place) => <button key={`${place.id}-${searchTarget}`} onClick={() => choosePlace(place)}><strong>{place.name}</strong><small>{place.address}</small></button>)}</div>}{start && destination && waypoints.every((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)) ? <><div className="route-mode-tabs">{[['walk','도보'],['publictraffic','대중교통'],['bicycle','자전거']].map(([value,label]) => <button className={mode === value ? 'active' : ''} key={value} onClick={() => onMode(value)}>{label}</button>)}</div>{loading && <p className="route-state">경로를 계산하는 중…</p>}{error && <p className="route-state error">{error}</p>}{result && <>{mode === 'publictraffic' && waypoints.length === 0 && result.alternatives?.length > 1 && <div className="route-alternatives"><strong>다른 경로</strong><div>{result.alternatives.map((alternative, index) => <button className={selectedAlternativeIndex === index ? 'active' : ''} key={`${alternative.time}-${index}`} onClick={() => onSelectAlternative(index)}><b>{formatRouteTime(alternative.time)}</b><span>{alternative.routeType === 'BUS' ? '버스' : alternative.routeType === 'SUBWAY' ? '지하철' : '버스+지하철'} · 환승 {alternative.transfers}회</span></button>)}</div></div>}<div className="route-summary"><div><strong>{formatRouteTime(result.time)}</strong><span>{result.distance >= 1000 ? `${(result.distance / 1000).toFixed(1)}km` : `${result.distance}m`}</span></div>{Number.isFinite(result.transfers) && <span>환승 {result.transfers}회</span>}{result.fare > 0 && <span>예상 요금 {result.fare.toLocaleString()}원</span>}</div><div className="route-transport-list"><strong>이동 경로 · 구간을 누르면 지도에서 확인할 수 있어요</strong>{result.segments?.map((segment, index) => <button className={`route-transport-step ${segment.type.toLowerCase()} ${selectedSegmentIndex === index ? 'selected' : ''}`} key={`${segment.guidance}-${index}`} onClick={() => onSelectSegment(selectedSegmentIndex === index ? null : index)}><span className="transport-icon">{segment.type === 'BUS' ? '🚌' : segment.type === 'SUBWAY' ? '🚇' : segment.type === 'BICYCLE' ? '🚲' : '🚶'}</span><div><b>{segment.vehicles.length ? segment.vehicles.join(' · ') : segment.type === 'BICYCLE' ? '자전거' : '도보'}</b><small>{segment.guidance}{segment.from && segment.to ? ` · ${segment.from} → ${segment.to}` : ''}</small>{selectedSegmentIndex === index && segment.stops.length > 0 && <span className="route-stop-list">{segment.stops.join(' → ')}</span>}</div><em>{formatRouteTime(segment.time)}</em></button>)}</div></>}</> : <div className="route-prompt"><Navigation size={25}/><strong>{waypoints.some((item) => !Number.isFinite(item.lat)) ? '경유지를 검색해 선택하세요' : '출발지와 도착지를 입력하세요'}</strong><span>검색 결과에서 장소를 선택하면 경로를 계산합니다.</span></div>}</div>;
}

function SavedView({ saved, collections, onBack, onSelect, onRemove, onAddCollection, onSetCollectionMembers, onDeleteCollection, onMoveToCollection }) {
  const [selectedCollection, setSelectedCollection] = useState('all');
  const [newName, setNewName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState([]);
  const [draggedSavedId, setDraggedSavedId] = useState(null);
  const [dropCollectionId, setDropCollectionId] = useState(null);
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);
  const suppressCardClick = useRef(false);
  const dropCollectionRef = useRef(null);
  const draggedSavedRef = useRef(null);
  const isCustomCollection = collections.some((item) => item.id === selectedCollection);
  const manualSaved = saved.filter((item) => item.savedVia !== 'random');
  const showManualFolders = selectedCollection === 'manual' && collections.length > 0;
  const shown = saved.filter((item) => selectedCollection === 'all' || selectedCollection === 'manual' ? (selectedCollection === 'all' || item.savedVia !== 'random') : selectedCollection === 'random' ? item.savedVia === 'random' : item.savedVia !== 'random' && item.collectionId === selectedCollection);
  const openPicker = () => {
    setPickedIds(manualSaved.filter((item) => item.collectionId === selectedCollection).map((item) => item.id));
    setPickerOpen(true);
  };
  const finishDrop = (collectionId) => {
    const savedId = draggedSavedRef.current || draggedSavedId;
    if (savedId && collectionId) onMoveToCollection(savedId, collectionId);
    setDraggedSavedId(null);
    draggedSavedRef.current = null;
    setDropCollectionId(null);
    dropCollectionRef.current = null;
  };
  const startLongPress = (event, savedId) => {
    if (event.pointerType === 'mouse') return;
    longPressTimer.current = window.setTimeout(() => {
      longPressActive.current = true;
      suppressCardClick.current = true;
      draggedSavedRef.current = savedId;
      setDraggedSavedId(savedId);
      if (navigator.vibrate) navigator.vibrate(35);
    }, 450);
  };
  const moveLongPress = (event) => {
    if (!longPressActive.current) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-collection-drop]');
    dropCollectionRef.current = target?.dataset.collectionDrop || null;
    setDropCollectionId(dropCollectionRef.current);
  };
  const endLongPress = () => {
    window.clearTimeout(longPressTimer.current);
    if (longPressActive.current) finishDrop(dropCollectionRef.current);
    longPressActive.current = false;
    window.setTimeout(() => { suppressCardClick.current = false; }, 100);
  };
  return <div className="saved-page">
    <header className="saved-header"><button className="icon-button" onClick={onBack}><ArrowLeft/></button><div><p className="eyebrow">MY LOCAL PICK</p><h1>나의 컬렉션</h1></div></header>
    <div className="collection-strip"><button className={selectedCollection === 'all' ? 'selected' : ''} onClick={() => setSelectedCollection('all')}><span>🗺️</span><strong>전체 저장</strong><small>{saved.length}곳</small></button><button className={selectedCollection === 'manual' || isCustomCollection ? 'selected' : ''} onClick={() => setSelectedCollection('manual')}><span>🔖</span><strong>수동 저장</strong><small>{manualSaved.length}곳</small></button><button className={selectedCollection === 'random' ? 'selected' : ''} onClick={() => setSelectedCollection('random')}><span>🎲</span><strong>랜덤 저장</strong><small>{saved.filter((item) => item.savedVia === 'random').length}곳</small></button></div>
    {selectedCollection === 'manual' && <div className="new-collection"><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="수동 저장 목록 이름"/><button onClick={() => { if(newName.trim()) { onAddCollection(newName.trim()); setNewName(''); } }}><Plus size={18}/> 목록 만들기</button></div>}
    <section className="saved-content"><div className="section-heading"><div><h2>{selectedCollection === 'all' ? '저장한 모든 가게' : selectedCollection === 'manual' ? '수동 저장' : selectedCollection === 'random' ? '랜덤으로 저장한 가게' : collections.find(c => c.id === selectedCollection)?.name}</h2><p>{selectedCollection === 'all' ? '저장한 가게를 한곳에서 보고 관리하세요.' : selectedCollection === 'manual' ? '만든 목록과 직접 저장한 매장을 함께 확인할 수 있습니다.' : selectedCollection === 'random' ? '오늘 어디 가지? 추천 결과에서 저장한 매장입니다.' : '직접 만든 수동 저장 목록입니다.'}</p></div><div className="collection-heading-actions">{isCustomCollection && <><button className="back-to-collections" onClick={() => setSelectedCollection('manual')}><ArrowLeft size={15}/> 수동 저장으로</button><button onClick={openPicker}><Plus size={15}/> 기존 매장 추가</button></>}<span>{shown.length}곳</span></div></div>
      {showManualFolders && <><h3 className="manual-section-title">내 목록 <small>매장을 길게 눌러 목록 위에 놓아보세요</small></h3><div className="manual-collection-grid">{collections.map((c) => <article data-collection-drop={c.id} className={dropCollectionId === c.id ? 'drop-active' : ''} key={c.id} onClick={() => setSelectedCollection(c.id)} onDragOver={(event) => { event.preventDefault(); setDropCollectionId(c.id); }} onDragLeave={() => setDropCollectionId(null)} onDrop={(event) => { event.preventDefault(); finishDrop(c.id); }}><span>{c.emoji}</span><div><h3>{c.name}</h3><p>{manualSaved.filter((item) => item.collectionId === c.id).length}곳의 매장</p></div><button aria-label={`${c.name} 목록 삭제`} title="목록 삭제" onClick={(event) => { event.stopPropagation(); if (window.confirm(`‘${c.name}’ 목록을 삭제할까요?\n매장은 수동 저장에 그대로 남습니다.`)) onDeleteCollection(c.id); }}><X size={15}/></button></article>)}</div><h3 className="manual-section-title stores-title">저장한 매장</h3></>}
      {shown.length === 0 ? <div className="empty-state"><Bookmark size={36}/><h3>아직 저장한 가게가 없어요</h3><p>지도에서 마음에 드는 가게를 발견하고 저장해 보세요.</p><button className="primary-button" onClick={onBack}>가게 탐색하기</button></div> : <div className="saved-grid">{shown.map((item) => { const store = item.store || stores.find((s) => s.id === item.storeId); if (!store) return null; return <article className={draggedSavedId === item.id ? 'dragging-card' : ''} draggable={selectedCollection === 'manual' && collections.length > 0} key={item.id} onDragStart={(event) => { draggedSavedRef.current = item.id; setDraggedSavedId(item.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { draggedSavedRef.current = null; setDraggedSavedId(null); setDropCollectionId(null); }} onPointerDown={(event) => selectedCollection === 'manual' && collections.length > 0 && startLongPress(event, item.id)} onPointerMove={moveLongPress} onPointerUp={endLongPress} onPointerCancel={endLongPress} onClick={() => { if (suppressCardClick.current) return; onSelect(store); onBack(); }}><div className={`saved-thumb ${store.source}`}>{sourceLabels[store.source].symbol}</div><div><span className="mini-label">{store.region} {store.district}</span><h3>{store.name}</h3><p>{store.category} · {store.type === 'brand' ? '브랜드' : '개인 가게 추정'}</p><div className="saved-status">{item.visited ? '✓ 방문 완료' : '○ 방문 전'} {item.rating > 0 && `· ★ ${item.rating}`}</div></div><button className="remove-save" onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}><X size={17}/></button></article>; })}</div>}
    </section>
    {pickerOpen && <div className="modal-backdrop" onMouseDown={() => setPickerOpen(false)}><section className="collection-picker" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={() => setPickerOpen(false)}><X/></button>
      <p className="eyebrow">ADD SAVED STORES</p><h2>{collections.find((item) => item.id === selectedCollection)?.name}에 담기</h2><p>전체 저장에 있는 매장을 선택하세요. 다른 목록의 매장을 선택하면 이 목록으로 이동합니다.</p>
      <div className="collection-picker-list">{manualSaved.length === 0 ? <div className="naver-empty">먼저 지도에서 매장을 직접 저장해 주세요.</div> : manualSaved.map((item) => { const store = item.store || stores.find((candidate) => candidate.id === item.storeId); if (!store) return null; const checked = pickedIds.includes(item.id); return <label key={item.id}><input type="checkbox" checked={checked} onChange={() => setPickedIds(checked ? pickedIds.filter((id) => id !== item.id) : [...pickedIds, item.id])}/><span><strong>{store.name}</strong><small>{store.region} {store.district} · {store.category}{item.collectionId && item.collectionId !== selectedCollection ? ` · 다른 목록에 저장됨` : ''}</small></span></label>; })}</div>
      <div className="modal-actions"><button className="text-button" onClick={() => setPickerOpen(false)}>취소</button><button className="primary-button" onClick={() => { onSetCollectionMembers(selectedCollection, pickedIds); setPickerOpen(false); }}>선택한 매장 담기</button></div>
    </section></div>}
  </div>;
}

export default function App() {
  const [, setBusinessClock] = useState(() => Date.now());
  const [region, setRegion] = useState('전국');
  const [district, setDistrict] = useState('전체');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [storeType, setStoreType] = useState('전체');
  const [sortMode, setSortMode] = useState('recommended');
  const [sortOpen, setSortOpen] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [bounds, setBounds] = useState(null);
  const [selectedStore, setSelectedStore] = useState(null);
  const [searchFocusStore, setSearchFocusStore] = useState(null);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [view, setView] = useState('map');
  const [mobileList, setMobileList] = useState(false);
  const [toast, setToast] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const searchBoxRef = useRef(null);
  const quickRegionRef = useRef(null);
  const [quickRegionOpen, setQuickRegionOpen] = useState(false);
  const [quickRegionStep, setQuickRegionStep] = useState('regions');
  const [focusLocation, setFocusLocation] = useState(null);
  const [usingCurrentLocation, setUsingCurrentLocation] = useState(false);
  const [mapLocationLabel, setMapLocationLabel] = useState('');
  const [routeDestination, setRouteDestination] = useState(null);
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  const [routeStart, setRouteStart] = useState(null);
  const [routeWaypoints, setRouteWaypoints] = useState([]);
  const [routeMode, setRouteMode] = useState('walk');
  const [routeResult, setRouteResult] = useState(null);
  const [selectedRouteAlternativeIndex, setSelectedRouteAlternativeIndex] = useState(0);
  const [selectedRouteSegmentIndex, setSelectedRouteSegmentIndex] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [realtimeSubwayTrains, setRealtimeSubwayTrains] = useState([]);
  const [realtimeSubwayError, setRealtimeSubwayError] = useState('');
  const [realtimeBuses, setRealtimeBuses] = useState([]);
  const [realtimeBusError, setRealtimeBusError] = useState('');
  const [seoulCongestionAreas, setSeoulCongestionAreas] = useState([]);
  const [seoulCongestionUpdatedAt, setSeoulCongestionUpdatedAt] = useState(null);
  const [seoulCongestionStatus, setSeoulCongestionStatus] = useState('loading');
  const [congestionVisible, setCongestionVisible] = useState(false);
  const [congestionInsight, setCongestionInsight] = useState(null);
  const [congestionInsightLoading, setCongestionInsightLoading] = useState(false);
  const [roadTrafficVisible, setRoadTrafficVisible] = useState(false);
  const [roadTraffic, setRoadTraffic] = useState(null);
  const [roadTrafficStatus, setRoadTrafficStatus] = useState('idle');
  const [locationLoading, setLocationLoading] = useState(false);
  const [apiStores, setApiStores] = useState([]);
  const [apiResultsQuery, setApiResultsQuery] = useState('');
  const [chosenSearchResultId, setChosenSearchResultId] = useState(null);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [publicStores, setPublicStores] = useState([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState('');
  const [displayedMarkers, setDisplayedMarkers] = useState([]);
  const [naverStores, setNaverStores] = useState([]);
  const [naverLoading, setNaverLoading] = useState(false);
  const [naverError, setNaverError] = useState('');
  const [naverPreviews, setNaverPreviews] = useState([]);
  const [saved, setSaved] = useLocalStorage('localpick-saved', []);
  const [randomHistory, setRandomHistory] = useLocalStorage('localpick-random-history', []);
  const [collections, setCollections] = useLocalStorage('localpick-collections', []);

  useEffect(() => {
    const timer = window.setInterval(() => setBusinessClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const customCollections = collections.filter((collection) => !LEGACY_COLLECTION_IDS.has(collection.id));
    if (customCollections.length !== collections.length) setCollections(customCollections);
    if (saved.some((item) => LEGACY_COLLECTION_IDS.has(item.collectionId))) {
      setSaved(saved.map((item) => LEGACY_COLLECTION_IDS.has(item.collectionId) ? { ...item, collectionId: null } : item));
    }
  }, [collections, saved, setCollections, setSaved]);

  useEffect(() => {
    if (!quickRegionOpen) return undefined;
    const closeOnOutside = (event) => {
      if (quickRegionRef.current && !quickRegionRef.current.contains(event.target)) setQuickRegionOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setQuickRegionOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [quickRegionOpen]);

  useEffect(() => {
    const closeSuggestionsOnOutside = (event) => {
      const suggestionsAvailable = query.trim().length >= 2
        && apiResultsQuery.trim() === query.trim()
        && apiStores.length > 1;
      if (suggestionsAvailable && searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setChosenSearchResultId('dismissed');
        setHighlightedSuggestionIndex(-1);
      }
    };
    document.addEventListener('pointerdown', closeSuggestionsOnOutside);
    return () => document.removeEventListener('pointerdown', closeSuggestionsOnOutside);
  }, [query, apiResultsQuery, apiStores.length]);

  useEffect(() => {
    if (!routeStart || !routeDestination || routeWaypoints.some((item) => !Number.isFinite(item.lat) || !Number.isFinite(item.lng))) return undefined;
    let cancelled = false;
    const loadRoute = async () => {
      setRouteLoading(true); setRouteError(''); setRouteResult(null);
      setSelectedRouteSegmentIndex(null);
      try {
        const routePoints = [routeStart, ...routeWaypoints, routeDestination];
        const legs = await Promise.all(routePoints.slice(0, -1).map((point, index) => findKakaoRoute({ start: point, end: routePoints[index + 1], mode: routeMode })));
        const result = legs.length === 1 ? legs[0] : {
          points: legs.flatMap((leg, index) => index === 0 ? leg.points : leg.points.slice(1)),
          distance: legs.reduce((sum, leg) => sum + (leg.distance || 0), 0),
          time: legs.reduce((sum, leg) => sum + (leg.time || 0), 0),
          transfers: legs.reduce((sum, leg) => sum + (Number.isFinite(leg.transfers) ? leg.transfers : 0), 0),
          fare: legs.reduce((sum, leg) => sum + (leg.fare || 0), 0),
          segments: legs.flatMap((leg, legIndex) => leg.segments.map((segment) => ({ ...segment, guidance: `${legIndex + 1}구간 · ${segment.guidance}` }))),
          alternatives: [],
        };
        if (!cancelled) { setRouteResult(result); setSelectedRouteAlternativeIndex(0); }
      } catch (error) {
        if (!cancelled) setRouteError(error.message || '경로를 찾을 수 없습니다.');
      } finally { if (!cancelled) setRouteLoading(false); }
    };
    loadRoute();
    return () => { cancelled = true; };
  }, [routeStart, routeDestination, routeWaypoints, routeMode]);

  useEffect(() => {
    const subwaySegment = routeMode === 'publictraffic' && routeResult?.segments
      ? (routeResult.segments[selectedRouteSegmentIndex]?.type === 'SUBWAY' ? routeResult.segments[selectedRouteSegmentIndex] : routeResult.segments.find((segment) => segment.type === 'SUBWAY'))
      : null;
    const lineName = subwaySegment?.vehicles?.[0];
    if (!lineName) { setRealtimeSubwayTrains([]); setRealtimeSubwayError(''); return undefined; }
    let cancelled = false;
    const loadRealtimeTrains = async () => {
      try {
        const trains = await fetchRealtimeSubwayPositions(lineName);
        if (!cancelled) { setRealtimeSubwayTrains(trains); setRealtimeSubwayError(''); }
      } catch (error) {
        if (!cancelled) { setRealtimeSubwayTrains([]); setRealtimeSubwayError(error.message); }
      }
    };
    loadRealtimeTrains();
    const timer = window.setInterval(loadRealtimeTrains, 20000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [routeMode, routeResult, selectedRouteSegmentIndex]);

  useEffect(() => {
    const busSegment = routeMode === 'publictraffic' && routeResult?.segments
      ? (routeResult.segments[selectedRouteSegmentIndex]?.type === 'BUS' ? routeResult.segments[selectedRouteSegmentIndex] : routeResult.segments.find((segment) => segment.type === 'BUS'))
      : null;
    const routeName = busSegment?.vehicles?.[0];
    if (!routeName) { setRealtimeBuses([]); setRealtimeBusError(''); return undefined; }
    let cancelled = false;
    const loadRealtimeBuses = async () => {
      try {
        const buses = await fetchRealtimeBusPositions(routeName);
        if (!cancelled) { setRealtimeBuses(buses); setRealtimeBusError(''); }
      } catch (error) {
        if (!cancelled) { setRealtimeBuses([]); setRealtimeBusError(error.message); }
      }
    };
    loadRealtimeBuses();
    const timer = window.setInterval(loadRealtimeBuses, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [routeMode, routeResult, selectedRouteSegmentIndex]);

  useEffect(() => {
    let cancelled = false;
    const loadCongestion = async () => {
      setSeoulCongestionStatus((status) => status === 'ready' ? status : 'loading');
      try {
        const areas = await fetchSeoulCongestionAreas();
        if (!cancelled) { setSeoulCongestionAreas(areas); setSeoulCongestionUpdatedAt(new Date()); setSeoulCongestionStatus(areas.length ? 'ready' : 'error'); }
      } catch {
        if (!cancelled) { setSeoulCongestionAreas([]); setSeoulCongestionStatus('error'); }
      }
    };
    loadCongestion();
    const timer = window.setInterval(loadCongestion, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const allStores = useMemo(() => mergeStoreSources(apiStores, publicStores), [apiStores, publicStores]);
  const selectedCongestion = useMemo(() => congestionVisible && selectedStore ? findNearbyCongestion(selectedStore, seoulCongestionAreas) : null, [congestionVisible, selectedStore, seoulCongestionAreas]);

  useEffect(() => {
    if (!selectedCongestion) { setCongestionInsight(null); setCongestionInsightLoading(false); return undefined; }
    let cancelled = false;
    setCongestionInsightLoading(true);
    fetchSeoulCityData(selectedCongestion.name)
      .then((result) => { if (!cancelled) setCongestionInsight(result); })
      .catch(() => { if (!cancelled) setCongestionInsight(null); })
      .finally(() => { if (!cancelled) setCongestionInsightLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCongestion?.name]);

  useEffect(() => {
    if (!roadTrafficVisible || !bounds) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRoadTrafficStatus('loading');
      try {
        const result = await fetchRoadTraffic(bounds);
        if (!cancelled) { setRoadTraffic(result); setRoadTrafficStatus('ready'); }
      } catch {
        if (!cancelled) { setRoadTraffic(null); setRoadTrafficStatus('error'); }
      }
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [roadTrafficVisible, bounds]);

  useEffect(() => {
    if (!bounds || !hasStarted || usingCurrentLocation) return undefined;
    let cancelled = false;
    const center = bounds.getCenter();
    const timer = window.setTimeout(async () => {
      try {
        const location = await reverseGeocodeKakao(center.lat, center.lng);
        if (!cancelled && location?.label) setMapLocationLabel(location.label);
      } catch {
        if (!cancelled) setMapLocationLabel('');
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [bounds, hasStarted, usingCurrentLocation]);

  useEffect(() => {
    if (!bounds || !hasStarted) return;
    let cancelled = false;
    const loadPlaces = async () => {
      setApiLoading(true); setApiError('');
      try {
        const rawQuery = query.trim();
        const apiQuery = GENERAL_FOOD_TERMS.test(rawQuery.replace(/\s+/g, '')) ? '' : normalizedSearchTerm(rawQuery);
        const results = await searchKakaoPlaces({ bounds, query: apiQuery, category, nationwide: region === '전국' });
        if (!cancelled) { setApiStores(results); setApiResultsQuery(rawQuery); }
      } catch (error) {
        if (!cancelled) setApiError(error.status === 401 ? '카카오 REST API 키를 확인해 주세요.' : '실시간 장소 검색을 불러오지 못했습니다.');
      } finally { if (!cancelled) setApiLoading(false); }
    };
    loadPlaces();
    return () => { cancelled = true; };
  }, [bounds, query, category, region, refreshToken, hasStarted]);

  useEffect(() => {
    if (!bounds || !hasStarted) return;
    let cancelled = false;
    const loadPublicStores = async () => {
      setPublicLoading(true); setPublicError('');
      try {
        const results = await searchPublicStores(bounds);
        if (!cancelled) setPublicStores(results);
      } catch {
        if (!cancelled) setPublicError('');
      } finally { if (!cancelled) setPublicLoading(false); }
    };
    loadPublicStores();
    return () => { cancelled = true; };
  }, [bounds, refreshToken, hasStarted]);

  const filtered = useMemo(() => allStores.filter((store) => {
    const regionMatch = region === '전국' || store.region === region;
    const districtMatch = district === '전체' || store.district === district;
    const categoryMatch = category === '전체' || (category === '음식점' ? store.category !== '카페' : store.category === category);
    const typeMatch = storeType === '전체' || store.type === storeType;
    const rawQuery = query.trim().toLowerCase().replace(/\s+/g, '');
    const q = normalizedSearchTerm(query);
    const searchable = [store.name, store.category, ...store.menus, ...store.tags].join(' ').toLowerCase().replace(/\s+/g, '');
    const queryMatch = !q || GENERAL_FOOD_TERMS.test(rawQuery) || searchable.includes(q);
    return regionMatch && districtMatch && categoryMatch && typeMatch && queryMatch;
  }), [allStores, region, district, category, storeType, query]);

  useEffect(() => {
    const rawQuery = query.trim();
    const shouldUseNaver = rawQuery.length >= 2
      && !apiLoading && !publicLoading
      && (sortMode === 'reviews' || (!GENERAL_FOOD_TERMS.test(rawQuery.replace(/\s+/g, '')) && filtered.length === 0));
    if (!shouldUseNaver) {
      setNaverStores([]); setNaverPreviews([]); setNaverError(''); setNaverLoading(false); return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setNaverLoading(true); setNaverError('');
      try {
        const scopedQuery = `${region === '전국' ? '' : region} ${district === '전체' ? '' : district} ${rawQuery}`.trim();
        const results = await searchNaverLocal(scopedQuery, sortMode === 'reviews' ? 'comment' : 'random');
        if (!cancelled) {
          setNaverStores(results);
          setNaverPreviews(results.filter((store) => Number.isFinite(store.lat) && Number.isFinite(store.lng)));
        }
      } catch (error) {
        if (!cancelled) {
          setNaverStores([]); setNaverPreviews([]);
          setNaverError(error.status === 401 ? '네이버 API 인증 정보를 확인해 주세요.' : error.status === 429 ? '네이버 일일 검색 한도에 도달했습니다.' : '네이버 보조 검색을 불러오지 못했습니다.');
        }
      } finally { if (!cancelled) setNaverLoading(false); }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, region, district, apiLoading, publicLoading, filtered, sortMode]);

  const hiddenCount = filtered.filter((s) => s.source === 'hidden').length;
  const independentCount = filtered.filter((s) => s.type === 'independent').length;
  const sortedStores = useMemo(() => {
    const items = [...filtered];
    if (sortMode === 'name') return items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (sortMode === 'independent') return items.sort((a, b) => Number(b.type === 'independent') - Number(a.type === 'independent'));
    if (sortMode === 'distance') {
      const center = focusLocation || bounds?.getCenter();
      if (!center) return items;
      const distance = (store) => (store.lat - center.lat) ** 2 + (store.lng - center.lng) ** 2;
      return items.sort((a, b) => distance(a) - distance(b));
    }
    return items;
  }, [filtered, sortMode, focusLocation, bounds]);
  const listStores = sortedStores.slice(0, 250);
  useEffect(() => {
    if (apiLoading || publicLoading) return;
    setDisplayedMarkers(bounds ? filtered.filter((store) => bounds.contains([store.lat, store.lng])) : filtered);
  }, [filtered, apiLoading, publicLoading]);
  const visibleMarkers = displayedMarkers;
  const animatedTransitSegment = routeMode === 'publictraffic' && routeResult?.segments
    ? (routeResult.segments[selectedRouteSegmentIndex] && ['BUS','SUBWAY'].includes(routeResult.segments[selectedRouteSegmentIndex].type)
      ? routeResult.segments[selectedRouteSegmentIndex]
      : routeResult.segments.find((segment) => ['BUS','SUBWAY'].includes(segment.type)))
    : null;
  const realtimeSubwayMarkers = useMemo(() => {
    const segment = routeMode === 'publictraffic' && routeResult?.segments
      ? (routeResult.segments[selectedRouteSegmentIndex]?.type === 'SUBWAY' ? routeResult.segments[selectedRouteSegmentIndex] : routeResult.segments.find((item) => item.type === 'SUBWAY'))
      : null;
    if (!segment?.points?.length || !segment.stops?.length) return [];
    const normalizeStation = (name = '') => name.replace(/\([^)]*\)/g, '').replace(/역$/g, '').replace(/\s+/g, '');
    const normalizedStops = segment.stops.map(normalizeStation);
    return realtimeSubwayTrains.map((train) => {
      const stationIndex = normalizedStops.indexOf(normalizeStation(train.station));
      if (stationIndex < 0) return null;
      const ratio = normalizedStops.length <= 1 ? 0 : stationIndex / (normalizedStops.length - 1);
      const pointIndex = Math.min(segment.points.length - 1, Math.round(ratio * (segment.points.length - 1)));
      return { ...train, position: segment.points[pointIndex] };
    }).filter(Boolean);
  }, [routeMode, routeResult, selectedRouteSegmentIndex, realtimeSubwayTrains]);

  const notify = (message) => { setToast(message); setTimeout(() => setToast(''), 2200); };
  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      notify('이 브라우저에서는 위치 기능을 사용할 수 없습니다.');
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setHasStarted(true);
        setRegion('전국');
        setDistrict('전체');
        setFocusLocation({ lat: coords.latitude, lng: coords.longitude, requestedAt: Date.now() });
        setUsingCurrentLocation(true);
        setLocationLoading(false);
        notify('현재 위치로 이동했습니다.');
      },
      (error) => {
        setLocationLoading(false);
        notify(error.code === error.PERMISSION_DENIED ? '위치 권한이 거절되어 이동을 취소했습니다.' : '현재 위치를 확인할 수 없습니다.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  const saveStore = (store, savedVia = 'manual') => {
    const existing = saved.find((item) => item.storeId === store.id);
    if (existing && savedVia === 'random') { setSaved(saved.map((item) => item.id === existing.id ? { ...item, savedVia: 'random' } : item)); notify('랜덤 저장 음식집에 저장했습니다.'); return; }
    if (existing) { setSaved(saved.filter((item) => item.id !== existing.id)); notify('저장을 취소했습니다.'); return; }
    setSaved([...saved, { id: crypto.randomUUID(), storeId: store.id, store, savedVia, collectionId: null, memo: '', rating: 0, visited: false, savedAt: new Date().toISOString() }]);
    notify(savedVia === 'random' ? '랜덤 저장 음식집에 저장했습니다.' : '수동 저장 음식집에 저장했습니다.');
  };
  const updateSaved = (id, patch) => setSaved(saved.map((item) => item.id === id ? {...item, ...patch} : item));
  const recordRecommendation = (store, method) => {
    const withoutSameStore = randomHistory.filter((item) => item.store?.id !== store.id);
    setRandomHistory([{ id: crypto.randomUUID(), store, method, pickedAt: new Date().toISOString() }, ...withoutSameStore].slice(0, 50));
  };
  const selectStore = (store) => { setSearchFocusStore(null); setSelectedStore(store); setMapLocationLabel([store.region, store.district].filter(Boolean).join(' ')); setMobileList(false); };
  const focusSearchResult = (store) => { setSelectedStore(null); setSearchFocusStore(store); setMapLocationLabel([store.region, store.district].filter(Boolean).join(' ')); setMobileList(false); };
  const chooseSearchSuggestion = (store) => { setChosenSearchResultId(store.id); setHighlightedSuggestionIndex(-1); focusSearchResult(store); };
  const useCurrentLocationForRoute = (destination = routeDestination) => {
    if (!navigator.geolocation) { notify('이 브라우저에서는 위치 기능을 사용할 수 없습니다.'); return; }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const current = { name: '내 위치', lat: coords.latitude, lng: coords.longitude };
        setRouteStart(current); setFocusLocation({ ...current, requestedAt: Date.now() }); setUsingCurrentLocation(true);
        if (destination) setRouteDestination(destination);
        setRoutePlannerOpen(true); setRouteResult(null); setRouteError(''); setRouteMode('walk');
        setSelectedStore(null); setMobileList(false); setLocationLoading(false);
      },
      (error) => {
        setLocationLoading(false);
        notify(error.code === error.PERMISSION_DENIED ? '위치 권한이 거절되어 길찾기를 취소했습니다.' : '현재 위치를 확인할 수 없습니다.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  const startRoute = (store) => useCurrentLocationForRoute({ name: store.name, lat: store.lat, lng: store.lng });
  const openRoutePlanner = () => { setRoutePlannerOpen(true); setRouteResult(null); setRouteError(''); };
  const closeRoute = () => { setRoutePlannerOpen(false); setRouteDestination(null); setRouteStart(null); setRouteWaypoints([]); setRouteResult(null); setSelectedRouteAlternativeIndex(0); setSelectedRouteSegmentIndex(null); setRouteError(''); };
  const handleMapBounds = (nextBounds) => {
    setBounds(nextBounds);
  };
  const currentLabel = region === '전국' ? '전국' : district === '전체' ? `${region} 전체` : `${region} ${district}`;
  const displayedLocationLabel = usingCurrentLocation ? '내 위치' : mapLocationLabel || currentLabel;
  const sortLabels = { recommended: '검색 정확도순', reviews: '리뷰 많은 순', distance: '가까운 순', name: '이름순', independent: '개인 매장 우선' };
  const searchSuggestions = apiStores.slice(0, 6);
  const showSearchSuggestions = query.trim().length >= 2 && apiResultsQuery.trim() === query.trim() && apiStores.length > 1 && !chosenSearchResultId;

  if (view === 'saved') return <SavedView saved={saved} collections={collections} onBack={() => setView('map')} onSelect={selectStore} onRemove={(id) => setSaved(saved.filter((s) => s.id !== id))} onAddCollection={(name) => setCollections([...collections, {id: crypto.randomUUID(), name, emoji:'📌'}])} onSetCollectionMembers={(collectionId, memberIds) => setSaved(saved.map((item) => memberIds.includes(item.id) ? { ...item, collectionId } : item.collectionId === collectionId ? { ...item, collectionId: null } : item))} onDeleteCollection={(collectionId) => { setCollections(collections.filter((item) => item.id !== collectionId)); setSaved(saved.map((item) => item.collectionId === collectionId ? { ...item, collectionId: null } : item)); }} onMoveToCollection={(savedId, collectionId) => { setSaved(saved.map((item) => item.id === savedId ? { ...item, collectionId } : item)); notify('선택한 목록에 매장을 저장했습니다.'); }}/>
  if (view === 'history') return <RandomHistoryView history={randomHistory} onBack={() => setView('map')} onSelect={selectStore} onRemove={(id) => setRandomHistory(randomHistory.filter((item) => item.id !== id))} onClear={() => setRandomHistory([])}/>;

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand brand-home" type="button" aria-label="로컬픽 처음 화면 새로고침" onClick={() => window.location.reload()}><div className="brand-mark"><MapPin fill="currentColor"/></div><div><strong>로컬픽</strong><span>LOCAL PICK</span></div></button>
      <nav><button className="active"><Compass size={17}/> 가게 탐색</button><button onClick={() => setView('history')}><Dice5 size={17}/> 랜덤 기록 <em>{randomHistory.length}</em></button><button onClick={() => setView('saved')}><Heart size={17}/> 나의 컬렉션 <em>{saved.length}</em></button></nav>
    </header>

    <section className="search-area">
      <div className="search-row">
        <div className="region-select-wrap"><div className={`region-display ${usingCurrentLocation ? 'current-location' : ''}`}><MapPin size={18}/><span>{displayedLocationLabel}</span></div></div>
        <div className="search-box" ref={searchBoxRef}><Search size={20}/><input value={query} role="combobox" aria-expanded={showSearchSuggestions} aria-controls="search-place-suggestions" aria-activedescendant={highlightedSuggestionIndex >= 0 ? `search-suggestion-${highlightedSuggestionIndex}` : undefined} onChange={(e) => { setHasStarted(true); setUsingCurrentLocation(false); setSearchFocusStore(null); setChosenSearchResultId(null); setHighlightedSuggestionIndex(-1); setQuery(e.target.value); }} onKeyDown={(event) => { if (!showSearchSuggestions) return; if (event.key === 'ArrowDown') { event.preventDefault(); setHighlightedSuggestionIndex((index) => (index + 1) % searchSuggestions.length); } else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlightedSuggestionIndex((index) => index <= 0 ? searchSuggestions.length - 1 : index - 1); } else if (event.key === 'Enter' && highlightedSuggestionIndex >= 0) { event.preventDefault(); chooseSearchSuggestion(searchSuggestions[highlightedSuggestionIndex]); } else if (event.key === 'Escape') { event.preventDefault(); setChosenSearchResultId('dismissed'); setHighlightedSuggestionIndex(-1); } }} placeholder="음식 이름, 메뉴 또는 가게 이름을 검색해보세요"/><kbd>Enter</kbd>{query && <button onClick={() => { setQuery(''); setSearchFocusStore(null); setChosenSearchResultId(null); setHighlightedSuggestionIndex(-1); }}><X size={16}/></button>}{showSearchSuggestions && <div className="search-place-suggestions" id="search-place-suggestions" role="listbox"><div className="suggestions-heading"><strong>어느 장소를 찾으세요?</strong><small>↑↓ 선택 · Enter 이동</small></div>{searchSuggestions.map((store, index) => <button id={`search-suggestion-${index}`} role="option" aria-selected={highlightedSuggestionIndex === index} className={highlightedSuggestionIndex === index ? 'keyboard-active' : ''} key={store.id} onMouseEnter={() => setHighlightedSuggestionIndex(index)} onClick={() => chooseSearchSuggestion(store)}><MapPin size={15}/><span><strong>{store.name}</strong><small>{store.address || `${store.region} ${store.district}`}</small></span><em>{store.category}</em></button>)}</div>}</div>
        <button className="location-button" disabled={locationLoading} onClick={requestCurrentLocation}><LocateFixed size={19}/> {locationLoading ? '위치 확인 중' : '내 주변'}</button>
      </div>
      {searchFocusStore && query.trim() && <div className="selected-search-place"><span className="selected-search-label">검색한 장소</span><MapPin size={16}/><div><strong>{searchFocusStore.name}</strong><small>{searchFocusStore.address || `${searchFocusStore.region} ${searchFocusStore.district}`}</small></div><button onClick={() => setSearchFocusStore({ ...searchFocusStore })}>지도에서 보기</button><button className="clear-selected-search" aria-label="검색 장소 표시 닫기" onClick={() => { setSearchFocusStore(null); setChosenSearchResultId(null); }}><X size={15}/></button></div>}
      <div className="filter-row" onClick={() => setHasStarted(true)}>
        <div className="filter-group"><span>종류</span>{['전체','음식점','카페','한식','중식','일식','양식'].map((item) => <Chip key={item} active={category === item} onClick={() => setCategory(item)}>{item}</Chip>)}</div>
        <div className="divider"/>
        <div className="filter-group"><span>매장</span><Chip active={storeType === '전체'} onClick={() => setStoreType('전체')}>전체</Chip><Chip active={storeType === 'independent'} onClick={() => setStoreType('independent')}>개인 가게</Chip><Chip active={storeType === 'brand'} onClick={() => setStoreType('brand')}>브랜드</Chip></div>
      </div>
    </section>

    <main className="workspace">
      <aside className={`results-panel ${mobileList ? 'mobile-open' : ''}`}>
        <div className="results-heading"><div><h2>{query ? `‘${query}’ 검색 결과` : `${displayedLocationLabel}의 가게`}</h2><p>현재 지도 범위 기준 · 총 {filtered.length}곳 · 개인 가게 {independentCount}곳 {(apiLoading || publicLoading) && '· 실시간 검색 중'}</p>{(apiError || publicError) && <p className="api-error">{apiError || publicError}</p>}</div><div className="sort-control"><button className="sort-trigger" onClick={() => setSortOpen(!sortOpen)}><ListFilter size={17}/> {sortLabels[sortMode]} <ChevronDown size={14}/></button>{sortOpen && <div className="sort-menu">{Object.entries(sortLabels).map(([value, label]) => <button key={value} className={sortMode === value ? 'active' : ''} disabled={value === 'reviews' && query.trim().length < 2} title={value === 'reviews' && query.trim().length < 2 ? '검색어를 먼저 입력해 주세요.' : ''} onClick={() => { setSortMode(value); setSortOpen(false); }}>{label}{value === 'reviews' && <small>검색 결과 최대 5곳</small>}</button>)}</div>}</div></div>
        <div className="store-list">
          {query.trim().length >= 2 && !apiLoading && !publicLoading && (filtered.length === 0 || sortMode === 'reviews') && <section className="naver-results" aria-label="추가 검색 결과">
            <div className="naver-results-head"><div><strong>{sortMode === 'reviews' ? '리뷰 많은 순' : '추가 검색 결과'}</strong><small>{sortMode === 'reviews' ? '카페·블로그 리뷰 수 기준 · 최대 5곳' : '기본 검색에서 찾지 못한 장소'}</small></div>{naverLoading && <span>검색 중…</span>}</div>
            {naverError && <p className="api-error">{naverError}</p>}
            {!naverLoading && !naverError && naverStores.length === 0 && <p className="naver-empty">추가 검색 결과가 없습니다.</p>}
            {naverStores.map((store) => <article className="naver-result-card" key={store.id}>
              <strong>{store.name}</strong><span>{store.category}</span><p>{store.address}</p><div className="naver-result-actions"><button disabled={!Number.isFinite(store.lat) || !Number.isFinite(store.lng)} onClick={() => { setNaverPreviews([store]); setMobileList(false); }}>이 매장만 위치 보기</button><a href={store.link} target="_blank" rel="noreferrer">원본 보기 →</a></div>
            </article>)}
          </section>}
          {!hasStarted ? <div className="no-results"><MapPin/><h3>보고 싶은 지역을 선택해 주세요</h3><p>지역을 선택하거나 지도를 이동·확대하면 현재 화면의 모든 매장을 표시합니다.</p></div> : filtered.length ? <>{listStores.map((store) => <StoreCard key={store.id} store={store} congestion={congestionVisible ? findNearbyCongestion(store, seoulCongestionAreas) : null} saved={saved.some((s) => s.storeId === store.id)} onSave={saveStore} onSelect={selectStore}/>)}{filtered.length > listStores.length && <div className="list-limit-note">지도에는 전체 {filtered.length.toLocaleString()}곳을 표시하고 있습니다.<br/>목록은 성능을 위해 처음 250곳만 보여줍니다.</div>}</> : <div className="no-results"><Search/><h3>조건에 맞는 가게가 없어요</h3><p>검색 범위를 넓히거나 필터를 변경해 보세요.</p><button onClick={() => {setRegion('전국');setDistrict('전체');setCategory('전체');setStoreType('전체');setFocusLocation(null);setUsingCurrentLocation(false);}}>전국에서 다시 찾기</button></div>}
        </div>
      </aside>

      <section className="map-wrap">
        <MapContainer center={regions.전국.center} zoom={regions.전국.zoom} minZoom={6} maxZoom={22} zoomControl={false} preferCanvas>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={22} />
          <MapController region={region} district={district} focusStore={selectedStore || searchFocusStore} focusLocation={focusLocation}/>
          <KakaoSearchResultsController stores={apiStores} query={query} resultsQuery={apiResultsQuery} onFocused={(store) => { setSearchFocusStore(store); setMapLocationLabel([store.region, store.district].filter(Boolean).join(' ')); }}/>
          <NaverResultsController stores={naverPreviews} focusKey={`${query}|${region}|${district}`}/>
          <MapEvents onBusy={setMapBusy} onIdle={() => {}} onBounds={handleMapBounds} onUserExplore={() => { setHasStarted(true); setUsingCurrentLocation(false); }} onMapClick={routeDestination && !routeStart ? setRouteStart : null}/>
          {routeResult?.points?.length > 1 && <><RouteController points={routeResult.points}/><Polyline positions={routeResult.points} pathOptions={{ color:'#dc2626', weight:6, opacity:0.86 }}/></>}
          {selectedRouteSegmentIndex !== null && routeResult?.segments?.[selectedRouteSegmentIndex]?.points?.length > 1 && <><RouteController points={routeResult.segments[selectedRouteSegmentIndex].points}/><Polyline positions={routeResult.segments[selectedRouteSegmentIndex].points} pathOptions={{ color:'#2563eb', weight:9, opacity:0.95 }}/></>}
          {animatedTransitSegment && realtimeSubwayMarkers.length === 0 && realtimeBuses.length === 0 && <AnimatedRouteVehicle segment={animatedTransitSegment}/>} 
          {realtimeSubwayMarkers.map((train) => <RealtimeSubwayMarker key={`${train.trainNo}-${train.station}`} train={train}/>)}
          {realtimeBuses.map((bus) => <RealtimeBusMarker key={bus.vehicleId || `${bus.plateNumber}-${bus.lat}-${bus.lng}`} bus={bus}/>)}
          {routeStart && <CircleMarker center={[routeStart.lat, routeStart.lng]} radius={9} pathOptions={{ color:'#fff', weight:3, fillColor:'#2563eb', fillOpacity:1 }}><Popup><strong>출발지</strong></Popup></CircleMarker>}
          {routeDestination && <CircleMarker center={[routeDestination.lat, routeDestination.lng]} radius={10} pathOptions={{ color:'#fff', weight:3, fillColor:'#dc2626', fillOpacity:1 }}><Popup><strong>{routeDestination.name}</strong><br/>도착지</Popup></CircleMarker>}
          {routeWaypoints.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)).map((waypoint, index) => <CircleMarker key={waypoint.id} center={[waypoint.lat, waypoint.lng]} radius={9} pathOptions={{ color:'#fff', weight:3, fillColor:'#f59e0b', fillOpacity:1 }}><Popup><strong>경유지 {index + 1}</strong><br/>{waypoint.name}</Popup></CircleMarker>)}
          {focusLocation && <CircleMarker center={[focusLocation.lat, focusLocation.lng]} radius={9} pathOptions={{ color:'#fff', weight:3, fillColor:'#dc2626', fillOpacity:1 }}><Popup><strong>현재 위치</strong></Popup></CircleMarker>}
          {congestionVisible && seoulCongestionAreas.filter((area) => !bounds || bounds.contains([area.lat, area.lng])).map((area) => <CircleMarker key={`congestion-${area.name}`} center={[area.lat, area.lng]} radius={13} pathOptions={{ color: area.color, weight: 4, fillColor: area.color, fillOpacity: 0.22 }}><Popup><strong>{area.name}</strong><br/><span className="congestion-popup" style={{ color: area.color }}>주변 혼잡도 · {area.level}</span><br/><small>{area.category} · 매장 내부 혼잡도가 아닙니다.</small></Popup></CircleMarker>)}
          {naverPreviews.length === 0 && visibleMarkers.map((store) => <StoreMarker key={store.id} store={store} congestion={congestionVisible ? findNearbyCongestion(store, seoulCongestionAreas) : null} onSelect={selectStore} faded={false}/>) }
          {naverPreviews.map((store) => <CircleMarker key={store.id} center={[store.lat, store.lng]} radius={11} pathOptions={{ color:'#fff', weight:3, fillColor:'#16a34a', fillOpacity:1 }}><Popup><strong>{store.name}</strong><br/>{store.address}</Popup></CircleMarker>)}
          {searchFocusStore && <CircleMarker className="searched-place-marker" center={[searchFocusStore.lat, searchFocusStore.lng]} radius={13} pathOptions={{ color:'#fff', weight:4, fillColor:'#e11d48', fillOpacity:1 }}><Popup><strong>검색한 장소</strong><br/>{searchFocusStore.name}<br/><small>{searchFocusStore.address}</small></Popup></CircleMarker>}
        </MapContainer>
        {naverPreviews.length > 0 && <div className="naver-map-preview"><div><strong>검색 결과 {naverPreviews.length}곳</strong><span>검색 결과를 지도에 표시하고 있습니다.</span></div><button onClick={() => setNaverPreviews([])}>미리보기 닫기</button></div>}
        <button className={`congestion-toggle ${congestionVisible ? 'active' : ''} ${seoulCongestionStatus}`} onClick={() => { if (seoulCongestionStatus !== 'ready') { notify(seoulCongestionStatus === 'loading' ? '혼잡도 데이터를 불러오는 중입니다.' : '혼잡도 데이터를 불러오지 못했습니다. 개발 서버를 재시작해 주세요.'); return; } setCongestionVisible((value) => !value); }}><span/>{seoulCongestionStatus === 'loading' ? '혼잡도 불러오는 중' : seoulCongestionStatus === 'error' ? '혼잡도 연결 확인' : congestionVisible ? '혼잡도 끄기' : '혼잡도 보기'}<small>서울 주요 지역</small></button>
        <button className={`road-traffic-toggle ${roadTrafficVisible ? 'active' : ''}`} onClick={() => setRoadTrafficVisible((value) => !value)}><Navigation size={14}/>{roadTrafficVisible ? '도로상황 끄기' : '도로상황 보기'}<small>전국 실시간</small></button>
        {roadTrafficVisible && <div className={`road-traffic-card ${roadTrafficStatus}`}><div><strong>{roadTrafficStatus === 'loading' ? '도로정보 불러오는 중…' : roadTrafficStatus === 'error' ? '도로정보 연결 실패' : roadTraffic?.status || '정보 없음'}</strong>{roadTraffic?.averageSpeed !== null && roadTrafficStatus === 'ready' && <span>평균 {roadTraffic.averageSpeed}km/h · {roadTraffic.count.toLocaleString()}개 구간</span>}</div>{roadTrafficStatus === 'ready' && roadTraffic?.slowRoads.length > 0 && <small>느린 도로 · {roadTraffic.slowRoads.map((road) => `${road.name} ${road.speed}km/h`).join(' · ')}</small>}<em>현재 지도 범위의 측정 구간 평균</em></div>}
        {seoulCongestionUpdatedAt && congestionVisible && <div className="congestion-map-note"><strong>주변 혼잡도</strong><div className="congestion-legend"><span className="relaxed"/>여유<span className="normal"/>보통<span className="busy"/>약간 붐빔<span className="crowded"/>붐빔</div><small>서울시 지역 단위 · 5분마다 갱신</small></div>}
        {routePlannerOpen && <RoutePlanner start={routeStart} destination={routeDestination} waypoints={routeWaypoints} mode={routeMode} result={routeResult} loading={routeLoading || locationLoading} error={routeError} selectedAlternativeIndex={selectedRouteAlternativeIndex} selectedSegmentIndex={selectedRouteSegmentIndex} onStart={(place) => { setRouteStart(place); setRouteResult(null); setSelectedRouteSegmentIndex(null); }} onDestination={(place) => { setRouteDestination(place); setRouteResult(null); setSelectedRouteSegmentIndex(null); }} onWaypoints={(items) => { setRouteWaypoints(items); setRouteResult(null); setSelectedRouteSegmentIndex(null); }} onMode={(value) => { setRouteMode(value); setSelectedRouteSegmentIndex(null); }} onCurrentLocation={() => useCurrentLocationForRoute()} onSwap={() => { const previousStart = routeStart; setRouteStart(routeDestination); setRouteDestination(previousStart); setRouteWaypoints([...routeWaypoints].reverse()); setRouteResult(null); setSelectedRouteSegmentIndex(null); setRouteError(''); }} onSelectAlternative={(index) => { const alternatives = routeResult?.alternatives || []; const selected = alternatives[index]; if (selected) { setRouteResult({ ...selected, alternatives }); setSelectedRouteAlternativeIndex(index); setSelectedRouteSegmentIndex(null); } }} onSelectSegment={setSelectedRouteSegmentIndex} onClose={closeRoute}/>} 
        {realtimeBuses.length > 0 || realtimeSubwayMarkers.length > 0
          ? <div className="transit-animation-note realtime">서울시 실시간 {realtimeBuses.length > 0 && realtimeSubwayMarkers.length > 0 ? '버스·열차' : realtimeBuses.length > 0 ? '버스 차량' : '열차'} 위치 · 15~20초마다 갱신</div>
          : animatedTransitSegment && <div className="transit-animation-note">버스·지하철 아이콘은 경로 안내용 애니메이션이며 실제 차량 위치가 아닙니다.{(realtimeBusError || realtimeSubwayError) && ` (${realtimeBusError || realtimeSubwayError})`}</div>}
        <div className="quick-region-control" ref={quickRegionRef}>
          <button className="quick-region-trigger" onClick={() => { if (!quickRegionOpen) setQuickRegionStep('regions'); setQuickRegionOpen(!quickRegionOpen); }}><MapPin size={16}/><span>{region === '전국' ? '지역 이동' : region}</span><ChevronDown size={15}/></button>
          {quickRegionOpen && <div className="quick-region-menu">
            {quickRegionStep === 'regions' ? <>
              <div className="quick-region-title"><strong>어디로 이동할까요?</strong><small>먼저 시·도를 선택해 주세요.</small></div>
              <div className="quick-region-grid">{['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'].map((name) => <button className={region === name && district === '전체' ? 'active' : ''} key={name} onClick={() => { setHasStarted(true); setRegion(name); setDistrict('전체'); setFocusLocation(null); setUsingCurrentLocation(false); setQuickRegionStep('areas'); }}>{name}</button>)}</div>
            </> : <>
              <div className="quick-area-header"><button onClick={() => setQuickRegionStep('regions')}><ArrowLeft size={17}/></button><div><strong>{region} 안에서 이동</strong><small>이동할 세부 지역을 선택하세요.</small></div></div>
              <div className="quick-destination-grid">{getRegionDestinations(region).map((item) => <button key={item.name} onClick={() => { setHasStarted(true); setDistrict(item.district); setFocusLocation(item); setUsingCurrentLocation(false); setQuickRegionOpen(false); }}><MapPin size={13}/><span>{item.name}</span><small>{item.district}</small></button>)}</div>
            </>}
          </div>}
        </div>
        <div className="map-stats"><div><span className="stat-icon hidden">◆</span><div><strong>{visibleMarkers.filter(s => s.source === 'hidden').length}</strong><small>숨은 가게</small></div></div><div><span className="stat-icon local"><Store size={17}/></span><div><strong>{Math.round((visibleMarkers.filter(s=>s.type==='independent').length / Math.max(visibleMarkers.length,1))*100)}%</strong><small>개인 매장 비율</small></div></div></div>
        {(apiLoading || publicLoading) && visibleMarkers.length === 0 && <div className="map-loading"><span/> 현재 지역의 가게를 살펴보는 중…</div>}
        {hasStarted && !mapBusy && !apiLoading && !publicLoading && <button className="research-button" onClick={() => { setRefreshToken((value) => value + 1); notify('현재 지도 영역을 다시 검색합니다.'); }}><Search size={17}/> 이 지역에서 다시 검색</button>}
        <div className="legend"><strong>지도 범례</strong><span><i className="dot hidden"/> 숨은 가게</span><span><i className="dot local"/> 개인 가게</span><span><i className="dot brand"/> 브랜드</span></div>
        {!routePlannerOpen && <button className="route-launch-button" onClick={openRoutePlanner}><Navigation size={18}/> 길찾기</button>}
        <button className="floating-recommend" onClick={() => setRecommendOpen(true)}><Sparkles size={20}/><span><strong>오늘 어디 가지?</strong><small>취향에 맞게 골라드려요</small></span></button>
        <button className="mobile-toggle" onClick={() => setMobileList(!mobileList)}>{mobileList ? <><MapIcon size={18}/> 지도 보기</> : <><Menu size={18}/> 목록 보기 ({filtered.length})</>}</button>
      </section>
    </main>

    <nav className="mobile-bottom-nav" aria-label="모바일 주요 메뉴">
      <button className="active" onClick={() => setMobileList(false)}><Compass size={19}/><span>지도</span></button>
      <button onClick={() => setView('history')}><Dice5 size={19}/><span>랜덤 기록</span>{randomHistory.length > 0 && <em>{randomHistory.length}</em>}</button>
      <button onClick={() => setView('saved')}><Heart size={19}/><span>저장 목록</span>{saved.length > 0 && <em>{saved.length}</em>}</button>
    </nav>

    {selectedStore && <DetailPanel store={selectedStore} congestion={selectedCongestion} congestionInsight={congestionInsight} congestionInsightLoading={congestionInsightLoading} savedItem={saved.find((s) => s.storeId === selectedStore.id)} collections={collections} onClose={() => setSelectedStore(null)} onSave={saveStore} onUpdateSaved={updateSaved} onStartRoute={startRoute}/>} 
    {recommendOpen && <RecommendationModal candidates={filtered.length ? filtered : stores} onClose={() => setRecommendOpen(false)} onSelect={selectStore} onSave={(store) => saveStore(store, 'random')} onRecommend={recordRecommendation}/>} 
    {toast && <div className="toast"><Check size={17}/>{toast}</div>}
  </div>;
}
