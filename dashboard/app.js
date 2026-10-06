'use strict';

const FX = window.ExchangeRateUtils;
const TF = window.TravelFilter;
const PAGE = 15;
const MIN_TREND_N = 50; // ponytail: fixed sample floor so tiny/partial crawls don't draw misleading trend points
const DIFF_STEP = 30;
const MIN_PRICE_GUARD = 100;

const COUNTRY_CONFIG = {
  kr: { label: '한국' }, vn: { label: '베트남' }, th: { label: '태국' }, tw: { label: '대만' },
  hk: { label: '홍콩' }, mo: { label: '마카오' }, us: { label: '미국' },
};
const COUNTRIES = Object.keys(COUNTRY_CONFIG);
const SITE = {
  amazon_jp: { n: 'Amazon JP', l: 'A', bar: '#F59E0B' },
  qoo10_jp: { n: 'Qoo10 JP', l: 'Q', bar: '#EF4444' },
};
const PER = [['1일', 1, 1], ['2일', 2, 2], ['3일', 3, 3], ['4일', 4, 4], ['5일', 5, 5], ['7일', 6, 7], ['8일+', 8, 999]];
const NET = { local: 'Local', roaming: 'Roaming', unknown: '미확인' };
const GEN = { '5g_capable': ['5G', 'g5'], lte_4g_only: ['LTE', 'lte'], unknown: ['미확인', 'unknown'] };
const CARRIER_CONFIG = {
  kr: [['skt', 'SKT'], ['kt', 'KT'], ['lgu', 'LGU+']],
  vn: [['viettel', 'Viettel'], ['vinaphone', 'VinaPhone'], ['mobifone', 'MobiFone'], ['vietnamobile', 'Vietnamobile']],
  tw: [['chunghwa', 'Chunghwa Telecom'], ['taiwan_mobile', 'Taiwan Mobile'], ['fareastone', 'Far EasTone']],
  hk: [['cmhk', 'CMHK'], ['csl', 'CSL'], ['smartone', 'SmarTone'], ['three_hk', '3HK']],
  mo: [['ctm', 'CTM'], ['china_telecom_macau', 'China Telecom (Macau)'], ['three_macau', '3 Macau']],
  us: [['att', 'AT&T'], ['tmobile', 'T-Mobile'], ['verizon', 'Verizon']],
  th: [['ais', 'AIS'], ['dtac', 'dtac'], ['truemove', 'TrueMove H']],
};
const CARRIER_ALIASES = {
  kr: { skt: ['skt', 'sk telecom', 'sktelecom'], kt: ['kt', 'kt olleh', 'olleh'], lgu: ['lg u+', 'lgu+', 'uplus', 'lg u plus', 'lgu'] },
  vn: { viettel: ['viettel'], vinaphone: ['vinaphone', 'vina phone', 'vnpt'], mobifone: ['mobifone', 'mobi phone'], vietnamobile: ['vietnamobile', 'vietnam mobile'] },
  tw: { chunghwa: ['chunghwa', '中華電信', 'cht'], taiwan_mobile: ['taiwan mobile', '台灣大哥大', 'twm'], fareastone: ['far eas tone', 'far eastone', '遠傳', 'fet'] },
  hk: { cmhk: ['cmhk', 'china mobile hong kong', '中國移動香港'], csl: ['csl', 'one2free', '1o1o', 'pccw-hkt'], smartone: ['smartone', 'smart one'], three_hk: ['3hk', '3 hong kong', 'three hk'] },
  mo: { ctm: ['ctm', 'macau telecom', '澳門電訊'], china_telecom_macau: ['china telecom macau', '中國電信澳門', 'ctm macau'], three_macau: ['3 macau', 'three macau', 'hutchison telephone macau'] },
  us: { att: ['at&t', 'att'], tmobile: ['t-mobile', 'tmobile'], verizon: ['verizon'] },
  th: { ais: ['ais', 'advanced info service'], dtac: ['dtac'], truemove: ['truemove', 'truemove h', 'true move'] },
};
const SORTS = {
  unit: ['1일당 낮은순 (가성비)', (a, b) => (a.unit ?? 1e12) - (b.unit ?? 1e12)],
  price: ['가격 낮은순', (a, b) => a.price_jpy - b.price_jpy],
  priceDesc: ['가격 높은순', (a, b) => b.price_jpy - a.price_jpy],
  review: ['리뷰 많은순', (a, b) => (b.review_count ?? -1) - (a.review_count ?? -1)],
  sales: ['판매량 높은순 (Amazon)', (a, b) => (b.monthly_sold_count ?? -1) - (a.monthly_sold_count ?? -1)],
  position: ['검색 상위순 (Qoo10)', (a, b) => (a.search_position ?? 1e9) - (b.search_position ?? 1e9)],
  days: ['사용기간 짧은순', (a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)],
};
const HELP = {
  blocks: [
    ['필터', '좌측 필터는 모든 섹션에 공통 적용됩니다. 국가·플랫폼·사용기간은 여러 개를 동시에 선택할 수 있고, 상단 칩의 × 로 하나씩 해제합니다. 국가 카드나 히트맵 셀을 눌러도 필터가 적용됩니다.'],
    ['1일당 가격', 'JPY 가격을 실시간 환율(Frankfurter, ECB 기준)로 KRW 환산한 뒤 사용기간(일)으로 나눈 값입니다. 사용기간을 알 수 없는 상품은 1일당 비교에서 제외됩니다. 환율 조회에 실패하면 최근 성공 환율 캐시를 쓰고, 캐시도 없으면 KRW 환산이 비활성화됩니다.'],
    ['제외되는 상품', '일본 국내 통신사 가입 패키지(UQ mobile 등)나 SIM과 무관한 상품은 크롤링 단계에서 제외되며, 이미 수집된 과거 데이터도 대시보드에서 숨깁니다. “이상치 제외”는 ¥100 미만의 비정상 가격을 숨기는 토글입니다.'],
    ['시점별 변경 상품', '“비교 기준”에서 이전 수집 시점을 고르면 같은 국가·플랫폼 시리즈에서 가격이 달라졌거나(JPY 기준), 검색 결과에 새로 나타났거나(신규 노출) 사라진(노출 종료) 상품을 보여줍니다. ‘노출 종료’는 판매 종료가 아니라 수집 범위 밖으로 밀린 경우도 포함하며, 수집 개수 제한이 다르면 안내 문구가 표시됩니다. 한쪽 시점에 없는 국가·플랫폼은 비교에서 제외됩니다.'],
    ['가격 추이', '수집 시점별 상품 중앙가(JPY)입니다. 표본이 ' + MIN_TREND_N + '개 미만인 수집분은 제외합니다. 범례를 눌러 국가를 켜고 끌 수 있습니다.'],
    ['unknown(미확인)', '네트워크·망 세대·통신사 정보가 없거나 근거가 충분하지 않은 경우입니다. 추측으로 채우지 않습니다.'],
    ['다크 모드', '우측 상단 버튼으로 전환하며 선택값은 브라우저에 저장됩니다. 저장값이 없으면 시스템 설정을 따릅니다.'],
  ],
  terms: [
    ['usage_validity', '실제 사용 가능 기간입니다.'],
    ['activation_validity', '구매 후 개통해야 하는 기한입니다.'],
    ['network_type', 'local / roaming / unknown. 현지 회선·현지 번호·로밍 문구로 분류합니다.'],
    ['network_generation', '5G 지원 / LTE·4G 전용 / 미확인.'],
    ['monthly_sold_count', 'Amazon 최근 1개월 판매량 신호(공개된 경우만).'],
    ['seller_badge', 'Qoo10 셀러 등급(Power / Good / General seller).'],
  ],
};

