const pageSize = 20;
const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
const SITE_CONFIG = {
  amazon_jp: {
    sortOptions: [
      ['priceAsc', '가격 낮은순'],
      ['priceDesc', '가격 높은순'],
      ['salesDesc', '판매량 높은순'],
      ['usageAsc', '사용기간 짧은순'],
    ],
    columns: [
      ['title', '상품명'],
      ['price_jpy', '가격 (JPY)'],
      ['monthly_sold_count', '판매량(최근 1개월)'],
      ['is_bestseller', '베스트셀러'],
      ['bestseller_rank', '판매순위'],
      ['network_type', '네트워크'],
      ['data_amount', '데이터'],
      ['usage_validity', '사용기간'],
      ['activation_validity', '활성화기간'],
      ['carrier_support_kr', '통신사 지원'],
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
      ['review_count', '리뷰 수'],
      ['seller_badge', '셀러 배지'],
      ['search_position', '검색 위치'],
      ['network_type', '네트워크'],
      ['data_amount', '데이터'],
      ['usage_validity', '사용기간'],
      ['activation_validity', '활성화기간'],
      ['carrier_support_kr', '통신사 지원'],
      ['seller', '셀러'],
    ],
    showSellerBadgeChart: true,
    searchPlaceholder: '상품명/셀러/셀러 배지 검색',
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
  selectedSite: 'amazon_jp',
  selectedDatasetId: null,
  selectedCsvPath: './data/sites/amazon_jp/latest.csv',
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

function normalizeCarrier(carrierSupport) {
  const c = carrierSupport && typeof carrierSupport === 'object' ? carrierSupport : {};
  return {
    skt: c.skt === true,
    kt: c.kt === true,
    lgu: c.lgu === true,
  };
}

function normalizeItem(raw) {
  const carrier = normalizeCarrier(raw.carrier_support_kr);
  return {
    site: raw.site || null,
    title: raw.title || '',
    product_url: typeof raw.product_url === 'string' ? raw.product_url : null,
    price_jpy: Number.isFinite(Number(raw.price_jpy)) ? Number(raw.price_jpy) : null,
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
    carrier_support_kr: carrier,
    usage_days: extractDays(raw.usage_validity || raw.validity || null),
    activation_days: extractDays(raw.activation_validity || null),
  };
}

const el = {
  metaText: document.getElementById('metaText'),
  refreshBtn: document.getElementById('refreshBtn'),
  siteSelect: document.getElementById('siteSelect'),
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
  return SITE_CONFIG[state.selectedSite] || SITE_CONFIG.amazon_jp;
}

function siteLabel(site) {
  return site === 'qoo10_jp' ? 'Qoo10 JP' : 'Amazon JP';
}

function formatDatasetLabel(entry) {
  const crawled = entry && entry.crawled_at ? isoToLocal(entry.crawled_at) : '-';
  const count = Number.isFinite(Number(entry && entry.item_count)) ? Number(entry.item_count).toLocaleString('ko-KR') : '-';
  const source = (entry && entry.source) ? String(entry.source).split(/[\\/]/).pop() : (entry && entry.id ? entry.id : 'dataset');
  return `${crawled} | ${source} | ${count}개`;
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
  return state.datasets.filter((entry) => (entry.site || 'amazon_jp') === state.selectedSite);
}

function yen(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
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
  const sales = items.map((it) => it.monthly_sold_count).filter((n) => Number.isFinite(n));
  const reviews = items.map((it) => it.review_count).filter((n) => Number.isFinite(n));
  const localCount = items.filter((it) => it.network_type === 'local').length;
  const roamingCount = items.filter((it) => it.network_type === 'roaming').length;
  const unlimitedCount = items.filter((it) => String(it.data_amount || '').toLowerCase() === 'unlimited').length;
  const bestsellerCount = items.filter((it) => it.is_bestseller === true).length;
  const bestsellerRankKnownCount = items.filter((it) => Number.isFinite(it.bestseller_rank)).length;
  const top10Count = items.filter((it) => Number.isFinite(it.search_position) && it.search_position <= 10).length;

  const carrierTrue = {
    skt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.skt).length,
    kt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.kt).length,
    lgu: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.lgu).length,
  };
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
    carrierTrue,
    badgeCounts,
    byDataAmount,
    byNetwork,
  };
}

function carrierLabel(carrier) {
  const out = [];
  if (carrier && carrier.skt) out.push('SKT');
  if (carrier && carrier.kt) out.push('KT');
  if (carrier && carrier.lgu) out.push('LGU+');
  return out.length ? out.join(', ') : 'unknown';
}

