const pageSize = 20;
const dataUrl = './data/latest.csv';
let state = {
  items: [],
  filtered: [],
  currentPage: 1,
  file: null,
  generatedAt: null,
  totalBeforeFilter: 0,
};

const el = {
  metaText: document.getElementById('metaText'),
  refreshBtn: document.getElementById('refreshBtn'),
  kpis: document.getElementById('kpis'),
  dataAmountBars: document.getElementById('dataAmountBars'),
  networkBars: document.getElementById('networkBars'),
  activationBars: document.getElementById('activationBars'),
  searchInput: document.getElementById('searchInput'),
  networkFilter: document.getElementById('networkFilter'),
  dataFilter: document.getElementById('dataFilter'),
  usageFilter: document.getElementById('usageFilter'),
  activationFilter: document.getElementById('activationFilter'),
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
  const localCount = items.filter((it) => it.network_type === 'local').length;
  const roamingCount = items.filter((it) => it.network_type === 'roaming').length;
  const unlimitedCount = items.filter((it) => String(it.data_amount || '').toLowerCase() === 'unlimited').length;

  const carrierTrue = {
    skt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.skt).length,
    kt: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.kt).length,
    lgu: items.filter((it) => it.carrier_support_kr && it.carrier_support_kr.lgu).length,
  };

  const byDataAmount = {};
  const byNetwork = {};
  const byActivation = {};
  for (const it of items) {
    const d = it.data_amount || 'unknown';
    const n = it.network_type || 'unknown';
    const a = it.activation_validity || 'unknown';
    byDataAmount[d] = (byDataAmount[d] || 0) + 1;
    byNetwork[n] = (byNetwork[n] || 0) + 1;
    byActivation[a] = (byActivation[a] || 0) + 1;
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
    carrierTrue,
    byDataAmount,
    byNetwork,
    byActivation,
  };
}

