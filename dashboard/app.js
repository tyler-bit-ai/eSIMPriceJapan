const pageSize = 20;
const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
const FX = window.ExchangeRateUtils;
const SITE_CONFIG = {
  amazon_jp: {
    sortOptions: [
      ['priceAsc', '가격 낮은순'],
      ['priceDesc', '가격 높은순'],
      ['reviewDesc', '리뷰 많은순'],
      ['salesDesc', '판매량 높은순'],
      ['usageAsc', '사용기간 짧은순'],
    ],
    columns: [
      ['title', '상품명'],
      ['price_jpy', '가격 (JPY)'],
      ['price_krw', '가격 (KRW)'],
      ['review_count', '리뷰 수'],
      ['monthly_sold_count', '판매량(최근 1개월)'],
      ['is_bestseller', '베스트셀러'],
      ['bestseller_rank', '판매순위'],
      ['network_type', '네트워크'],
      ['data_amount', '데이터'],
      ['usage_validity', '사용기간'],
      ['activation_validity', '활성화기간'],
      ['carrier_support_local', '통신사 지원'],
      ['seller', '셀러'],
      ['brand', '브랜드'],
    ],
    showSellerBadgeChart: false,
    searchPlaceholder: '상품명/셀러/브랜드 검색',
  },
  qoo10_jp: {
    sortOptions: [
      ['priceAsc', '가격 낮은순'],
      ['priceDesc', '가격 높은순'],
      ['reviewDesc', '리뷰 많은순'],
      ['positionAsc', '검색 상위순'],
      ['usageAsc', '사용기간 짧은순'],
    ],
    columns: [
      ['title', '상품명'],
      ['price_jpy', '가격 (JPY)'],
      ['price_krw', '가격 (KRW)'],
      ['review_count', '리뷰 수'],
      ['seller_badge', '셀러 배지'],
      ['search_position', '검색 위치'],
      ['network_type', '네트워크'],
      ['data_amount', '데이터'],
      ['usage_validity', '사용기간'],
      ['activation_validity', '활성화기간'],
      ['carrier_support_local', '통신사 지원'],
      ['seller', '셀러'],
    ],
    showSellerBadgeChart: true,
    searchPlaceholder: '상품명/셀러/셀러 배지 검색',
  },
};
const COUNTRY_CONFIG = {
  kr: { label: '한국', dashboardEnabled: true },
  vn: { label: '베트남', dashboardEnabled: true },
  th: { label: '태국', dashboardEnabled: false },
  tw: { label: '대만', dashboardEnabled: true },
  hk: { label: '홍콩', dashboardEnabled: true },
  mo: { label: '마카오', dashboardEnabled: true },
  us: { label: '미국', dashboardEnabled: true },
};
const HELP_CONTENT = {
  common: {
    summary: '이 대시보드는 일본 마켓플레이스에서 국가별 eSIM 검색 결과를 수집하고, 핵심 정보를 정규화해 비교할 수 있도록 만든 분석 화면입니다.',
    usage: [
      '상단에서 사이트, 국가, 데이터셋을 선택하면 해당 수집 결과가 로드됩니다.',
      '필터 영역에서 네트워크, 데이터 용량, 사용기간, 통신사 지원, 가격 범위를 조합해 원하는 상품만 볼 수 있습니다.',
      '정렬 기준은 사이트마다 다르며, Qoo10은 리뷰 수와 검색 위치, Amazon은 판매량과 베스트셀러 지표를 더 많이 사용합니다.',
      '상세 항목 표의 상품명을 누르면 원본 상품 페이지로 이동하고, 현재 화면 기준으로 엑셀 다운로드도 가능합니다.',
      'KRW 가격은 Frankfurter 환율을 기준으로 JPY에서 환산한 보조 지표이며, API 실패 시 최근 성공 환율 캐시를 재사용할 수 있습니다.',
    ],
    notes: [
      '`unknown`은 정보가 없거나, 신호가 서로 충돌하거나, 추론 근거가 충분하지 않다는 뜻입니다.',
      '`usage_validity`는 실제 사용 가능 기간, `activation_validity`는 구매 후 개통해야 하는 기한을 뜻합니다.',
      '`network_type`과 `carrier_support_local`은 제목·옵션·상세 설명의 텍스트를 기반으로 추론될 수 있습니다.',
      '`price_krw`는 `price_jpy * 환율`을 원 단위 반올림한 파생 값입니다.',
    ],
    terms: [
      ['price_jpy', '상품의 현재 판매가 기준 JPY 값입니다. 옵션형 상품은 대표 플랜 또는 강한 fallback 신호를 기준으로 계산됩니다.'],
      ['price_krw', 'Frankfurter 환율을 기준으로 계산한 KRW 환산 가격입니다. 원 단위 반올림 값을 사용합니다.'],
      ['data_amount', '무제한, 총량형(`3GB`), 일 단위형(`1GB/day`)처럼 데이터 정책을 정규화한 값입니다.'],
      ['network_type', '`local`, `roaming`, `unknown` 중 하나입니다. 현지 회선/현지 번호/로밍 문구 등으로 분류합니다.'],
      ['carrier_support_local', '선택한 국가의 현지 통신사 언급을 carrier registry 기준으로 표시합니다. 언급이 없으면 미표시로 남을 수 있습니다.'],
    ],
  },
  amazon_jp: {
    intro: 'Amazon JP 화면은 판매량, 베스트셀러 여부, 판매순위처럼 Amazon이 상대적으로 잘 노출하는 지표 중심으로 구성됩니다.',
    terms: [
      ['monthly_sold_count', '상품 설명이나 검색 결과에 노출되는 최근 1개월 판매량 신호입니다. 값이 없으면 Amazon 페이지에서 공개되지 않은 것입니다.'],
      ['review_count', 'Amazon 상품 리뷰 수입니다. 검색 결과 카드 또는 상세 페이지의 리뷰 수 텍스트에서 수집합니다.'],
      ['is_bestseller', 'Amazon의 베스트셀러 배지 유무입니다. `Yes`면 해당 배지가 확인된 상품입니다.'],
      ['bestseller_rank', 'Amazon 판매순위입니다. 숫자가 작을수록 해당 카테고리 내 상위에 가깝습니다.'],
      ['brand', 'Amazon에서 브랜드 필드가 비교적 안정적으로 보일 때 수집됩니다.'],
    ],
    faq: [
      '판매량과 판매순위는 Amazon 공개 UI에 의존하므로 시점에 따라 달라질 수 있습니다.',
      'Amazon에서는 Qoo10의 `Power seller` 같은 셀러 배지 개념을 사용하지 않습니다.',
    ],
  },
  qoo10_jp: {
    intro: 'Qoo10 화면은 리뷰 수, 셀러 배지, 검색 노출 순서처럼 Qoo10에서 실제로 안정적으로 보이는 지표 중심으로 구성됩니다.',
    terms: [
      ['review_count', '상품 리뷰 수입니다. 검색 결과 카드와 상세 페이지에서 확인된 값을 우선 사용합니다.'],
      ['seller_badge', 'Qoo10 셀러 등급입니다. `Power seller`, `Good seller`, `General seller`는 셀러 신뢰/활동 수준을 보여주는 배지입니다.'],
      ['search_position', '현재 검색어 기준 검색 결과에 몇 번째로 노출됐는지를 뜻합니다. 절대 판매순위가 아니라 이번 수집 시점의 노출 순서입니다.'],
      ['Power seller', 'Qoo10에서 높은 활동성과 신뢰도를 가진 셀러에게 부여되는 상위 배지입니다. 상품 인기 지표와는 다릅니다.'],
      ['Good seller', '일정 수준 이상의 판매/평가 신호를 가진 셀러 배지입니다. Power seller보다는 낮은 단계입니다.'],
      ['General seller', '일반 셀러 배지입니다. 판매자임은 확인되지만 상위 등급 배지는 없는 상태로 보면 됩니다.'],
    ],
    faq: [
      'Qoo10에는 Amazon식 월간 판매량, 베스트셀러, 공식 판매순위 필드가 안정적으로 없어서 대시보드 구조가 다릅니다.',
      'Qoo10의 `network_type`과 `data_amount`는 제목, 옵션, 상세 설명을 함께 보고 추론합니다. 따라서 일부 상품은 `unknown` 또는 보수적 값으로 남을 수 있습니다.',
    ],
  },
};