function toQuery(includeDataset = true) {
  const params = new URLSearchParams();
  params.set('site', state.selectedSite);
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
    const a = document.createElement('a');
    a.href = state.selectedCsvPath;
    a.download = (a.href.split('/').pop() || 'latest.csv').split('?')[0];
    document.body.appendChild(a);
    a.click();
    a.remove();
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
  el.sortKey.innerHTML = config.sortOptions.map(([value, label]) => `<option value="${value}">${safe(label)}</option>`).join('');
  if (!config.sortOptions.some(([value]) => value === el.sortKey.value)) {
    el.sortKey.value = config.sortOptions[0][0];
  }
  el.tableHead.innerHTML = `<tr>${config.columns.map(([, label]) => `<th>${safe(label)}</th>`).join('')}</tr>`;
  el.sellerBadgeCard.style.display = config.showSellerBadgeChart ? '' : 'none';
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
        ['최고 가격', yen(summary.priceMax)],
        ['리뷰 수 중앙값', summary.reviewMedian === null ? '-' : `${summary.reviewMedian.toLocaleString('ko-KR')}`],
        ['리뷰 수 확인 상품', `${summary.reviewKnownCount.toLocaleString('ko-KR')}개`],
        ['검색 상위 10개', `${summary.top10Count.toLocaleString('ko-KR')}개`],
        ['Power seller', `${summary.badgeCounts['Power seller'] || 0}`],
        ['Good seller', `${summary.badgeCounts['Good seller'] || 0}`],
        ['General seller', `${summary.badgeCounts['General seller'] || 0}`],
        ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
        ['무제한 비중', `${unlimitedPct}%`],
        ['SKT 명시', `${summary.carrierTrue.skt}`],
        ['KT 명시', `${summary.carrierTrue.kt}`],
        ['LGU+ 명시', `${summary.carrierTrue.lgu}`],
      ]
    : [
        ['사이트', siteLabel(state.selectedSite)],
        ['필터 결과', `${total.toLocaleString('ko-KR')}개`],
        ['최저 / 중앙 / 평균', `${yen(summary.priceMin)} / ${yen(summary.priceMedian)} / ${yen(summary.priceAvg)}`],
        ['최고 가격', yen(summary.priceMax)],
        ['판매량 중앙값', summary.salesMedian === null ? '-' : `${summary.salesMedian.toLocaleString('ko-KR')}개`],
        ['판매량 수집', `${summary.salesKnownCount.toLocaleString('ko-KR')}개`],
        ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
        ['무제한 비중', `${unlimitedPct}%`],
        ['베스트셀러 배지', `${summary.bestsellerCount}`],
        ['랭크 확인 상품', `${summary.bestsellerRankKnownCount}`],
        ['SKT 명시', `${summary.carrierTrue.skt}`],
        ['KT 명시', `${summary.carrierTrue.kt}`],
        ['LGU+ 명시', `${summary.carrierTrue.lgu}`],
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
  const keep = { network: el.networkFilter.value, data: el.dataFilter.value, usage: el.usageFilter.value };
  el.networkFilter.innerHTML = '<option value="">네트워크 전체</option>' + networkOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.dataFilter.innerHTML = '<option value="">데이터 전체</option>' + dataOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.usageFilter.innerHTML = '<option value="">사용기간 전체</option>' + usageOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.networkFilter.value = keep.network;
  el.dataFilter.value = keep.data;
  el.usageFilter.value = keep.usage;
}