/* ── helpers ── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const href = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '');
const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
const yen = (n) => '¥' + Math.round(n).toLocaleString('ko-KR');
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const perOf = (d) => { if (!d) return null; const p = PER.find(([, lo, hi]) => d >= lo && d <= hi); return p ? p[0] : null; };
const dot = (c) => `<span class="dot" style="background:var(--c-${c})"></span>`;
const cn = (c) => (COUNTRY_CONFIG[c] ? COUNTRY_CONFIG[c].label : String(c).toUpperCase());
const minBy = (a, k) => a.reduce((m, r) => (r[k] != null && (!m || r[k] < m[k]) ? r : m), null);
const isoLocal = (iso) => { const d = new Date(iso); return !iso || Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
};

function dateKey(v) {
  if (!v) return 'unknown';
  const s = String(v), m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // legacy MM/DD/YYYY
  return m ? `${m[3]}-${m[1]}-${m[2]}` : s.slice(0, 10);
}
function parseJsonl(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
function resolveDataPath(p, fallback) {
  if (!p) return fallback;
  const t = String(p).trim();
  if (t.startsWith('./')) return t;
  if (t.startsWith('/')) return `.${t}`;
  return `./data/${t}`;
}

/* ── normalization (carrier logic carried over from the previous dashboard) ── */
const carrierDefs = (c) => CARRIER_CONFIG[c] || [];
function normalizeCarrier(raw, country) {
  const defs = carrierDefs(country);
  if (!defs.length) return {};
  let src = raw.carrier_support_local;
  if (!src || typeof src !== 'object') src = country === 'kr' && raw.carrier_support_kr && typeof raw.carrier_support_kr === 'object' ? raw.carrier_support_kr : null;
  if (!src) {
    const bag = [raw.title, raw.seller, raw.brand, ...(raw.evidence && typeof raw.evidence === 'object' ? Object.values(raw.evidence).flat().filter(Boolean) : [])].join(' ').toLowerCase();
    src = {};
    Object.entries(CARRIER_ALIASES[country] || {}).forEach(([code, aliases]) => { src[code] = aliases.some((a) => bag.includes(String(a).toLowerCase())); });
  }
  return Object.fromEntries(defs.map(([code]) => [code, src[code] === true]));
}
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const daysOf = (v) => { const m = String(v || '').match(/(\d{1,4})\s*일/); return m ? Number(m[1]) : null; };

function normalizeItem(raw, rec) {
  const country = String(raw.country || rec.country || 'kr').toLowerCase();
  const site = raw.site || rec.site || 'amazon_jp';
  const carrier = normalizeCarrier(raw, country);
  const price = Number(raw.price_jpy);
  const usage = raw.usage_validity || raw.validity || null;
  return {
    site, country, title: raw.title || '', product_url: typeof raw.product_url === 'string' ? raw.product_url : null,
    price_jpy: Number.isFinite(price) && price > 0 ? price : null,
    review_count: num(raw.review_count), seller_badge: raw.seller_badge || null, search_position: num(raw.search_position),
    monthly_sold_count: num(raw.monthly_sold_count), is_bestseller: typeof raw.is_bestseller === 'boolean' ? raw.is_bestseller : null,
    bestseller_rank: num(raw.bestseller_rank), network_type: raw.network_type || 'unknown', network_generation: raw.network_generation || 'unknown',
    data_amount: raw.data_amount || null, usage_validity: usage, activation_validity: raw.activation_validity || null,
    seller: raw.seller ? String(raw.seller).replace('のストアを表示', '') : null, brand: raw.brand || null,
    asin: raw.asin || null, site_product_id: raw.site_product_id || null,
    carrier_support_local: carrier, ca: Object.keys(carrier).filter((k) => carrier[k]), days: daysOf(usage),
  };
}
const keepItem = (it) => it.price_jpy != null && TF.isTravelProduct(it.title);
function decorate(items) {
  return FX.attachKrwPrices(items, S.fx).map((r) => ({
    ...r,
    unit: r.price_krw && r.days ? Math.round(r.price_krw / r.days) : null,
    per: perOf(r.days),
    key: `${r.site}|${r.country}|${r.asin || r.site_product_id || r.title}`,
  }));
}

/* ── state ── */
const F0 = () => ({ country: new Set(), site: new Set(), per: new Set(), net: '', gen: '', data: '', carrier: '', pmin: null, pmax: null, q: '', sort: 'unit', guard: true });
const S = {
  fx: FX.buildExchangeRateMeta({ unavailable: true, stale: true }),
  groups: [], datasetId: 'latest', cur: null, items: [], F: F0(),
  trend: {}, trendLoading: false, trendSite: 'amazon_jp', off: new Set(), hm: 'min',
  diffBaseId: '', diffBase: null, diffTab: 'all', diffLimit: DIFF_STEP,
  page: 1, open: true,
};
const rawCache = new Map(); // jsonl path -> Promise<normalized items>
const groupCache = new Map(); // group id -> Promise<decorated items>