function carrierLabel(carrier) {
  const out = [];
  if (carrier && carrier.skt) out.push('SKT');
  if (carrier && carrier.kt) out.push('KT');
  if (carrier && carrier.lgu) out.push('LGU+');
  return out.length ? out.join(', ') : '미상';
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeItem(row) {
  const priceRaw = row.price_jpy ?? row.price ?? '';
  const priceNum = Number(String(priceRaw).replace(/[^0-9.-]/g, ''));
  return {
    title: row.title || '',
    price_jpy: Number.isFinite(priceNum) ? priceNum : null,
    validity: row.validity || null,
    usage_validity: row.usage_validity || row.validity || null,
    activation_validity: row.activation_validity || null,
    network_type: row.network_type || 'unknown',
    carrier_support_kr: parseJsonField(row.carrier_support_kr, { skt: false, kt: false, lgu: false }),
    data_amount: row.data_amount || null,
    product_url: row.product_url || null,
    asin: row.asin || null,
    seller: row.seller || null,
    brand: row.brand || null,
  };
}

function applyFilters(items) {
  const q = el.searchInput.value.trim().toLowerCase();
  const network = el.networkFilter.value;
  const dataAmount = el.dataFilter.value;
  const usage = el.usageFilter.value;
  const activation = el.activationFilter.value;
  const carrier = el.carrierFilter.value;
  const minPrice = el.minPrice.value ? Number(el.minPrice.value) : null;
  const maxPrice = el.maxPrice.value ? Number(el.maxPrice.value) : null;
  const sort = el.sortKey.value || 'priceAsc';

  const filtered = items.filter((it) => {
    if (network && it.network_type !== network) return false;
    if (dataAmount && (it.data_amount || '') !== dataAmount) return false;
    if (usage && (it.usage_validity || '') !== usage) return false;
    if (activation && (it.activation_validity || '') !== activation) return false;

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
  } else if (sort === 'usageAsc') {
    const toDays = (value) => {
      const m = String(value || '').match(/(\d{1,4})\s*일/);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    filtered.sort((a, b) => toDays(a.usage_validity) - toDays(b.usage_validity));
  } else {
    filtered.sort((a, b) => (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));
  }

  return filtered;
}

function renderKpis(summary) {
  const total = summary.total || 0;
  const roamingPct = total ? Math.round((summary.roamingCount / total) * 100) : 0;
  const localPct = total ? Math.round((summary.localCount / total) * 100) : 0;
  const unlimitedPct = total ? Math.round((summary.unlimitedCount / total) * 100) : 0;
  const kpis = [
    ['필터 결과', `${total.toLocaleString('ko-KR')}개`],
    ['최저 / 중앙 / 평균', `${yen(summary.priceMin)} / ${yen(summary.priceMedian)} / ${yen(summary.priceAvg)}`],
    ['최고 가격', `${yen(summary.priceMax)}`],
    ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
    ['무제한 비중', `${unlimitedPct}%`],
    ['SKT 명시', `${summary.carrierTrue.skt}`],
    ['KT 명시', `${summary.carrierTrue.kt}`],
    ['LGU+ 명시', `${summary.carrierTrue.lgu}`],
  ];

  el.kpis.innerHTML = kpis
    .map(([label, value]) => `
      <div class="kpi">
        <span class="kpiLabel">${safe(label)}</span>
        <strong class="kpiValue">${safe(value)}</strong>
      </div>
    `)
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
  const activationOptions = unique(items.map((it) => it.activation_validity));

  const keep = {
    network: el.networkFilter.value,
    data: el.dataFilter.value,
    usage: el.usageFilter.value,
    activation: el.activationFilter.value,
  };

  el.networkFilter.innerHTML = '<option value="">전체</option>' + networkOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.dataFilter.innerHTML = '<option value="">전체</option>' + dataOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.usageFilter.innerHTML = '<option value="">전체</option>' + usageOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.activationFilter.innerHTML = '<option value="">전체</option>' + activationOptions.map((v) => `<option>${safe(v)}</option>`).join('');

  el.networkFilter.value = keep.network;
  el.dataFilter.value = keep.data;
  el.usageFilter.value = keep.usage;
  el.activationFilter.value = keep.activation;
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

function updateDashboard() {
  state.filtered = applyFilters(state.items);
  renderFilterOptions(state.items);
  renderKpis(summarize(state.filtered));
  renderBars(el.dataAmountBars, summarize(state.filtered).byDataAmount);
  renderBars(el.networkBars, summarize(state.filtered).byNetwork);
  renderBars(el.activationBars, summarize(state.filtered).byActivation);
  renderTable();
}

async function loadData() {
  const res = await fetch(dataUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`CSV 로드 실패 (${res.status})`);
  }

  const lastModified = res.headers.get('last-modified');
  const text = await res.text();
  const cleaned = text.replace(/^\uFEFF/, '');

  const parsed = Papa.parse(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors && parsed.errors.length) {
    throw new Error(parsed.errors[0].message || 'CSV 파싱 실패');
  }

  const items = (parsed.data || []).map(normalizeItem);

  state.items = items;
  state.filtered = items;
  state.totalBeforeFilter = items.length;
  state.file = 'data/latest.csv';
  state.generatedAt = lastModified ? new Date(lastModified).toISOString() : null;
  state.currentPage = 1;

  el.metaText.textContent = `파일: ${state.file} | 생성: ${isoToLocal(state.generatedAt)} | 원본 ${state.totalBeforeFilter.toLocaleString('ko-KR')}개`;

  renderFilterOptions(state.items);
  const summary = summarize(state.filtered);
  renderKpis(summary);
  renderBars(el.dataAmountBars, summary.byDataAmount);
  renderBars(el.networkBars, summary.byNetwork);
  renderBars(el.activationBars, summary.byActivation);
  renderTable();
}

function triggerReload() {
  loadData().catch((err) => {
    el.metaText.textContent = `로드 실패: ${err.message}`;
  });
}

function downloadCsv() {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'latest.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

for (const input of [
  el.searchInput,
  el.networkFilter,
  el.dataFilter,
  el.usageFilter,
  el.activationFilter,
  el.carrierFilter,
  el.minPrice,
  el.maxPrice,
  el.sortKey,
]) {
  const evt = input.tagName === 'INPUT' ? 'input' : 'change';
  input.addEventListener(evt, () => {
    state.currentPage = 1;
    updateDashboard();
  });
}

el.refreshBtn.addEventListener('click', triggerReload);
el.prevPage.addEventListener('click', () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  renderTable();
});
el.nextPage.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
  state.currentPage = Math.min(totalPages, state.currentPage + 1);
  renderTable();
});
el.downloadExcelBtn.addEventListener('click', downloadCsv);

triggerReload();
