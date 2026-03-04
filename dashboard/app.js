const pageSize = 20;
const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
let state = {
  items: [],
  filtered: [],
  currentPage: 1,
  file: null,
  generatedAt: null,
  totalBeforeFilter: 0,
  datasets: [],
  selectedDatasetId: null,
  selectedCsvPath: './data/latest.csv',
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
    title: raw.title || '',
    product_url: typeof raw.product_url === 'string' ? raw.product_url : null,
    price_jpy: Number.isFinite(Number(raw.price_jpy)) ? Number(raw.price_jpy) : null,
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
    carrier_support_kr: carrier,
    usage_days: extractDays(raw.usage_validity || raw.validity || null),
    activation_days: extractDays(raw.activation_validity || null),
  };
}

const el = {
  metaText: document.getElementById('metaText'),
  refreshBtn: document.getElementById('refreshBtn'),
  datasetSelect: document.getElementById('datasetSelect'),
  kpis: document.getElementById('kpis'),
  dataAmountBars: document.getElementById('dataAmountBars'),
  networkBars: document.getElementById('networkBars'),
  searchInput: document.getElementById('searchInput'),
  networkFilter: document.getElementById('networkFilter'),
  dataFilter: document.getElementById('dataFilter'),
  usageFilter: document.getElementById('usageFilter'),
  carrierFilter: document.getElementById('carrierFilter'),
  minPrice: document.getElementById('minPrice'),
  maxPrice: document.getElementById('maxPrice'),
  sortKey: document.getElementById('sortKey'),
  rows: document.getElementById('rows'),
  pageInfo: document.getElementById('pageInfo'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  downloadExcelBtn: document.getElementById('downloadExcelBtn'),
};

function formatDatasetLabel(entry) {
  const crawled = entry && entry.crawled_at ? isoToLocal(entry.crawled_at) : '-';
  const count = Number.isFinite(Number(entry && entry.item_count)) ? Number(entry.item_count).toLocaleString('ko-KR') : '-';
  const source = (entry && entry.source) ? String(entry.source).split(/[\\/]/).pop() : (entry && entry.id ? entry.id : 'dataset');
  return `${crawled} | ${source} | ${count}개`;
}

function populateDatasetOptions(datasets) {
  if (!el.datasetSelect) return;
  if (!datasets.length) {
    el.datasetSelect.innerHTML = '<option value="">최신 데이터</option>';
    return;
  }
  el.datasetSelect.innerHTML = datasets
    .map((d) => `<option value="${safe(String(d.id || ''))}">${safe(formatDatasetLabel(d))}</option>`)
    .join('');
}

function yen(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function safe(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
  const localCount = items.filter((it) => it.network_type === 'local').length;
  const roamingCount = items.filter((it) => it.network_type === 'roaming').length;
  const unlimitedCount = items.filter((it) => String(it.data_amount || '').toLowerCase() === 'unlimited').length;
  const bestsellerCount = items.filter((it) => it.is_bestseller === true).length;
  const bestsellerRankKnownCount = items.filter((it) => Number.isFinite(it.bestseller_rank)).length;

  const carrierTrue = {
    skt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.skt).length,
    kt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.kt).length,
    lgu: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.lgu).length,
  };

  const byDataAmount = {};
  const byNetwork = {};
  for (const it of items) {
    const d = it.data_amount || 'unknown';
    const n = it.network_type || 'unknown';
    byDataAmount[d] = (byDataAmount[d] || 0) + 1;
    byNetwork[n] = (byNetwork[n] || 0) + 1;
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
    bestsellerCount,
    bestsellerRankKnownCount,
    carrierTrue,
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

function toQuery() {
  const params = new URLSearchParams();
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
  const match = contentDisposition.match(/filename=\"([^\"]+)\"/i);
  if (!match || !match[1]) return null;
  return match[1];
}

async function saveWithPicker(blob, suggestedName) {
  if (!('showSaveFilePicker' in window)) return false;
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'Excel Workbook',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
      },
    ],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

async function downloadFilteredExcel() {
  if (IS_GITHUB_PAGES) {
    const a = document.createElement('a');
    a.href = state.selectedCsvPath || './data/latest.csv';
    const filename = (a.href.split('/').pop() || 'latest.csv').split('?')[0];
    a.download = filename;
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
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.message) message = body.message;
      } catch (_) {
        // noop
      }
      throw new Error(message);
    }

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