/* ── data loading ── */
async function loadIndex() {
  for (const url of ['./data/index.json', '/api/index']) {
    try { const res = await fetch(url, { cache: 'no-store' }); if (res.ok) return await res.json(); } catch (_) { /* try next */ }
  }
  return { latest: {}, runs: [] };
}
function buildGroups(index) {
  const withMeta = (g) => {
    const recs = [...g.recs.values()];
    g.crawledAt = recs.map((r) => r.crawled_at || '').sort().at(-1) || null;
    g.date = dateKey(g.crawledAt);
    g.countries = new Set(recs.map((r) => r.country));
    g.count = recs.reduce((n, r) => n + (Number(r.item_count) || 0), 0);
    return g;
  };
  const latest = new Map();
  Object.entries(index.latest || {}).forEach(([site, v]) => {
    const byCountry = v && (v.jsonl || v.csv) ? { kr: v } : v || {};
    Object.entries(byCountry).forEach(([c, rec]) => { if (rec && rec.jsonl) latest.set(`${site}|${c}`, { ...rec, site, country: rec.country || c }); });
  });
  const byDate = new Map();
  (index.runs || []).forEach((run) => {
    if (!run || !run.jsonl) return;
    const site = run.site || 'amazon_jp', country = run.country || 'kr', d = dateKey(run.crawled_at);
    const g = byDate.get(d) || byDate.set(d, new Map()).get(d), k = `${site}|${country}`, prev = g.get(k);
    if (!prev || (run.crawled_at || '') > (prev.crawled_at || '')) g.set(k, { ...run, site, country });
  });
  const dated = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, recs]) => withMeta({ id: d, recs }));
  const groups = dated.map((g) => ({ ...g, label: `${g.date} · ${g.countries.size}개국 · ${g.count.toLocaleString('ko-KR')}개` }));
  if (latest.size) {
    const g = withMeta({ id: 'latest', recs: latest });
    groups.unshift({ ...g, label: `최신 (${g.date}) · ${g.countries.size}개국` });
  }
  return groups;
}
function loadRun(rec) {
  const path = resolveDataPath(rec.jsonl, `./data/sites/${rec.site}/${rec.country}/latest.jsonl`);
  if (!rawCache.has(path)) {
    rawCache.set(path, fetch(path, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '')
      .then((t) => parseJsonl(t).map((raw) => normalizeItem(raw, rec)).filter(keepItem)));
  }
  return rawCache.get(path);
}
function loadGroup(g) {
  if (!groupCache.has(g.id)) groupCache.set(g.id, Promise.all([...g.recs.values()].map(loadRun)).then((l) => decorate(l.flat())));
  return groupCache.get(g.id);
}

async function loadTrend() {
  S.trendLoading = true;
  for (const g of S.groups.filter((x) => x.id !== 'latest')) {
    const items = await loadGroup(g), by = {};
    items.forEach((r) => { (by[`${r.site}|${r.country}`] ??= []).push(r.price_jpy); });
    Object.entries(by).forEach(([k, v]) => { if (v.length >= MIN_TREND_N) (S.trend[k] ??= {})[g.date] = [med(v), v.length]; });
    renderTrend();
  }
  S.trendLoading = false;
  render();
}

/* ── filtering ── */
function pass(r, skip) {
  const F = S.F, q = F.q.trim().toLowerCase();
  return (skip === 'country' || !F.country.size || F.country.has(r.country)) &&
    (skip === 'site' || !F.site.size || F.site.has(r.site)) &&
    (skip === 'per' || !F.per.size || F.per.has(r.per)) &&
    (!F.guard || r.price_jpy >= MIN_PRICE_GUARD) && (!F.net || r.network_type === F.net) && (!F.gen || r.network_generation === F.gen) &&
    (!F.data || r.data_amount === F.data) && (!F.carrier || (F.carrier === 'any' ? r.ca.length > 0 : r.ca.includes(F.carrier))) &&
    (F.pmin == null || r.price_jpy >= F.pmin) && (F.pmax == null || r.price_jpy <= F.pmax) &&
    (!q || [r.title, r.seller, r.brand, r.seller_badge].join(' ').toLowerCase().includes(q));
}
const rows = (skip) => S.items.filter((r) => pass(r, skip));