let state = {
  items: [],
  filtered: [],
  currentPage: 1,
  file: null,
  generatedAt: null,
  totalBeforeFilter: 0,
  datasets: [],
  sites: [],
  countries: [],
  selectedSite: 'amazon_jp',
  selectedCountry: 'kr',
  selectedDatasetId: null,
  selectedCsvPath: './data/sites/amazon_jp/kr/latest.csv',
  amazonReviewEnabled: true,
  exchangeRate: FX.buildExchangeRateMeta({ unavailable: true, stale: true }),
};
const CARRIER_CONFIG = {
  kr: [
    ['skt', 'SKT'],
    ['kt', 'KT'],
    ['lgu', 'LGU+'],
  ],
  vn: [
    ['viettel', 'Viettel'],
    ['vinaphone', 'VinaPhone'],
    ['mobifone', 'MobiFone'],
    ['vietnamobile', 'Vietnamobile'],
  ],
  tw: [
    ['chunghwa', 'Chunghwa Telecom'],
    ['taiwan_mobile', 'Taiwan Mobile'],
    ['fareastone', 'Far EasTone'],
  ],
  hk: [
    ['cmhk', 'CMHK'],
    ['csl', 'CSL'],
    ['smartone', 'SmarTone'],
    ['three_hk', '3HK'],
  ],
  mo: [
    ['ctm', 'CTM'],
    ['china_telecom_macau', 'China Telecom (Macau)'],
    ['three_macau', '3 Macau'],
  ],
  us: [
    ['att', 'AT&T'],
    ['tmobile', 'T-Mobile'],
    ['verizon', 'Verizon'],
  ],
  th: [
    ['ais', 'AIS'],
    ['dtac', 'dtac'],
    ['truemove', 'TrueMove H'],
  ],
};
const CARRIER_ALIASES = {
  kr: {
    skt: ['skt', 'sk telecom', 'sktelecom'],
    kt: ['kt', 'kt olleh', 'olleh'],
    lgu: ['lg u+', 'lgu+', 'uplus', 'lg u plus', 'lgu'],
  },
  vn: {
    viettel: ['viettel'],
    vinaphone: ['vinaphone', 'vina phone', 'vnpt'],
    mobifone: ['mobifone', 'mobi phone'],
    vietnamobile: ['vietnamobile', 'vietnam mobile'],
  },
  tw: {
    chunghwa: ['chunghwa', '中華電信', 'cht'],
    taiwan_mobile: ['taiwan mobile', '台灣大哥大', 'twm'],
    fareastone: ['far eas tone', 'far eastone', '遠傳', 'fet'],
  },
  hk: {
    cmhk: ['cmhk', 'china mobile hong kong', '中國移動香港'],
    csl: ['csl', 'one2free', '1o1o', 'pccw-hkt'],
    smartone: ['smartone', 'smart one'],
    three_hk: ['3hk', '3 hong kong', 'three hk'],
  },
  mo: {
    ctm: ['ctm', 'macau telecom', '澳門電訊'],
    china_telecom_macau: ['china telecom macau', '中國電信澳門', 'ctm macau'],
    three_macau: ['3 macau', 'three macau', 'hutchison telephone macau'],
  },
  us: {
    att: ['at&t', 'att'],
    tmobile: ['t-mobile', 'tmobile'],
    verizon: ['verizon'],
  },
  th: {
    ais: ['ais', 'advanced info service'],
    dtac: ['dtac'],
    truemove: ['truemove', 'truemove h', 'true move'],
  },
};

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function extractDays(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{1,4})\s*일/);
  return m ? Number(m[1]) : null;
}

function getCarrierDefinitions(country) {
  return CARRIER_CONFIG[country] || [];
}

function inferLegacyCarrierLocal(raw, country) {
  const aliasMap = CARRIER_ALIASES[country] || {};
  const bag = [
    raw.title,
    raw.seller,
    raw.brand,
    ...(raw.evidence && typeof raw.evidence === 'object'
      ? Object.values(raw.evidence).flat().filter(Boolean)
      : []),
  ]
    .join(' ')
    .toLowerCase();
  if (!bag) return {};

  const inferred = {};
  Object.entries(aliasMap).forEach(([code, aliases]) => {
    inferred[code] = aliases.some((alias) => bag.includes(String(alias).toLowerCase()));
  });
  return inferred;
}