function renderKpis(summary) {
  const total = summary.total || 0;
  const roamingPct = total ? Math.round((summary.roamingCount / total) * 100) : 0;
  const localPct = total ? Math.round((summary.localCount / total) * 100) : 0;
  const unlimitedPct = total ? Math.round((summary.unlimitedCount / total) * 100) : 0;
  const kpis = [
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

  el.kpis.innerHTML = kpis
    .map(([label, value]) => `<div class="kpi"><label>${safe(label)}</label><strong>${safe(value)}</strong></div>`)
    .join('');
}

function renderBars(container, mapObj, suffix = '개') {
  const entries = Object.entries(mapObj || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!entries.length) {
    container.innerHTML = '<p class="empty">표시할 데이터가 없습니다.</p>';
    return;
  }

  const max = entries[0][1] || 1;
  container.innerHTML = entries
    .map(([key, count]) => {
      const width = Math.max(4, Math.round((count / max) * 100));
      return `
        <div class="barRow">
          <div class="barHead"><span>${safe(key)}</span><span>${count}${suffix}</span></div>
          <div class="track"><div class="fill" style="width:${width}%"></div></div>
        </div>
      `;
    })
    .join('');
}

function renderFilterOptions(items) {
  const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

  const networkOptions = unique(items.map((it) => it.network_type));
  const dataOptions = unique(items.map((it) => it.data_amount));
  const usageOptions = unique(items.map((it) => it.usage_validity));

  const keep = {
    network: el.networkFilter.value,
    data: el.dataFilter.value,
    usage: el.usageFilter.value,
  };

  el.networkFilter.innerHTML = '<option value="">네트워크 전체</option>' + networkOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.dataFilter.innerHTML = '<option value="">데이터 전체</option>' + dataOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.usageFilter.innerHTML = '<option value="">사용기간 전체</option>' + usageOptions.map((v) => `<option>${safe(v)}</option>`).join('');

  el.networkFilter.value = keep.network;
  el.dataFilter.value = keep.data;
  el.usageFilter.value = keep.usage;
}

function renderTable() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
  state.currentPage = Math.min(state.currentPage, totalPages);

  const start = (state.currentPage - 1) * pageSize;
  const pageRows = state.filtered.slice(start, start + pageSize);

  el.rows.innerHTML = pageRows
    .map((row) => `
      <tr>
        <td class="titleCell">${
          row.product_url
            ? `<a class="titleLink" href="${safeHref(row.product_url)}" target="_blank" rel="noopener noreferrer">${safe(row.title)}</a>`
            : safe(row.title)
        }</td>
        <td>${yen(row.price_jpy)}</td>
        <td>${Number.isFinite(row.monthly_sold_count) ? `${Number(row.monthly_sold_count).toLocaleString('ko-KR')}개` : '-'}</td>
        <td>${row.is_bestseller === true ? 'Yes' : (row.is_bestseller === false ? 'No' : '-')}</td>
        <td>${Number.isFinite(row.bestseller_rank) ? `${Number(row.bestseller_rank).toLocaleString('ko-KR')}위` : '-'}</td>
        <td>${safe(row.network_type)}</td>
        <td>${safe(row.data_amount)}</td>
        <td>${safe(row.usage_validity)}</td>
        <td>${safe(row.activation_validity)}</td>
        <td>${safe(carrierLabel(row.carrier_support_kr))}</td>
        <td>${safe(row.seller)}</td>
        <td>${safe(row.brand)}</td>
      </tr>
    `)
    .join('');

  el.pageInfo.textContent = `${state.currentPage} / ${totalPages} (총 ${state.filtered.length.toLocaleString('ko-KR')}개)`;
  el.prevPage.disabled = state.currentPage <= 1;
  el.nextPage.disabled = state.currentPage >= totalPages;
}