function cellValue(row, key) {
  if (key === 'title') {
    return row.product_url ? `<a class="titleLink" href="${safeHref(row.product_url)}" target="_blank" rel="noopener noreferrer">${safe(row.title)}</a>` : safe(row.title);
  }
  if (key === 'price_jpy') return yen(row.price_jpy);
  if (key === 'monthly_sold_count') return Number.isFinite(row.monthly_sold_count) ? `${row.monthly_sold_count.toLocaleString('ko-KR')}개` : '-';
  if (key === 'review_count') return Number.isFinite(row.review_count) ? `${row.review_count.toLocaleString('ko-KR')}` : '-';
  if (key === 'is_bestseller') return row.is_bestseller === true ? 'Yes' : (row.is_bestseller === false ? 'No' : '-');
  if (key === 'bestseller_rank') return Number.isFinite(row.bestseller_rank) ? `${row.bestseller_rank.toLocaleString('ko-KR')}위` : '-';
  if (key === 'search_position') return Number.isFinite(row.search_position) ? `${row.search_position}` : '-';
  if (key === 'carrier_support_kr') return safe(carrierLabel(row.carrier_support_kr));
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
    if (carrier === 'skt' && !it.carrier_support_kr.skt) return false;
    if (carrier === 'kt' && !it.carrier_support_kr.kt) return false;
    if (carrier === 'lgu' && !it.carrier_support_kr.lgu) return false;
    if (carrier === 'any' && !(it.carrier_support_kr.skt || it.carrier_support_kr.kt || it.carrier_support_kr.lgu)) return false;
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
  const csvPath = resolveDataPath(record && record.csv, `./data/sites/${state.selectedSite}/latest.csv`);
  const metaPath = resolveDataPath(record && record.metadata, `./data/sites/${state.selectedSite}/metadata.json`);
  const res = await fetch(jsonlPath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`정적 데이터 로드 실패: HTTP ${res.status}`);
  const items = parseJsonl(await res.text()).map(normalizeItem);
  let metadata = null;
  if (record && (record.crawled_at || record.published_at || record.source || record.item_count)) {
    metadata = { source: record.source || jsonlPath, crawled_at: record.crawled_at || null, published_at: record.published_at || null, item_count: record.item_count || items.length, site: record.site || state.selectedSite };
  } else {
    try {
      const metaRes = await fetch(metaPath, { cache: 'no-store' });
      if (metaRes.ok) metadata = await metaRes.json();
    } catch (_) { metadata = null; }
  }
  state.items = items;
  state.totalBeforeFilter = items.length;
  state.file = metadata && metadata.source ? metadata.source : jsonlPath;
  state.generatedAt = metadata && metadata.crawled_at ? metadata.crawled_at : null;
  state.selectedCsvPath = csvPath;
  el.metaText.textContent = `사이트: ${siteLabel(state.selectedSite)} | 파일: ${state.file} | 추출: ${isoToLocal(state.generatedAt)} | 반영: ${isoToLocal(metadata && metadata.published_at)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;
  renderSiteStructure();
  renderFilterOptions(state.items);
  renderLocalView();
}

async function loadDataStatic() {
  const index = await loadIndexData();
  state.datasets = Array.isArray(index.runs) ? index.runs : [];
  populateSiteOptions(index);
  const datasets = getDatasetsForSelectedSite();
  if (state.selectedDatasetId && !datasets.some((d) => String(d.id) === String(state.selectedDatasetId))) state.selectedDatasetId = null;
  populateDatasetOptions(datasets);
  if (state.selectedDatasetId) {
    const selected = datasets.find((d) => String(d.id) === String(state.selectedDatasetId));
    if (selected) return loadDataStaticFromRecord(selected);
  }
  return loadDataStaticFromRecord(index.latest && index.latest[state.selectedSite] ? index.latest[state.selectedSite] : null);
}

async function loadData() {
  if (IS_GITHUB_PAGES) return loadDataStatic();
  const index = await loadIndexData();
  state.datasets = Array.isArray(index.runs) ? index.runs : [];
  populateSiteOptions(index);
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
    el.metaText.textContent = data.message || '데이터가 없습니다.';
    renderKpis(summarize([]));
    renderBars(el.dataAmountBars, {});
    renderBars(el.networkBars, {});
    if (activeConfig().showSellerBadgeChart) renderBars(el.sellerBadgeBars, {});
    renderTable();
    return;
  }
  state.items = data.items;
  state.filtered = data.items;
  state.totalBeforeFilter = data.totalBeforeFilter || data.items.length;
  state.file = data.file;
  state.generatedAt = data.generatedAt;
  state.currentPage = 1;
  el.metaText.textContent = `사이트: ${siteLabel(state.selectedSite)} | 파일: ${data.file} | 생성: ${isoToLocal(data.generatedAt)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;
  renderFilterOptions(data.items);
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

el.datasetSelect.addEventListener('change', () => {
  state.selectedDatasetId = el.datasetSelect.value || null;
  triggerReload();
});

el.refreshBtn.addEventListener('click', triggerReload);
el.prevPage.addEventListener('click', () => { state.currentPage = Math.max(1, state.currentPage - 1); renderTable(); });
el.nextPage.addEventListener('click', () => { const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize)); state.currentPage = Math.min(totalPages, state.currentPage + 1); renderTable(); });
el.downloadExcelBtn.addEventListener('click', downloadFilteredExcel);

renderSiteStructure();
triggerReload();