function normalizeCarrierLocal(carrierSupport, legacyCarrierSupport, country, raw) {
  const definitions = getCarrierDefinitions(country);
  if (!definitions.length) return {};

  const source = carrierSupport && typeof carrierSupport === 'object'
    ? carrierSupport
    : ((country === 'kr' && legacyCarrierSupport && typeof legacyCarrierSupport === 'object')
      ? legacyCarrierSupport
      : inferLegacyCarrierLocal(raw, country));

  const normalized = {};
  definitions.forEach(([code]) => {
    normalized[code] = source[code] === true;
  });
  return normalized;
}

function normalizeItem(raw) {
  const country = raw.country || state.selectedCountry || null;
  const carrier = normalizeCarrierLocal(raw.carrier_support_local, raw.carrier_support_kr, country, raw);
  const parsedPrice = Number(raw.price_jpy);
  const parsedPriceKrw = Number(raw.price_krw);
  return {
    site: raw.site || null,
    country,
    title: raw.title || '',
    product_url: typeof raw.product_url === 'string' ? raw.product_url : null,
    price_jpy: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null,
    price_krw: Number.isFinite(parsedPriceKrw) && parsedPriceKrw > 0 ? parsedPriceKrw : null,
    review_count: Number.isFinite(Number(raw.review_count)) ? Number(raw.review_count) : null,
    seller_badge: raw.seller_badge || null,
    search_position: Number.isFinite(Number(raw.search_position)) ? Number(raw.search_position) : null,
    monthly_sold_count: Number.isFinite(Number(raw.monthly_sold_count)) ? Number(raw.monthly_sold_count) : null,
    is_bestseller: typeof raw.is_bestseller === 'boolean' ? raw.is_bestseller : null,
    bestseller_rank: Number.isFinite(Number(raw.bestseller_rank)) ? Number(raw.bestseller_rank) : null,
    network_type: raw.network_type || 'unknown',
    data_amount: raw.data_amount || null,
    usage_validity: raw.usage_validity || raw.validity || null,
    activation_validity: raw.activation_validity || null,
    seller: raw.seller || null,
    brand: raw.brand || null,
    asin: raw.asin || null,
    site_product_id: raw.site_product_id || null,
    carrier_support_local: carrier,
    carrier_support_kr: country === 'kr' ? carrier : {},
    usage_days: extractDays(raw.usage_validity || raw.validity || null),
    activation_days: extractDays(raw.activation_validity || null),
  };
}

function keepDashboardItem(item) {
  return Number.isFinite(item.price_jpy) && item.price_jpy > 0;
}