/* ── sidebar ── */
const CHK = '<span class="check"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
function seg(id, key, opts, cur) {
  $(id).innerHTML = opts.map(([v, l]) => `<button type="button" data-k="${key}" data-v="${esc(v)}" aria-pressed="${cur === v}">${l}</button>`).join('');
}
function renderSide() {
  const F = S.F, byCountry = rows('country'), bySite = rows('site');
  $('f-country').innerHTML = COUNTRIES.map((c) => `<button class="opt" type="button" data-k="country" data-v="${c}" aria-pressed="${F.country.has(c)}"><span class="opt-l">${CHK}<span class="cc">${c.toUpperCase()}</span>${cn(c)}</span><span class="cnt">${byCountry.filter((r) => r.country === c).length}</span></button>`).join('');
  $('f-site').innerHTML = Object.keys(SITE).map((s) => `<button class="opt" type="button" data-k="site" data-v="${s}" aria-pressed="${F.site.has(s)}"><span class="opt-l">${CHK}<span class="pf ${s}">${SITE[s].l}</span>${SITE[s].n}</span><span class="cnt">${bySite.filter((r) => r.site === s).length}</span></button>`).join('');
  $('f-days').innerHTML = PER.map(([l]) => `<button class="chip" type="button" data-k="per" data-v="${l}" aria-pressed="${F.per.has(l)}">${l}</button>`).join('');
  seg('f-net', 'net', [['', '전체'], ['local', 'Local'], ['roaming', 'Roaming']], F.net);
  seg('f-gen', 'gen', [['', '전체'], ['5g_capable', '5G'], ['lte_4g_only', 'LTE']], F.gen);
  const dataOpts = Object.entries(S.items.reduce((m, r) => (r.data_amount && (m[r.data_amount] = (m[r.data_amount] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 14);
  $('f-data').innerHTML = '<option value="">전체</option>' + dataOpts.map(([g, n]) => `<option value="${esc(g)}"${F.data === g ? ' selected' : ''}>${esc(g)} (${n})</option>`).join('');
  const sel = F.country.size === 1 ? carrierDefs([...F.country][0]) : [];
  if (F.carrier && F.carrier !== 'any' && !sel.some(([c]) => c === F.carrier)) F.carrier = '';
  $('f-carrier').innerHTML = '<option value="">전체</option><option value="any"' + (F.carrier === 'any' ? ' selected' : '') + '>통신사 명시 상품</option>' +
    sel.map(([c, l]) => `<option value="${c}"${F.carrier === c ? ' selected' : ''}>${esc(l)} 지원</option>`).join('');
  $('f-guard').setAttribute('aria-pressed', F.guard);
  $('sort').innerHTML = Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${F.sort === k ? ' selected' : ''}>${l}</option>`).join('');
}
function renderActive(rs) {
  const F = S.F, tags = [];
  F.country.forEach((c) => tags.push(['country', c, cn(c)]));
  F.site.forEach((s) => tags.push(['site', s, SITE[s].n]));
  F.per.forEach((p) => tags.push(['per', p, p]));
  if (F.net) tags.push(['net', '', NET[F.net]]);
  if (F.gen) tags.push(['gen', '', GEN[F.gen][0]]);
  if (F.data) tags.push(['data', '', F.data]);
  if (F.carrier) tags.push(['carrier', '', F.carrier === 'any' ? '통신사 명시' : (carrierDefs([...F.country][0] || '').find(([c]) => c === F.carrier) || [0, F.carrier])[1]]);
  if (F.pmin != null || F.pmax != null) tags.push(['price', '', `${F.pmin ?? 0}~${F.pmax ?? ''} JPY`]);
  if (F.q) tags.push(['q', '', `"${F.q}"`]);
  $('mcount').textContent = tags.length ? `(${tags.length})` : '';
  $('active').innerHTML = `<span class="lbl">${tags.length ? '적용된 필터' : '필터 없음 · 전체 데이터'}</span>` +
    tags.map(([k, v, l]) => `<span class="tag">${esc(l)}<button type="button" data-rm="${k}" data-v="${esc(v)}" aria-label="${esc(l)} 필터 해제">×</button></span>`).join('') +
    `<span class="result"><b>${rs.length.toLocaleString('ko-KR')}</b>개 상품</span>`;
}

/* ── hero ── */
function snapDelta(c, site) {
  const t = S.trend[`${site}|${c}`]; if (!t) return null;
  const d = Object.keys(t).sort(); if (d.length < 2) return null;
  const a = t[d.at(-2)][0], b = t[d.at(-1)][0];
  return { pct: (b - a) / a * 100 };
}
const deltaChip = (x) => !x ? '<span class="delta flat" title="비교할 이전 수집분 없음">–</span>' : Math.abs(x.pct) < 0.5 ? '<span class="delta flat">0.0%</span>' : x.pct < 0 ? `<span class="delta down">▼ ${Math.abs(x.pct).toFixed(1)}%</span>` : `<span class="delta up">▲ ${x.pct.toFixed(1)}%</span>`;
function renderHero(rs) {
  const b = minBy(rs, 'unit');
  const g5 = rs.length ? Math.round(rs.filter((r) => r.network_generation === '5g_capable').length / rs.length * 100) : 0;
  const m = med(rs.map((r) => r.unit).filter((v) => v != null));
  const link = (r) => (href(r.product_url) ? `<a href="${href(r.product_url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title));
  $('best').innerHTML = b ? `<div><div class="eyebrow">현재 필터 기준 1일 최저가</div><div class="big">${won(b.unit)}<small>/일</small></div><div class="what">${link(b)}</div>
    <div class="meta"><span>${cn(b.country)}</span><span>${SITE[b.site].n}</span><span>${b.days}일</span><span>${esc(b.data_amount || '데이터 미확인')}</span><span>${NET[b.network_type]}</span></div></div>
    <div class="kpis"><div><b>${rs.length.toLocaleString('ko-KR')}</b><span>상품 수</span></div><div><b>${m ? won(m) : '-'}</b><span>1일당 중앙값</span></div><div><b>${g5}%</b><span>5G 지원</span></div></div>`
    : `<div class="what">${S.items.length ? (S.fx.unavailable ? 'KRW 환산이 불가능해 1일 최저가를 계산할 수 없습니다.' : '조건에 맞는 상품이 없습니다.') : '데이터를 불러오는 중...'}</div>`;
  const base = rows('country'), site = S.F.site.size === 1 ? [...S.F.site][0] : 'amazon_jp';
  $('ccards').innerHTML = COUNTRIES.map((c) => {
    const cr = base.filter((r) => r.country === c), mn = minBy(cr, 'unit'), on = !S.F.country.size || S.F.country.has(c);
    return `<button class="ccard${on ? '' : ' dim'}" type="button" data-k="country" data-v="${c}" aria-pressed="${S.F.country.has(c)}">
      <div class="row"><span class="nm">${dot(c)}${cn(c)}</span>${deltaChip(snapDelta(c, site))}</div>
      <div class="px">${mn ? won(mn.unit) : '-'}<small>/일</small></div>
      <div class="sub"><span>상품 ${cr.length}개</span><span>${mn ? SITE[mn.site].n : ''}</span></div></button>`;
  }).join('');
  $('kpi-countries').textContent = new Set(S.items.map((r) => r.country)).size;
  $('kpi-sites').textContent = new Set(S.items.map((r) => r.site)).size;
  $('kpi-total').textContent = S.items.length.toLocaleString('ko-KR');
}

/* ── trend ── */
function renderTrend() {
  seg('t-site', 'trendSite', Object.keys(SITE).map((s) => [s, SITE[s].n]), S.trendSite);
  const cs = COUNTRIES.filter((c) => (!S.F.country.size || S.F.country.has(c)) && S.trend[`${S.trendSite}|${c}`]);
  $('legend').innerHTML = cs.map((c) => `<button class="lg" type="button" data-lg="${c}" aria-pressed="${!S.off.has(c)}">${dot(c)}${cn(c)}</button>`).join('');
  const dates = [...new Set(cs.flatMap((c) => Object.keys(S.trend[`${S.trendSite}|${c}`])))].sort();
  const vis = cs.filter((c) => !S.off.has(c));
  const vals = vis.flatMap((c) => Object.values(S.trend[`${S.trendSite}|${c}`]).map((v) => v[0]));
  if (dates.length < 2 || !vals.length) {
    $('trend').innerHTML = `<div class="empty-state">${S.trendLoading ? '수집 이력을 불러오는 중...' : '비교할 수집 이력이 2회 미만입니다.'}</div>`;
    $('trend-insight').textContent = ''; return;
  }
  const W = 720, H = 250, L = 52, R = 56, T = 14, B = 30;
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .15 || 100; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i) => L + i * (W - L - R) / (dates.length - 1), y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v / 10) * 10}</text>`; }
  dates.forEach((d, i) => { g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.slice(2).replace(/-/g, '.')}</text>`; });
  vis.forEach((c) => {
    const t = S.trend[`${S.trendSite}|${c}`], pts = dates.map((d, i) => (t[d] ? [x(i), y(t[d][0]), t[d][0]] : null)).filter(Boolean);
    g += `<polyline fill="none" style="stroke:var(--c-${c})" stroke-width="2.4" stroke-linejoin="round" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}"/>` +
      pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" style="stroke:var(--c-${c})" stroke-width="2"><title>${cn(c)} ${yen(p[2])}</title></circle>`).join('') +
      `<text class="endlbl" x="${pts.at(-1)[0] + 8}" y="${pts.at(-1)[1] + 4}" style="fill:var(--c-${c})">${cn(c)}</text>`;
  });
  $('trend').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="수집 시점별 중앙가 추이">${g}</svg>`;
  const ch = vis.map((c) => { const t = S.trend[`${S.trendSite}|${c}`], k = Object.keys(t).sort(); return k.length > 1 ? [c, (t[k.at(-1)][0] - t[k[0]][0]) / t[k[0]][0] * 100] : null; }).filter(Boolean).sort((a, b) => a[1] - b[1]);
  const w = (p) => `${Math.abs(p).toFixed(1)}% ${p < 0 ? '하락' : '상승'}`;
  $('trend-insight').textContent = ch.length ? `${dates[0]} 대비 ${cn(ch[0][0])} 중앙가는 ${w(ch[0][1])}, ${cn(ch.at(-1)[0])}는 ${w(ch.at(-1)[1])}했습니다.` : '';
}

/* ── platform competitiveness + heatmap ── */
function cellMap(rs) {
  const m = {};
  rs.forEach((r) => { if (r.unit != null && r.per) ((m[r.country] ??= {})[r.per] ??= []).push(r); });
  return m;
}
function renderVend(rs) {
  const cm = cellMap(rs), stat = Object.fromEntries(Object.keys(SITE).map((s) => [s, { wins: 0, rows: rs.filter((r) => r.site === s) }]));
  Object.values(cm).forEach((byp) => Object.values(byp).forEach((a) => { stat[minBy(a, 'unit').site].wins++; }));
  const total = Object.values(stat).reduce((n, s) => n + s.wins, 0) || 1, mx = Math.max(...Object.values(stat).map((s) => s.wins), 1);
  $('vend').innerHTML = Object.entries(stat).sort((a, b) => b[1].wins - a[1].wins).map(([s, v], i) => {
    const mn = minBy(v.rows, 'unit'), mdn = med(v.rows.map((r) => r.unit).filter(Boolean)), rv = v.rows.map((r) => r.review_count).filter(Number.isFinite);
    const g5 = v.rows.length ? Math.round(v.rows.filter((r) => r.network_generation === '5g_capable').length / v.rows.length * 100) : 0;
    return `<li><span class="rk">${i + 1}</span><div><div class="nm"><span class="pf ${s}">${SITE[s].l}</span>${SITE[s].n}</div>
      <div class="bar"><i style="width:${v.wins / mx * 100}%;background:${SITE[s].bar}"></i></div>
      <div class="sub">최저가 보유 ${v.wins}칸 (${Math.round(v.wins / total * 100)}%) · 상품 ${v.rows.length}개 · 1일당 중앙 ${mdn ? won(mdn) : '-'} · 5G ${g5}% · 평균 리뷰 ${rv.length ? Math.round(rv.reduce((a, b) => a + b, 0) / rv.length).toLocaleString('ko-KR') : '-'}</div></div>
      <div class="px">${mn ? won(mn.unit) : '-'}<small>최저 1일가</small></div></li>`;
  }).join('');
}
function ramp(t) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const st = dark ? [[30, 41, 59], [30, 64, 175], [59, 130, 246], [191, 219, 254]] : [[239, 246, 255], [147, 197, 253], [37, 99, 235], [30, 58, 138]];
  const p = Math.min(.999, Math.max(0, t)) * 3, i = Math.floor(p), f = p - i, a = st[i], b = st[i + 1];
  return { bg: `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`, fg: dark ? (t > .7 ? '#0B1220' : '#E6EDF7') : (t > .38 ? '#fff' : '#0F172A') };
}
function renderHeat() {
  seg('hm-mode', 'hm', [['min', '최저가'], ['med', '중앙가']], S.hm);
  const cm = cellMap(rows('per')), cs = COUNTRIES.filter((c) => !S.F.country.size || S.F.country.has(c));
  const val = (a) => (!a ? null : S.hm === 'min' ? minBy(a, 'unit') : { unit: Math.round(med(a.map((r) => r.unit))), site: null });
  const col = PER.map(([l]) => { const v = cs.map((c) => val(cm[c]?.[l])?.unit).filter((n) => n != null); return { lo: Math.min(...v), hi: Math.max(...v) }; });
  $('hm-head').innerHTML = `<tr><th></th>${PER.map(([l]) => `<th>${l}</th>`).join('')}</tr>`;
  $('hm-body').innerHTML = cs.map((c) => `<tr><td class="rl"><span class="opt-l">${dot(c)}${cn(c)}</span></td>${PER.map(([l], j) => {
    const v = val(cm[c]?.[l]); if (!v) return '<td><div class="hm-cell empty"><b>–</b></div></td>';
    const t = col[j].hi === col[j].lo ? 0 : (v.unit - col[j].lo) / (col[j].hi - col[j].lo), k = ramp(t);
    const sel = S.F.country.size === 1 && S.F.country.has(c) && S.F.per.size === 1 && S.F.per.has(l);
    return `<td><button type="button" class="hm-cell${v.unit === col[j].lo ? ' win' : ''}${sel ? ' sel' : ''}" data-hm-c="${c}" data-hm-p="${l}" style="--bg-c:${k.bg};--fg-c:${k.fg}" aria-label="${cn(c)} ${l} ${won(v.unit)}"><b>${won(v.unit)}</b><span>${v.site ? SITE[v.site].l + ' · ' : ''}${cm[c][l].length}개</span></button></td>`;
  }).join('')}</tr>`).join('');
}

/* ── premium + generation ── */
function renderMarket(rs) {
  const cs = COUNTRIES.filter((c) => !S.F.country.size || S.F.country.has(c));
  const pr = cs.map((c) => {
    const L = rs.filter((r) => r.country === c && r.network_type === 'local' && r.unit), Ro = rs.filter((r) => r.country === c && r.network_type === 'roaming' && r.unit);
    if (L.length < 3 || Ro.length < 3) return { c, na: true, nl: L.length, nr: Ro.length };
    const a = med(L.map((r) => r.unit)), b = med(Ro.map((r) => r.unit));
    return { c, pct: (b - a) / a * 100, a, b };
  });
  const mx = Math.max(30, ...pr.filter((p) => !p.na).map((p) => Math.abs(p.pct)));
  $('prem').innerHTML = pr.map((p) => (p.na
    ? `<div class="prem-row"><span class="nm">${dot(p.c)}${cn(p.c)}</span><div class="axis"></div><div class="v na">표본 부족<small>Local ${p.nl} · Roaming ${p.nr}</small></div></div>`
    : `<div class="prem-row"><span class="nm">${dot(p.c)}${cn(p.c)}</span><div class="axis"><i class="${p.pct >= 0 ? 'pos' : 'neg'}" style="${p.pct >= 0 ? 'left' : 'right'}:50%;width:${Math.min(50, Math.abs(p.pct) / mx * 50)}%"></i></div>
      <div class="v ${p.pct >= 0 ? 'pos' : 'neg'}">${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(0)}%<small>${won(p.a)} → ${won(p.b)}</small></div></div>`)).join('') +
    '<div class="axis-l"><span></span><div><span>◀ 저렴</span><span>Roaming 비쌈 ▶</span></div><span></span></div>';
  const ok = pr.filter((p) => !p.na);
  $('prem-insight').textContent = ok.length ? `Roaming이 Local보다 비싼 국가 ${ok.filter((p) => p.pct > 0).length}/${ok.length}곳 · 가장 큰 차이는 ${cn([...ok].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0].c)}입니다.` : '';
  const gr = cs.map((c) => { const a = rs.filter((r) => r.country === c), g = (k) => a.filter((r) => r.network_generation === k).length; return { c, n: a.length, f: g('5g_capable'), l: g('lte_4g_only'), u: g('unknown') }; });
  $('gen').innerHTML = gr.map((r) => { const n = r.n || 1; return `<div class="gen-row"><span class="nm">${dot(r.c)}${cn(r.c)}</span><div class="stack" role="img" aria-label="${cn(r.c)} 5G ${r.f}개, LTE ${r.l}개, 미확인 ${r.u}개"><i style="width:${r.f / n * 100}%;background:var(--stack-5g)"></i><i style="width:${r.l / n * 100}%;background:var(--stack-lte)"></i><i style="width:${r.u / n * 100}%;background:var(--stack-unk)"></i></div><span class="v">${Math.round(r.f / n * 100)}%</span></div>`; }).join('');
  const tot = gr.reduce((a, r) => a + r.n, 0), k = gr.reduce((a, r) => a + r.f + r.l, 0);
  $('gen-insight').textContent = tot ? `망 세대 확인 상품은 ${Math.round(k / tot * 100)}%이며, 나머지는 근거 부족으로 미확인 처리됩니다.` : '';
}

/* ── snapshot diff ── */
function diffOptions() {
  const cur = S.cur; if (!cur) return [];
  const curKeys = new Set(cur.recs.keys());
  return S.groups.filter((g) => g.id !== 'latest' && g.date < cur.date && [...g.recs.keys()].some((k) => curKeys.has(k)));
}
function setDiffBase(id) {
  S.diffBaseId = id; S.diffBase = null; S.diffLimit = DIFF_STEP;
  const g = S.groups.find((x) => x.id === id);
  if (g) loadGroup(g).then((items) => { if (S.diffBaseId === id) { S.diffBase = items; renderDiff(); } });
}
function renderDiffControls() {
  const opts = diffOptions(), sel = $('diff-base');
  sel.innerHTML = opts.length ? opts.map((g) => `<option value="${g.id}"${g.id === S.diffBaseId ? ' selected' : ''}>${g.label}</option>`).join('') : '<option value="">이전 수집 없음</option>';
  sel.disabled = !opts.length;
  if (opts.length && !opts.some((g) => g.id === S.diffBaseId)) setDiffBase(opts[0].id);
  if (!opts.length) { S.diffBaseId = ''; S.diffBase = null; }
}
function computeDiff() {
  const curSeries = new Set(S.items.map((r) => `${r.site}|${r.country}`)), shared = new Set(S.diffBase.map((r) => `${r.site}|${r.country}`).filter((k) => curSeries.has(k)));
  const inSeries = (r) => shared.has(`${r.site}|${r.country}`);
  const cm = new Map(S.items.filter(inSeries).map((r) => [r.key, r])), bm = new Map(S.diffBase.filter(inSeries).map((r) => [r.key, r]));
  const out = [];
  cm.forEach((c, k) => {
    const o = bm.get(k);
    if (!o) out.push({ type: 'new', cur: c });
    else if (c.price_jpy !== o.price_jpy) out.push({ type: c.price_jpy < o.price_jpy ? 'down' : 'up', cur: c, old: o, pct: (c.price_jpy - o.price_jpy) / o.price_jpy * 100 });
  });
  bm.forEach((o, k) => { if (!cm.has(k)) out.push({ type: 'gone', old: o }); });
  const limitOf = (g, k) => Number(g.recs.get(k)?.limit) || null;
  const base = S.groups.find((g) => g.id === S.diffBaseId);
  const limits = [...shared].map((k) => [limitOf(base, k), limitOf(S.cur, k)]).filter(([a, b]) => a && b && a !== b);
  return { entries: out.filter((e) => pass(e.cur || e.old)), series: shared.size, limits };
}
const DIFF_RANK = { down: 0, up: 1, new: 2, gone: 3 };
function renderDiff() {
  const base = S.groups.find((g) => g.id === S.diffBaseId);
  if (!base || !S.cur) {
    $('diff-meta').textContent = '비교할 이전 수집 시점이 없습니다.';
    seg('diff-tabs', 'diffTab', [['all', '전체']], S.diffTab);
    $('diff-list').innerHTML = '<div class="empty-state">이전 수집분이 쌓이면 가격·노출 변경을 비교할 수 있습니다.</div>'; return;
  }
  if (!S.diffBase) { $('diff-meta').textContent = `${base.date} 데이터를 불러오는 중...`; $('diff-list').innerHTML = '<div class="empty-state">불러오는 중...</div>'; return; }
  const { entries, series, limits } = computeDiff();
  const cnt = (t) => entries.filter((e) => t === 'all' || e.type === t).length;
  const tabs = [['all', '전체'], ['down', '가격 인하'], ['up', '가격 인상'], ['new', '신규 노출'], ['gone', '노출 종료']];
  seg('diff-tabs', 'diffTab', tabs.map(([v, l]) => [v, `${l} ${cnt(v)}`]), S.diffTab);
  $('diff-meta').textContent = `${base.date} → ${S.cur.date} · 비교 가능 ${series}개 시리즈(국가×플랫폼) · 변경 ${entries.length}건 · 가격은 JPY 기준${limits.length ? ` · 주의: ${limits.length}개 시리즈는 수집 개수 제한이 달라(${limits[0][0]}→${limits[0][1]}개) 신규·종료는 순위권 변동일 수 있음` : ''}`;
  const list = entries.filter((e) => S.diffTab === 'all' || e.type === S.diffTab)
    .sort((a, b) => DIFF_RANK[a.type] - DIFF_RANK[b.type] || Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
  if (!list.length) { $('diff-list').innerHTML = '<div class="empty-state">조건에 맞는 변경 상품이 없습니다.</div>'; return; }
  const item = (e) => {
    const r = e.cur || e.old, url = href(r.product_url);
    const ttl = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : `<span class="tt">${esc(r.title)}</span>`;
    const badge = e.type === 'new' ? '<span class="badge-new">신규 노출</span>' : e.type === 'gone' ? '<span class="badge-end">노출 종료</span>' : '';
    const chg = e.type === 'new' ? yen(r.price_jpy) : e.type === 'gone' ? `<s>${yen(r.price_jpy)}</s>`
      : `<s>${yen(e.old.price_jpy)}</s> → ${yen(r.price_jpy)} <span class="delta ${e.type}">${e.pct < 0 ? '▼' : '▲'} ${Math.abs(e.pct).toFixed(1)}%</span>`;
    return `<div class="diff"><div><div class="t1">${badge}${ttl}</div><div class="t2"><span class="opt-l">${dot(r.country)}${cn(r.country)}</span><span>${SITE[r.site].n}</span><span>${r.days ? r.days + '일' : '-'}</span><span>${esc(r.data_amount || '-')}</span></div></div><div class="chg">${chg}</div></div>`;
  };
  $('diff-list').innerHTML = list.slice(0, S.diffLimit).map(item).join('') +
    (list.length > S.diffLimit ? `<button class="btn more" type="button" data-more>더 보기 (${list.length - S.diffLimit}건 남음)</button>` : '');
}

/* ── tables ── */
const netTag = (n) => `<span class="net ${n}">${NET[n] || '미확인'}</span>`;
const genTag = (x) => `<span class="gtag ${(GEN[x] || GEN.unknown)[1]}">${(GEN[x] || GEN.unknown)[0]}</span>`;
const pfTag = (s) => `<span class="opt-l"><span class="pf ${s}">${SITE[s].l}</span>${SITE[s].n}</span>`;
const carrierText = (r) => carrierDefs(r.country).filter(([c]) => r.ca.includes(c)).map(([, l]) => l).join(', ');
function renderValue(rs) {
  const top = rs.filter((r) => r.unit != null).sort((a, b) => a.unit - b.unit).slice(0, 10), mx = Math.max(...top.map((r) => r.unit), 1);
  $('value-body').innerHTML = top.length ? top.map((r, i) => `<tr><td><span class="rkn${i < 3 ? ' hi' : ''}">${i + 1}</span></td><td><${href(r.product_url) ? `a class="ttl" href="${href(r.product_url)}" target="_blank" rel="noopener noreferrer"` : 'div class="ttl"'}>${esc(r.title)}</${href(r.product_url) ? 'a' : 'div'}></td><td class="nw"><span class="opt-l">${dot(r.country)}${cn(r.country)}</span></td><td class="nw">${pfTag(r.site)}</td><td class="nw">${r.days}일</td><td class="nw">${esc(r.data_amount || '-')}</td><td>${netTag(r.network_type)}</td><td class="r px">${yen(r.price_jpy)}</td><td class="r"><span class="ubar"><i style="--w:${r.unit / mx * 100}%;--c:var(--c-${r.country})"></i><b>${won(r.unit)}</b></span></td></tr>`).join('')
    : '<tr><td colspan="9" class="empty-state">표시할 데이터가 없습니다.</td></tr>';
}
function renderDetail(rs) {
  const sorted = [...rs].sort(SORTS[S.F.sort][1]), pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  S.page = Math.min(S.page, pages);
  $('detail-count').textContent = sorted.length.toLocaleString('ko-KR'); $('detail-sort').textContent = SORTS[S.F.sort][0];
  const sales = (r) => (r.site === 'amazon_jp'
    ? `${r.review_count != null ? '리뷰 ' + r.review_count.toLocaleString('ko-KR') : '리뷰 -'}${r.monthly_sold_count ? ' · 월 ' + r.monthly_sold_count.toLocaleString('ko-KR') + '+' : ''}${r.is_bestseller ? ' · 베스트셀러' : ''}`
    : `${r.review_count != null ? '리뷰 ' + r.review_count.toLocaleString('ko-KR') : '리뷰 -'}${r.seller_badge ? ' · ' + esc(r.seller_badge) : ''}${r.search_position ? ' · 검색 ' + r.search_position + '위' : ''}`);
  $('rows').innerHTML = sorted.slice((S.page - 1) * PAGE, S.page * PAGE).map((r) => `<tr><td class="nw"><span class="opt-l">${dot(r.country)}${cn(r.country)}</span></td><td class="nw">${pfTag(r.site)}</td>
    <td><${href(r.product_url) ? `a class="ttl" href="${href(r.product_url)}" target="_blank" rel="noopener noreferrer"` : 'div class="ttl"'}>${esc(r.title)}</${href(r.product_url) ? 'a' : 'div'}><div class="sub">${esc(r.seller || '-')}</div></td>
    <td class="r px">${yen(r.price_jpy)}</td><td class="r px">${r.price_krw ? won(r.price_krw) : '-'}</td><td class="r px">${r.unit ? won(r.unit) : '-'}</td>
    <td class="nw">${r.days ? r.days + '일' : '-'}${r.activation_validity ? `<div class="sub">활성화 ${esc(r.activation_validity)}</div>` : ''}</td><td class="nw">${esc(r.data_amount || '-')}</td><td>${netTag(r.network_type)}</td><td>${genTag(r.network_generation)}</td>
    <td class="nw">${carrierText(r) || '<span class="sub">미표시</span>'}</td><td class="nw sub">${sales(r)}</td></tr>`).join('') || '<tr><td colspan="12" class="empty-state">조건에 맞는 상품이 없습니다.</td></tr>';
  const pg = (p, l, dis, act) => `<button class="btn${act ? ' is-active' : ''}" type="button" data-pg="${p}"${dis ? ' disabled' : ''}>${l}</button>`;
  let nums = ''; for (let p = Math.max(1, S.page - 2); p <= Math.min(pages, S.page + 2); p++) nums += pg(p, p, false, p === S.page);
  $('pager').innerHTML = pg(1, '처음', S.page === 1) + pg(S.page - 1, '이전', S.page === 1) + nums + pg(S.page + 1, '다음', S.page === pages) + pg(pages, '마지막', S.page === pages);
}

function renderFx() {
  const fx = $('fx');
  fx.innerHTML = `환율 <b>${esc(FX.formatExchangeRateStatus(S.fx))}</b>`;
  fx.title = `기준일 ${S.fx.updatedAt || '-'} · 출처 ${S.fx.source}${S.fx.error ? ' · ' + S.fx.error : ''}`;
  fx.classList.toggle('warn', Boolean(S.fx.unavailable || S.fx.stale));
}
function notice(msg) { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; }

function render() {
  const rs = rows();
  renderSide(); renderActive(rs); renderHero(rs); renderTrend(); renderVend(rs); renderHeat(); renderMarket(rs);
  renderDiffControls(); renderDiff(); renderValue(rs); renderDetail(rs);
}

/* ── events ── */
const toggle = (k, v) => { const s = S.F[k]; s.has(v) ? s.delete(v) : s.add(v); };
let lastFocus = null;
function openModal(id) { lastFocus = document.activeElement; $(id).hidden = false; $(id).querySelector('[data-close]:not(.modal-overlay)')?.focus(); }
function closeModals() {
  const open = [...document.querySelectorAll('.modal-shell')].filter((m) => !m.hidden);
  open.forEach((m) => { m.hidden = true; });
  if (open.length) lastFocus?.focus?.();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button,[data-close]'); if (!t) return;
  const d = t.dataset, F = S.F;
  if (d.close !== undefined) { closeModals(); return; }
  if (d.rm) {
    if (['country', 'site', 'per'].includes(d.rm)) F[d.rm].delete(d.v);
    else if (d.rm === 'price') { F.pmin = F.pmax = null; $('pmin').value = $('pmax').value = ''; }
    else if (d.rm === 'q') { F.q = ''; $('q').value = ''; } else F[d.rm] = '';
  } else if (d.hmC) {
    const on = F.country.size === 1 && F.country.has(d.hmC) && F.per.size === 1 && F.per.has(d.hmP);
    F.country = new Set(on ? [] : [d.hmC]); F.per = new Set(on ? [] : [d.hmP]);
  } else if (d.k === 'guard') F.guard = !F.guard;
  else if (['country', 'site', 'per'].includes(d.k)) toggle(d.k, d.v);
  else if (['net', 'gen'].includes(d.k)) F[d.k] = d.v;
  else if (['trendSite', 'hm', 'diffTab'].includes(d.k)) { S[d.k] = d.v; if (d.k === 'diffTab') S.diffLimit = DIFF_STEP; }
  else if (d.lg) S.off.has(d.lg) ? S.off.delete(d.lg) : S.off.add(d.lg);
  else if (d.pg) S.page = +d.pg;
  else if (d.more !== undefined) S.diffLimit += DIFF_STEP;
  else if (t.id === 'reset') { S.F = F0(); ['pmin', 'pmax', 'q'].forEach((i) => { $(i).value = ''; }); }
  else if (t.id === 'detail-toggle') { S.open = !S.open; t.classList.toggle('open', S.open); t.setAttribute('aria-expanded', S.open); $('detail-body').hidden = !S.open; return; }
  else if (t.id === 'help-btn') { openModal('help-modal'); return; }
  else if (t.id === 'mfilter') { t.setAttribute('aria-expanded', $('side').classList.toggle('open')); return; }
  else if (t.id === 'theme-btn') { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); return; }
  else if (t.id === 'refresh-btn') { init(); return; }
  else if (t.id === 'csv') { downloadCsv(); return; }
  else return;
  if (!d.pg && !d.lg && d.more === undefined && !['trendSite', 'hm', 'diffTab'].includes(d.k)) S.page = 1;
  render();
});
$('f-data').onchange = (e) => { S.F.data = e.target.value; S.page = 1; render(); };
$('f-carrier').onchange = (e) => { S.F.carrier = e.target.value; S.page = 1; render(); };
$('sort').onchange = (e) => { S.F.sort = e.target.value; render(); };
$('pmin').oninput = (e) => { S.F.pmin = e.target.value === '' ? null : +e.target.value; S.page = 1; render(); };
$('pmax').oninput = (e) => { S.F.pmax = e.target.value === '' ? null : +e.target.value; S.page = 1; render(); };
$('q').oninput = (e) => { S.F.q = e.target.value; S.page = 1; render(); };
$('dataset').onchange = (e) => selectDataset(e.target.value);
$('diff-base').onchange = (e) => { setDiffBase(e.target.value); renderDiff(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

function setTheme(t, persist = true) {
  document.documentElement.setAttribute('data-theme', t);
  if (persist) store.set('esim.dashboard.theme', t);
  const b = $('theme-btn'); b.setAttribute('aria-pressed', t === 'dark'); b.title = b.ariaLabel = t === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
  renderHeat();
}
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!store.get('esim.dashboard.theme')) setTheme(e.matches ? 'dark' : 'light', false); });

function downloadCsv() {
  const cell = (v) => { if (v == null) return ''; const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  const head = ['site', 'country', 'title', 'price_jpy', 'price_krw', 'unit_price_krw', 'usage_validity', 'activation_validity', 'data_amount', 'network_type', 'network_generation', 'carrier_support_local', 'review_count', 'monthly_sold_count', 'is_bestseller', 'bestseller_rank', 'seller_badge', 'search_position', 'seller', 'brand', 'asin', 'site_product_id', 'product_url'];
  const lines = [head.join(',')].concat([...rows()].sort(SORTS[S.F.sort][1]).map((r) => head.map((h) => cell(h === 'unit_price_krw' ? r.unit : h === 'carrier_support_local' ? carrierText(r) : r[h])).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  a.download = `japan_esim_${S.cur ? S.cur.date : 'data'}_filtered_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