async function loadData() {
  if (IS_GITHUB_PAGES) {
    await loadDataStatic();
    return;
  }

  const qs = toQuery();
  const url = qs ? `/api/latest?${qs}` : '/api/latest';
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();

  if (!data.found) {
    state.items = [];
    state.filtered = [];
    el.metaText.textContent = data.message || '데이터가 없습니다.';
    renderKpis(summarize([]));
    renderBars(el.dataAmountBars, {});
    renderBars(el.networkBars, {});
    renderTable();
    return;
  }

  state.items = data.items;
  state.filtered = data.items;
  state.totalBeforeFilter = data.totalBeforeFilter || data.items.length;
  state.file = data.file;
  state.generatedAt = data.generatedAt;
  state.currentPage = 1;

  el.metaText.textContent = `파일: ${data.file} | 생성: ${isoToLocal(data.generatedAt)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;

  renderFilterOptions(data.items);
  const summary = summarize(state.filtered);
  renderKpis(summary);
  renderBars(el.dataAmountBars, summary.byDataAmount);
  renderBars(el.networkBars, summary.byNetwork);
  renderTable();
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
    if (carrier === 'any' && !(it.carrier_support_kr.skt || it.carrier_support_kr.kt || it.carrier_support_kr.lgu)) {
      return false;
    }

    if (Number.isFinite(minPrice) && Number.isFinite(it.price_jpy) && it.price_jpy < minPrice) return false;
    if (Number.isFinite(maxPrice) && Number.isFinite(it.price_jpy) && it.price_jpy > maxPrice) return false;

    if (!q) return true;
    const bag = [it.title, it.seller, it.brand, it.network_type, it.data_amount, it.usage_validity, it.activation_validity]
      .join(' ')
      .toLowerCase();
    return bag.includes(q);
  });

  if (sort === 'priceDesc') {
    filtered.sort((a, b) => (b.price_jpy ?? -1) - (a.price_jpy ?? -1));
  } else if (sort === 'salesDesc') {
    filtered.sort((a, b) => {
      const aSales = Number.isFinite(a.monthly_sold_count) ? a.monthly_sold_count : -1;
      const bSales = Number.isFinite(b.monthly_sold_count) ? b.monthly_sold_count : -1;
      if (bSales !== aSales) return bSales - aSales;

      const aBest = a.is_bestseller === true ? 1 : 0;
      const bBest = b.is_bestseller === true ? 1 : 0;
      if (bBest !== aBest) return bBest - aBest;

      const aRank = Number.isFinite(a.bestseller_rank) ? a.bestseller_rank : Number.MAX_SAFE_INTEGER;
      const bRank = Number.isFinite(b.bestseller_rank) ? b.bestseller_rank : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;

      return (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER);
    });
  } else if (sort === 'usageAsc') {
    filtered.sort((a, b) => (a.usage_days ?? Number.MAX_SAFE_INTEGER) - (b.usage_days ?? Number.MAX_SAFE_INTEGER));
  } else {
    filtered.sort((a, b) => (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));
  }

  return filtered;
}

function renderLocalView() {
  state.filtered = applyLocalFilters(state.items);
  state.currentPage = 1;
  const summary = summarize(state.filtered);
  renderKpis(summary);
  renderBars(el.dataAmountBars, summary.byDataAmount);
  renderBars(el.networkBars, summary.byNetwork);
  renderTable();
}

function resolveDataPath(pathValue, fallbackPath) {
  if (!pathValue) return fallbackPath;
  const trimmed = String(pathValue).trim();
  if (trimmed.startsWith('./')) return trimmed;
  if (trimmed.startsWith('/')) return `.${trimmed}`;
  return `./data/${trimmed}`;
}

async function loadDatasetIndex() {
  try {
    const res = await fetch('./data/index.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    const runs = Array.isArray(data.runs) ? data.runs : [];
    return runs;
  } catch (_) {
    return [];
  }
}

async function loadDataStaticFromRecord(record) {
  const jsonlPath = resolveDataPath(record && record.jsonl, './data/latest.jsonl');
  const csvPath = resolveDataPath(record && record.csv, './data/latest.csv');
  const metaPath = resolveDataPath(record && record.metadata, './data/metadata.json');

  const res = await fetch(jsonlPath, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`정적 데이터 로드 실패: HTTP ${res.status}`);
  }
  const raw = await res.text();
  const items = parseJsonl(raw).map(normalizeItem);

  let metadata = null;
  if (record && (record.crawled_at || record.published_at || record.source || record.item_count)) {
    metadata = {
      source: record.source || jsonlPath,
      crawled_at: record.crawled_at || null,
      published_at: record.published_at || null,
      item_count: record.item_count || items.length,
    };
  } else {
    try {
      const metaRes = await fetch(metaPath, { cache: 'no-store' });
      if (metaRes.ok) {
        metadata = await metaRes.json();
      }
    } catch (_) {
      metadata = null;
    }
  }

  state.items = items;
  state.totalBeforeFilter = items.length;
  state.file = (metadata && metadata.source) ? metadata.source : jsonlPath;
  state.generatedAt = metadata && metadata.crawled_at ? metadata.crawled_at : null;
  state.selectedCsvPath = csvPath;

  const crawledText = state.generatedAt ? isoToLocal(state.generatedAt) : '-';
  const publishedText = metadata && metadata.published_at ? isoToLocal(metadata.published_at) : '-';
  el.metaText.textContent = `파일: ${state.file} | 추출: ${crawledText} | 반영: ${publishedText} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;
  renderFilterOptions(state.items);
  renderLocalView();
}