const el = {
  metaText: document.getElementById('metaText'),
  fxText: document.getElementById('fxText'),
  currentScope: document.getElementById('currentScope'),
  siteAmazonCard: document.getElementById('siteAmazonCard'),
  siteQoo10Card: document.getElementById('siteQoo10Card'),
  helpBtn: document.getElementById('helpBtn'),
  helpOverlay: document.getElementById('helpOverlay'),
  helpCloseBtn: document.getElementById('helpCloseBtn'),
  helpTitle: document.getElementById('helpTitle'),
  helpBody: document.getElementById('helpBody'),
  refreshBtn: document.getElementById('refreshBtn'),
  siteSelect: document.getElementById('siteSelect'),
  countrySelect: document.getElementById('countrySelect'),
  datasetSelect: document.getElementById('datasetSelect'),
  kpis: document.getElementById('kpis'),
  dataAmountBars: document.getElementById('dataAmountBars'),
  networkBars: document.getElementById('networkBars'),
  sellerBadgeCard: document.getElementById('sellerBadgeCard'),
  sellerBadgeBars: document.getElementById('sellerBadgeBars'),
  searchInput: document.getElementById('searchInput'),
  networkFilter: document.getElementById('networkFilter'),
  dataFilter: document.getElementById('dataFilter'),
  usageFilter: document.getElementById('usageFilter'),
  carrierFilter: document.getElementById('carrierFilter'),
  minPrice: document.getElementById('minPrice'),
  maxPrice: document.getElementById('maxPrice'),
  sortKey: document.getElementById('sortKey'),
  tableHead: document.getElementById('tableHead'),
  rows: document.getElementById('rows'),
  pageInfo: document.getElementById('pageInfo'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  downloadExcelBtn: document.getElementById('downloadExcelBtn'),
};

function activeConfig() {
  const config = SITE_CONFIG[state.selectedSite] || SITE_CONFIG.amazon_jp;
  if (state.selectedSite !== 'amazon_jp' || state.amazonReviewEnabled) return config;
  return {
    ...config,
    sortOptions: config.sortOptions.filter(([value]) => value !== 'reviewDesc'),
    columns: config.columns.filter(([key]) => key !== 'review_count'),
  };
}

function siteLabel(site) {
  return site === 'qoo10_jp' ? 'Qoo10 JP' : 'Amazon JP';
}

function countryLabel(country) {
  return (COUNTRY_CONFIG[country] && COUNTRY_CONFIG[country].label) || String(country || '한국').toUpperCase();
}

function getVisibleCountryCodes() {
  return Object.entries(COUNTRY_CONFIG)
    .filter(([, config]) => config.dashboardEnabled)
    .map(([code]) => code);
}

function isHelpOpen() {
  return el.helpOverlay && !el.helpOverlay.hidden;
}

function renderHelpModal() {
  const common = HELP_CONTENT.common;
  const siteHelp = HELP_CONTENT[state.selectedSite] || HELP_CONTENT.amazon_jp;
  el.helpTitle.textContent = `${siteLabel(state.selectedSite)} · ${countryLabel(state.selectedCountry)} 도움말`;
  el.helpBody.innerHTML = `
    <section class="helpSection">
      <h3>프로그램 소개</h3>
      <p>${safe(common.summary)}</p>
    </section>
    <section class="helpSection">
      <h3>사용법</h3>
      <ol class="helpList">${common.usage.map((item) => `<li>${safe(item)}</li>`).join('')}</ol>
    </section>
    <section class="helpSection">
      <h3>공통 용어</h3>
      <div class="termGrid">${common.terms.map(([term, desc]) => `<div class="termCard"><strong>${safe(term)}</strong><p>${safe(desc)}</p></div>`).join('')}</div>
    </section>
    <section class="helpSection">
      <h3>${safe(siteLabel(state.selectedSite))} 화면 설명</h3>
      <p>${safe(siteHelp.intro)}</p>
    </section>
    <section class="helpSection">
      <h3>${safe(siteLabel(state.selectedSite))} 주요 용어</h3>
      <div class="termGrid">${siteHelp.terms.map(([term, desc]) => `<div class="termCard"><strong>${safe(term)}</strong><p>${safe(desc)}</p></div>`).join('')}</div>
    </section>
    <section class="helpSection">
      <h3>자주 궁금한 점</h3>
      <ul class="helpList">${siteHelp.faq.map((item) => `<li>${safe(item)}</li>`).join('')}${common.notes.map((item) => `<li>${safe(item)}</li>`).join('')}</ul>
    </section>
  `;
}

function openHelpModal() {
  renderHelpModal();
  el.helpOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeHelpModal() {
  el.helpOverlay.hidden = true;
  document.body.style.overflow = '';
}

function formatDatasetLabel(entry) {
  const crawled = entry && entry.crawled_at ? isoToLocal(entry.crawled_at) : '-';
  const count = Number.isFinite(Number(entry && entry.item_count)) ? Number(entry.item_count).toLocaleString('ko-KR') : '-';
  const source = (entry && entry.source) ? String(entry.source).split(/[\\/]/).pop() : (entry && entry.id ? entry.id : 'dataset');
  const country = entry && entry.country ? countryLabel(entry.country) : countryLabel(state.selectedCountry);
  return `${crawled} | ${country} | ${source} | ${count}개`;
}

function populateSiteOptions(indexData) {
  const sites = new Set();
  const latest = indexData && indexData.latest ? indexData.latest : {};
  Object.keys(latest).forEach((site) => sites.add(site));
  const runs = Array.isArray(indexData && indexData.runs) ? indexData.runs : [];
  runs.forEach((run) => run && run.site && sites.add(run.site));
  if (!sites.size) sites.add('amazon_jp');
  state.sites = [...sites];
  if (!state.sites.includes(state.selectedSite)) state.selectedSite = state.sites[0];
  el.siteSelect.innerHTML = state.sites.map((site) => `<option value="${safe(site)}">${safe(siteLabel(site))}</option>`).join('');
  el.siteSelect.value = state.selectedSite;
}

function populateCountryOptions(indexData) {
  const countries = new Set(getVisibleCountryCodes());
  const latest = indexData && indexData.latest && indexData.latest[state.selectedSite] ? indexData.latest[state.selectedSite] : {};
  Object.keys(latest).forEach((country) => {
    if (!COUNTRY_CONFIG[country] || COUNTRY_CONFIG[country].dashboardEnabled) countries.add(country);
  });
  const runs = Array.isArray(indexData && indexData.runs) ? indexData.runs : [];
  runs.forEach((run) => {
    if (!run || run.site !== state.selectedSite || !run.country) return;
    if (!COUNTRY_CONFIG[run.country] || COUNTRY_CONFIG[run.country].dashboardEnabled) countries.add(run.country);
  });
  state.countries = [...countries];
  if (!state.countries.includes(state.selectedCountry)) state.selectedCountry = state.countries[0] || 'kr';
  el.countrySelect.innerHTML = state.countries.map((country) => `<option value="${safe(country)}">${safe(countryLabel(country))}</option>`).join('');
  el.countrySelect.value = state.selectedCountry;
}

function populateDatasetOptions(datasets) {
  if (!datasets.length) {
    el.datasetSelect.innerHTML = '<option value="">latest</option>';
    el.datasetSelect.value = '';
    return;
  }
  el.datasetSelect.innerHTML = ['<option value="">latest</option>']
    .concat(datasets.map((d) => `<option value="${safe(String(d.id || ''))}">${safe(formatDatasetLabel(d))}</option>`))
    .join('');
  el.datasetSelect.value = state.selectedDatasetId || '';
}

function getDatasetsForSelectedSite() {
  return state.datasets.filter(
    (entry) => (entry.site || 'amazon_jp') === state.selectedSite && (entry.country || 'kr') === state.selectedCountry,
  );
}

function yen(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function won(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `₩${Number(n).toLocaleString('ko-KR')}`;
}

function safe(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function safeHref(value) {
  if (!value) return '';
  return String(value).replaceAll('"', '&quot;');
}

function isoToLocal(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR');
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function summarize(items) {
  const prices = items.map((it) => it.price_jpy).filter((n) => Number.isFinite(n));
  const pricesKrw = items.map((it) => it.price_krw).filter((n) => Number.isFinite(n));
  const sales = items.map((it) => it.monthly_sold_count).filter((n) => Number.isFinite(n));
  const reviews = items.map((it) => it.review_count).filter((n) => Number.isFinite(n));
  const localCount = items.filter((it) => it.network_type === 'local').length;
  const roamingCount = items.filter((it) => it.network_type === 'roaming').length;
  const unlimitedCount = items.filter((it) => String(it.data_amount || '').toLowerCase() === 'unlimited').length;
  const bestsellerCount = items.filter((it) => it.is_bestseller === true).length;
  const bestsellerRankKnownCount = items.filter((it) => Number.isFinite(it.bestseller_rank)).length;
  const top10Count = items.filter((it) => Number.isFinite(it.search_position) && it.search_position <= 10).length;

  const carrierCounts = {};
  getCarrierDefinitions(state.selectedCountry).forEach(([code]) => {
    carrierCounts[code] = items.filter((it) => it.carrier_support_local && it.carrier_support_local[code]).length;
  });
  const badgeCounts = {};
  const byDataAmount = {};
  const byNetwork = {};
  for (const it of items) {
    const d = it.data_amount || 'unknown';
    const n = it.network_type || 'unknown';
    const b = it.seller_badge || 'unknown';
    byDataAmount[d] = (byDataAmount[d] || 0) + 1;
    byNetwork[n] = (byNetwork[n] || 0) + 1;
    badgeCounts[b] = (badgeCounts[b] || 0) + 1;
  }

  return {
    total: items.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    priceAvg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    priceMedian: median(prices),
    priceKrwMin: pricesKrw.length ? Math.min(...pricesKrw) : null,
    priceKrwMax: pricesKrw.length ? Math.max(...pricesKrw) : null,
    priceKrwAvg: pricesKrw.length ? Math.round(pricesKrw.reduce((a, b) => a + b, 0) / pricesKrw.length) : null,
    priceKrwMedian: median(pricesKrw),
    roamingCount,
    localCount,
    unlimitedCount,
    salesKnownCount: sales.length,
    salesMedian: median(sales),
    reviewKnownCount: reviews.length,
    reviewMedian: median(reviews),
    bestsellerCount,
    bestsellerRankKnownCount,
    top10Count,
    carrierCounts,
    badgeCounts,
    byDataAmount,
    byNetwork,
  };
}

function updateAmazonReviewVisibility(items) {
  if (state.selectedSite !== 'amazon_jp') {
    state.amazonReviewEnabled = true;
    return;
  }
  const total = items.length;
  const known = items.filter((it) => Number.isFinite(it.review_count)).length;
  state.amazonReviewEnabled = total > 0 && (known / total) >= 0.1;
}

function renderExchangeRateMeta() {
  if (!el.fxText) return;
  const meta = state.exchangeRate || FX.buildExchangeRateMeta({ unavailable: true, stale: true });
  const updatedAt = meta.updatedAt ? isoToLocal(meta.updatedAt) : '-';
  el.fxText.textContent = `환율: ${FX.formatExchangeRateStatus(meta)} | 기준일: ${updatedAt} | 출처: ${meta.source || '-'}`;
}

async function resolveExchangeRateMeta(providedMeta) {
  if (providedMeta && !providedMeta.unavailable && Number.isFinite(Number(providedMeta.rate))) {
    return FX.buildExchangeRateMeta(providedMeta);
  }
  return FX.fetchExchangeRate(window.fetch.bind(window), {
    storage: typeof window !== 'undefined' ? window.localStorage : null,
  });
}

function carrierLabel(carrier, country) {
  const out = [];
  getCarrierDefinitions(country).forEach(([code, label]) => {
    if (carrier && carrier[code]) out.push(label);
  });
  return out.length ? out.join(', ') : 'unknown';
}

function buildCarrierKpiEntries(summary) {
  return getCarrierDefinitions(state.selectedCountry).map(([code, label]) => [
    `${label} 명시`,
    `${summary.carrierCounts[code] || 0}`,
  ]);
}

function toQuery(includeDataset = true) {
  const params = new URLSearchParams();
  params.set('site', state.selectedSite);
  params.set('country', state.selectedCountry);
  if (includeDataset && state.selectedDatasetId) params.set('dataset', state.selectedDatasetId);
  const q = el.searchInput.value.trim();
  if (q) params.set('q', q);
  if (el.networkFilter.value) params.set('network', el.networkFilter.value);
  if (el.dataFilter.value) params.set('dataAmount', el.dataFilter.value);
  if (el.usageFilter.value) params.set('usage', el.usageFilter.value);
  if (el.carrierFilter.value) params.set('carrier', el.carrierFilter.value);
  if (el.minPrice.value) params.set('minPrice', el.minPrice.value);
  if (el.maxPrice.value) params.set('maxPrice', el.maxPrice.value);
  if (el.sortKey.value) params.set('sort', el.sortKey.value);
  return params.toString();
}

function getFilenameFromDisposition(contentDisposition) {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match && match[1] ? match[1] : null;
}

function makeClientExportFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${state.selectedSite || 'market'}_${state.selectedCountry || 'all'}_filtered_${ts}.csv`;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildClientExportRows(items) {
  const isQoo10 = state.selectedSite === 'qoo10_jp';
  return items.map((it) => {
    const base = {
      site: it.site || state.selectedSite || '',
      title: it.title || '',
      price_jpy: it.price_jpy ?? '',
      price_krw: it.price_krw ?? '',
      network_type: it.network_type || '',
      data_amount: it.data_amount || '',
      usage_validity: it.usage_validity || '',
      activation_validity: it.activation_validity || '',
      carrier_support_local: carrierLabel(it.carrier_support_local, it.country || state.selectedCountry),
      seller: it.seller || '',
      asin: it.asin || '',
      site_product_id: it.site_product_id || '',
    };
    if (isQoo10) {
      return {
        ...base,
        review_count: it.review_count ?? '',
        seller_badge: it.seller_badge || '',
        search_position: it.search_position ?? '',
      };
    }
    return {
      ...base,
      review_count: it.review_count ?? '',
      monthly_sold_count: it.monthly_sold_count ?? '',
      is_bestseller: it.is_bestseller === null ? '' : (it.is_bestseller ? 'true' : 'false'),
      bestseller_rank: it.bestseller_rank ?? '',
      brand: it.brand || '',
    };
  });
}

function buildClientExportCsv(items) {
  const isQoo10 = state.selectedSite === 'qoo10_jp';
  const headers = isQoo10
    ? [
        'site',
        'title',
        'price_jpy',
        'price_krw',
        'review_count',
        'seller_badge',
        'search_position',
        'network_type',
        'data_amount',
        'usage_validity',
        'activation_validity',
        'carrier_support_local',
        'seller',
        'asin',
        'site_product_id',
      ]
    : [
        'site',
        'title',
        'price_jpy',
        'price_krw',
        'review_count',
        'monthly_sold_count',
        'is_bestseller',
        'bestseller_rank',
        'network_type',
        'data_amount',
        'usage_validity',
        'activation_validity',
        'carrier_support_local',
        'seller',
        'brand',
        'asin',
        'site_product_id',
      ];

  const rows = buildClientExportRows(items);
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

async function saveWithPicker(blob, suggestedName) {
  if (!('showSaveFilePicker' in window)) return false;
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'Excel Workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

async function downloadFilteredExcel() {
  if (IS_GITHUB_PAGES) {
    const csv = buildClientExportCsv(state.filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = makeClientExportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  const qs = toQuery();
  const url = qs ? `/api/export.xlsx?${qs}` : '/api/export.xlsx';
  try {
    el.downloadExcelBtn.disabled = true;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const suggestedName = getFilenameFromDisposition(res.headers.get('content-disposition')) || 'filtered.xlsx';
    const saved = await saveWithPicker(blob, suggestedName);
    if (saved) return;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    alert(`엑셀 다운로드 실패: ${err.message}`);
  } finally {
    el.downloadExcelBtn.disabled = false;
  }
}

function renderSiteStructure() {
  const config = activeConfig();
  el.searchInput.placeholder = config.searchPlaceholder;
  if (el.currentScope) {
    el.currentScope.textContent = `사이트: ${siteLabel(state.selectedSite)} · 국가: ${countryLabel(state.selectedCountry)}`;
  }
  if (el.siteAmazonCard) {
    el.siteAmazonCard.classList.toggle('active', state.selectedSite === 'amazon_jp');
  }
  if (el.siteQoo10Card) {
    el.siteQoo10Card.classList.toggle('active', state.selectedSite === 'qoo10_jp');
  }
  el.sortKey.innerHTML = config.sortOptions.map(([value, label]) => `<option value="${value}">${safe(label)}</option>`).join('');
  if (!config.sortOptions.some(([value]) => value === el.sortKey.value)) {
    el.sortKey.value = config.sortOptions[0][0];
  }
  el.tableHead.innerHTML = `<tr>${config.columns.map(([, label]) => `<th>${safe(label)}</th>`).join('')}</tr>`;
  el.sellerBadgeCard.style.display = config.showSellerBadgeChart ? '' : 'none';
  if (isHelpOpen()) renderHelpModal();
}

function renderKpis(summary) {
  const total = summary.total || 0;
  const roamingPct = total ? Math.round((summary.roamingCount / total) * 100) : 0;
  const localPct = total ? Math.round((summary.localCount / total) * 100) : 0;
  const unlimitedPct = total ? Math.round((summary.unlimitedCount / total) * 100) : 0;
  const kpis = state.selectedSite === 'qoo10_jp'
    ? [
        ['사이트', siteLabel(state.selectedSite)],
        ['필터 결과', `${total.toLocaleString('ko-KR')}개`],
        ['최저 / 중앙 / 평균', `${yen(summary.priceMin)} / ${yen(summary.priceMedian)} / ${yen(summary.priceAvg)}`],
        ['최저 / 중앙 / 평균 (KRW)', `${won(summary.priceKrwMin)} / ${won(summary.priceKrwMedian)} / ${won(summary.priceKrwAvg)}`],
        ['최고 가격', yen(summary.priceMax)],
        ['최고 가격 (KRW)', won(summary.priceKrwMax)],
        ['리뷰 수 중앙값', summary.reviewMedian === null ? '-' : `${summary.reviewMedian.toLocaleString('ko-KR')}`],
        ['리뷰 수 확인 상품', `${summary.reviewKnownCount.toLocaleString('ko-KR')}개`],
        ['검색 상위 10개', `${summary.top10Count.toLocaleString('ko-KR')}개`],
        ['Power seller', `${summary.badgeCounts['Power seller'] || 0}`],
        ['Good seller', `${summary.badgeCounts['Good seller'] || 0}`],
        ['General seller', `${summary.badgeCounts['General seller'] || 0}`],
        ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
        ['무제한 비중', `${unlimitedPct}%`],
        ...buildCarrierKpiEntries(summary),
      ]
    : [
        ['사이트', siteLabel(state.selectedSite)],
        ['필터 결과', `${total.toLocaleString('ko-KR')}개`],
        ['최저 / 중앙 / 평균', `${yen(summary.priceMin)} / ${yen(summary.priceMedian)} / ${yen(summary.priceAvg)}`],
        ['최저 / 중앙 / 평균 (KRW)', `${won(summary.priceKrwMin)} / ${won(summary.priceKrwMedian)} / ${won(summary.priceKrwAvg)}`],
        ['최고 가격', yen(summary.priceMax)],
        ['최고 가격 (KRW)', won(summary.priceKrwMax)],
        ['판매량 수집', `${summary.salesKnownCount.toLocaleString('ko-KR')}개`],
        ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
        ['무제한 비중', `${unlimitedPct}%`],
        ['베스트셀러 배지', `${summary.bestsellerCount}`],
        ['랭크 확인 상품', `${summary.bestsellerRankKnownCount}`],
        ...buildCarrierKpiEntries(summary),
      ];
  el.kpis.innerHTML = kpis.map(([label, value]) => `<div class="kpi"><label>${safe(label)}</label><strong>${safe(value)}</strong></div>`).join('');
}

function renderBars(container, mapObj, suffix = '개') {
  const entries = Object.entries(mapObj || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    container.innerHTML = '<p class="empty">표시할 데이터가 없습니다.</p>';
    return;
  }
  const max = entries[0][1] || 1;
  container.innerHTML = entries.map(([key, count]) => {
    const width = Math.max(4, Math.round((count / max) * 100));
    return `<div class="barRow"><div class="barHead"><span>${safe(key)}</span><span>${count}${suffix}</span></div><div class="track"><div class="fill" style="width:${width}%"></div></div></div>`;
  }).join('');
}

function renderFilterOptions(items) {
  const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const networkOptions = unique(items.map((it) => it.network_type));
  const dataOptions = unique(items.map((it) => it.data_amount));
  const usageOptions = unique(items.map((it) => it.usage_validity));
  const keep = { network: el.networkFilter.value, data: el.dataFilter.value, usage: el.usageFilter.value, carrier: el.carrierFilter.value };
  el.networkFilter.innerHTML = '<option value="">네트워크 전체</option>' + networkOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.dataFilter.innerHTML = '<option value="">데이터 전체</option>' + dataOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.usageFilter.innerHTML = '<option value="">사용기간 전체</option>' + usageOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.carrierFilter.innerHTML = ['<option value="">통신사 전체</option>', '<option value="any">통신사 명시 상품</option>']
    .concat(getCarrierDefinitions(state.selectedCountry).map(([code, label]) => `<option value="${safe(code)}">${safe(label)} 지원</option>`))
    .join('');
  el.networkFilter.value = keep.network;
  el.dataFilter.value = keep.data;
  el.usageFilter.value = keep.usage;
  el.carrierFilter.value = Array.from(el.carrierFilter.options).some((opt) => opt.value === keep.carrier) ? keep.carrier : '';
}

function cellValue(row, key) {
  if (key === 'title') {
    return row.product_url ? `<a class="titleLink" href="${safeHref(row.product_url)}" target="_blank" rel="noopener noreferrer">${safe(row.title)}</a>` : safe(row.title);
  }
  if (key === 'price_jpy') return yen(row.price_jpy);
  if (key === 'price_krw') return won(row.price_krw);
  if (key === 'monthly_sold_count') return Number.isFinite(row.monthly_sold_count) ? `${row.monthly_sold_count.toLocaleString('ko-KR')}개` : '-';
  if (key === 'review_count') return Number.isFinite(row.review_count) ? `${row.review_count.toLocaleString('ko-KR')}` : '-';
  if (key === 'is_bestseller') return row.is_bestseller === true ? 'Yes' : (row.is_bestseller === false ? 'No' : '-');
  if (key === 'bestseller_rank') return Number.isFinite(row.bestseller_rank) ? `${row.bestseller_rank.toLocaleString('ko-KR')}위` : '-';
  if (key === 'search_position') return Number.isFinite(row.search_position) ? `${row.search_position}` : '-';
  if (key === 'carrier_support_local') return safe(carrierLabel(row.carrier_support_local, row.country || state.selectedCountry));
  return safe(row[key]);
}

function renderTable() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
  state.currentPage = Math.min(state.currentPage, totalPages);
  const start = (state.currentPage - 1) * pageSize;
  const pageRows = state.filtered.slice(start, start + pageSize);
  const config = activeConfig();
  el.rows.innerHTML = pageRows.map((row) => `<tr>${config.columns.map(([key]) => `<td${key === 'title' ? ' class="titleCell"' : ''}>${cellValue(row, key)}</td>`).join('')}</tr>`).join('');
  el.pageInfo.textContent = `${state.currentPage} / ${totalPages} (총 ${state.filtered.length.toLocaleString('ko-KR')}개)`;
  el.prevPage.disabled = state.currentPage <= 1;
  el.nextPage.disabled = state.currentPage >= totalPages;
}

function applyLocalFilters(items) {
  const q = el.searchInput.value.trim().toLowerCase();
  const network = String(el.networkFilter.value || '').trim();
  const dataAmount = String(el.dataFilter.value || '').trim();
  const usage = String(el.usageFilter.value || '').trim();
  const carrier = String(el.carrierFilter.value || '').trim();
  const minPrice = el.minPrice.value ? Number(el.minPrice.value) : null;
  const maxPrice = el.maxPrice.value ? Number(el.maxPrice.value) : null;
  const sort = String(el.sortKey.value || 'priceAsc').trim();

  const filtered = items.filter((it) => {
    if (network && it.network_type !== network) return false;
    if (dataAmount && (it.data_amount || '') !== dataAmount) return false;
    if (usage && (it.usage_validity || '') !== usage) return false;
    if (carrier === 'any' && !Object.values(it.carrier_support_local || {}).some(Boolean)) return false;
    if (carrier && carrier !== 'any' && !it.carrier_support_local?.[carrier]) return false;
    if (Number.isFinite(minPrice) && Number.isFinite(it.price_jpy) && it.price_jpy < minPrice) return false;
    if (Number.isFinite(maxPrice) && Number.isFinite(it.price_jpy) && it.price_jpy > maxPrice) return false;
    if (!q) return true;
    const bag = [it.title, it.seller, it.brand, it.seller_badge, it.network_type, it.data_amount, it.usage_validity, it.activation_validity].join(' ').toLowerCase();
    return bag.includes(q);
  });

  if (sort === 'priceDesc') filtered.sort((a, b) => (b.price_jpy ?? -1) - (a.price_jpy ?? -1));
  else if (sort === 'salesDesc') filtered.sort((a, b) => (b.monthly_sold_count ?? -1) - (a.monthly_sold_count ?? -1) || (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));
  else if (sort === 'reviewDesc') filtered.sort((a, b) => (b.review_count ?? -1) - (a.review_count ?? -1) || (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));
  else if (sort === 'positionAsc') filtered.sort((a, b) => (a.search_position ?? Number.MAX_SAFE_INTEGER) - (b.search_position ?? Number.MAX_SAFE_INTEGER));
  else if (sort === 'usageAsc') filtered.sort((a, b) => (a.usage_days ?? Number.MAX_SAFE_INTEGER) - (b.usage_days ?? Number.MAX_SAFE_INTEGER));
  else filtered.sort((a, b) => (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));

  return filtered;
}

function renderLocalView() {
  updateAmazonReviewVisibility(state.items);
  renderSiteStructure();
  state.filtered = applyLocalFilters(state.items);
  state.currentPage = 1;
  const summary = summarize(state.filtered);
  renderKpis(summary);
  renderBars(el.dataAmountBars, summary.byDataAmount);
  renderBars(el.networkBars, summary.byNetwork);
  if (activeConfig().showSellerBadgeChart) renderBars(el.sellerBadgeBars, summary.badgeCounts);
  renderTable();
}

function resolveDataPath(pathValue, fallbackPath) {
  if (!pathValue) return fallbackPath;
  const trimmed = String(pathValue).trim();
  if (trimmed.startsWith('./')) return trimmed;
  if (trimmed.startsWith('/')) return `.${trimmed}`;
  return `./data/${trimmed}`;
}

async function loadIndexData() {
  const url = IS_GITHUB_PAGES ? './data/index.json' : '/api/index';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { latest: {}, runs: [] };
    return await res.json();
  } catch (_) {
    return { latest: {}, runs: [] };
  }
}

async function loadDataStaticFromRecord(record) {
  const jsonlPath = resolveDataPath(record && record.jsonl, `./data/sites/${state.selectedSite}/latest.jsonl`);
  const jsonlFallback = `./data/sites/${state.selectedSite}/${state.selectedCountry}/latest.jsonl`;
  const csvPath = resolveDataPath(record && record.csv, `./data/sites/${state.selectedSite}/${state.selectedCountry}/latest.csv`);
  const metaPath = resolveDataPath(record && record.metadata, `./data/sites/${state.selectedSite}/${state.selectedCountry}/metadata.json`);
  const finalJsonlPath = resolveDataPath(record && record.jsonl, jsonlFallback);
  const res = await fetch(finalJsonlPath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`정적 데이터 로드 실패: HTTP ${res.status}`);
  const items = parseJsonl(await res.text()).map(normalizeItem).filter(keepDashboardItem);
  let metadata = null;
  if (record && (record.crawled_at || record.published_at || record.source || record.item_count)) {
    metadata = { source: record.source || finalJsonlPath, crawled_at: record.crawled_at || null, published_at: record.published_at || null, item_count: record.item_count || items.length, site: record.site || state.selectedSite, country: record.country || state.selectedCountry };
  } else {
    try {
      const metaRes = await fetch(metaPath, { cache: 'no-store' });
      if (metaRes.ok) metadata = await metaRes.json();
    } catch (_) { metadata = null; }
  }
  state.exchangeRate = await resolveExchangeRateMeta(null);
  state.items = FX.attachKrwPrices(items, state.exchangeRate);
  state.totalBeforeFilter = items.length;
  state.file = metadata && metadata.source ? metadata.source : finalJsonlPath;
  state.generatedAt = metadata && metadata.crawled_at ? metadata.crawled_at : null;
  state.selectedCsvPath = csvPath;
  el.metaText.textContent = `사이트: ${siteLabel(state.selectedSite)} | 국가: ${countryLabel(state.selectedCountry)} | 파일: ${state.file} | 추출: ${isoToLocal(state.generatedAt)} | 반영: ${isoToLocal(metadata && metadata.published_at)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;
  renderExchangeRateMeta();
  renderSiteStructure();
  renderFilterOptions(state.items);
  renderLocalView();
}

async function loadDataStatic() {
  const index = await loadIndexData();
  state.datasets = Array.isArray(index.runs) ? index.runs : [];
  populateSiteOptions(index);
  populateCountryOptions(index);
  const datasets = getDatasetsForSelectedSite();
  if (state.selectedDatasetId && !datasets.some((d) => String(d.id) === String(state.selectedDatasetId))) state.selectedDatasetId = null;
  populateDatasetOptions(datasets);
  if (state.selectedDatasetId) {
    const selected = datasets.find((d) => String(d.id) === String(state.selectedDatasetId));
    if (selected) return loadDataStaticFromRecord(selected);
  }
  const latestBySite = index.latest && index.latest[state.selectedSite] ? index.latest[state.selectedSite] : null;
  return loadDataStaticFromRecord(latestBySite && latestBySite[state.selectedCountry] ? latestBySite[state.selectedCountry] : null);
}

async function loadData() {
  if (IS_GITHUB_PAGES) return loadDataStatic();
  const index = await loadIndexData();
  state.datasets = Array.isArray(index.runs) ? index.runs : [];
  populateSiteOptions(index);
  populateCountryOptions(index);
  const datasets = getDatasetsForSelectedSite();
  if (state.selectedDatasetId && !datasets.some((d) => String(d.id) === String(state.selectedDatasetId))) state.selectedDatasetId = null;
  populateDatasetOptions(datasets);
  const qs = toQuery();
  const res = await fetch(qs ? `/api/latest?${qs}` : '/api/latest', { cache: 'no-store' });
  const data = await res.json();
  renderSiteStructure();
  if (!data.found) {
    state.items = [];
    state.filtered = [];
    state.exchangeRate = FX.buildExchangeRateMeta({ unavailable: true, stale: true });
    el.metaText.textContent = data.message || '데이터가 없습니다.';
    renderExchangeRateMeta();
    renderKpis(summarize([]));
    renderBars(el.dataAmountBars, {});
    renderBars(el.networkBars, {});
    if (activeConfig().showSellerBadgeChart) renderBars(el.sellerBadgeBars, {});
    renderTable();
    return;
  }
  state.exchangeRate = await resolveExchangeRateMeta(data.exchangeRate || null);
  state.items = FX.attachKrwPrices(data.items.map(normalizeItem), state.exchangeRate);
  state.filtered = state.items;
  state.totalBeforeFilter = data.totalBeforeFilter || data.items.length;
  state.file = data.file;
  state.generatedAt = data.generatedAt;
  state.currentPage = 1;
  el.metaText.textContent = `사이트: ${siteLabel(state.selectedSite)} | 국가: ${countryLabel(state.selectedCountry)} | 파일: ${data.file} | 생성: ${isoToLocal(data.generatedAt)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;
  renderExchangeRateMeta();
  renderFilterOptions(state.items);
  renderLocalView();
}

function triggerReload() {
  loadData().catch((err) => {
    el.metaText.textContent = `로드 실패: ${err.message}`;
  });
}

for (const input of [el.searchInput, el.networkFilter, el.dataFilter, el.usageFilter, el.carrierFilter, el.minPrice, el.maxPrice, el.sortKey]) {
  const evt = input.tagName === 'INPUT' ? 'input' : 'change';
  input.addEventListener(evt, triggerReload);
}

el.siteSelect.addEventListener('change', () => {
  state.selectedSite = el.siteSelect.value || 'amazon_jp';
  state.selectedDatasetId = null;
  renderSiteStructure();
  triggerReload();
});

el.countrySelect.addEventListener('change', () => {
  state.selectedCountry = el.countrySelect.value || 'kr';
  state.selectedDatasetId = null;
  triggerReload();
});

el.datasetSelect.addEventListener('change', () => {
  state.selectedDatasetId = el.datasetSelect.value || null;
  triggerReload();
});

el.refreshBtn.addEventListener('click', triggerReload);
el.helpBtn.addEventListener('click', openHelpModal);
el.helpCloseBtn.addEventListener('click', closeHelpModal);
el.helpOverlay.addEventListener('click', (event) => {
  if (event.target === el.helpOverlay) closeHelpModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isHelpOpen()) closeHelpModal();
});
el.prevPage.addEventListener('click', () => { state.currentPage = Math.max(1, state.currentPage - 1); renderTable(); });
el.nextPage.addEventListener('click', () => { const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize)); state.currentPage = Math.min(totalPages, state.currentPage + 1); renderTable(); });
el.downloadExcelBtn.addEventListener('click', downloadFilteredExcel);

renderSiteStructure();
renderExchangeRateMeta();
triggerReload();