$('help-body').innerHTML = HELP.blocks.map(([h, p]) => `<article class="help-block"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('') +
  `<article class="help-block"><h3>주요 용어</h3><div class="termgrid">${HELP.terms.map(([k, v]) => `<div class="term"><strong><code>${esc(k)}</code></strong><p>${esc(v)}</p></div>`).join('')}</div></article>`;

/* ── boot ── */
async function selectDataset(id) {
  const g = S.groups.find((x) => x.id === id) || S.groups[0];
  if (!g) return;
  S.datasetId = g.id; $('dataset').value = g.id; S.cur = g; S.page = 1;
  try {
    S.items = await loadGroup(g);
    $('crawled-at').textContent = isoLocal(g.crawledAt);
    notice(S.fx.unavailable ? '환율을 불러오지 못해 KRW 환산과 1일당 비교를 표시할 수 없습니다. (JPY 가격은 정상 표시)' : '');
  } catch (err) { S.items = []; notice(`데이터 로드 실패: ${err.message}`); }
  render();
}
async function init() {
  notice('');
  rawCache.clear(); groupCache.clear(); S.trend = {}; S.diffBaseId = ''; S.diffBase = null;
  $('best').innerHTML = '<div class="what">데이터를 불러오는 중...</div>';
  try {
    const [fx, index] = await Promise.all([FX.fetchExchangeRate(window.fetch.bind(window), { storage: (() => { try { return window.localStorage; } catch (_) { return null; } })() }), loadIndex()]);
    S.fx = fx; renderFx();
    S.groups = buildGroups(index);
    if (!S.groups.length) { S.items = []; notice('표시할 데이터셋이 없습니다. (data/index.json 확인)'); render(); return; }
    $('dataset').innerHTML = S.groups.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
    await selectDataset(S.groups.some((g) => g.id === S.datasetId) ? S.datasetId : S.groups[0].id);
    loadTrend();
  } catch (err) { notice(`초기화 실패: ${err.message}`); }
}
setTheme(document.documentElement.dataset.theme || 'light', false);
init();