async function loadDataStatic() {
  const datasets = await loadDatasetIndex();
  state.datasets = datasets;
  populateDatasetOptions(datasets);

  if (datasets.length) {
    const selectedId = state.selectedDatasetId && datasets.some((d) => d.id === state.selectedDatasetId)
      ? state.selectedDatasetId
      : String(datasets[0].id);
    state.selectedDatasetId = selectedId;
    if (el.datasetSelect) {
      el.datasetSelect.value = selectedId;
    }
    const selected = datasets.find((d) => String(d.id) === String(selectedId)) || datasets[0];
    await loadDataStaticFromRecord(selected);
    return;
  }

  state.selectedDatasetId = null;
  if (el.datasetSelect) {
    el.datasetSelect.innerHTML = '<option value="">latest.jsonl</option>';
    el.datasetSelect.value = '';
  }
  await loadDataStaticFromRecord(null);
}

function triggerReload() {
  if (IS_GITHUB_PAGES && state.items.length > 0) {
    renderLocalView();
    return;
  }
  loadData().catch((err) => {
    el.metaText.textContent = `로드 실패: ${err.message}`;
  });
}

for (const input of [
  el.searchInput,
  el.networkFilter,
  el.dataFilter,
  el.usageFilter,
  el.carrierFilter,
  el.minPrice,
  el.maxPrice,
  el.sortKey,
]) {
  const evt = input.tagName === 'INPUT' ? 'input' : 'change';
  input.addEventListener(evt, triggerReload);
}

if (el.datasetSelect) {
  el.datasetSelect.addEventListener('change', () => {
    if (!IS_GITHUB_PAGES) return;
    state.selectedDatasetId = el.datasetSelect.value || null;
    loadData().catch((err) => {
      el.metaText.textContent = `로드 실패: ${err.message}`;
    });
  });
}

if (IS_GITHUB_PAGES) {
  el.refreshBtn.addEventListener('click', () => {
    loadData().catch((err) => {
      el.metaText.textContent = `로드 실패: ${err.message}`;
    });
  });
} else {
  el.refreshBtn.addEventListener('click', triggerReload);
}
el.prevPage.addEventListener('click', () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  renderTable();
});
el.nextPage.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
  state.currentPage = Math.min(totalPages, state.currentPage + 1);
  renderTable();
});
el.downloadExcelBtn.addEventListener('click', downloadFilteredExcel);

triggerReload();
