const pageSize = 20;
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
  return out.length ? out.join(', ') : 'unknown';
}

function toQuery() {
  const params = new URLSearchParams();
  const q = el.searchInput.value.trim();
  if (q) params.set('q', q);
  if (el.networkFilter.value) params.set('network', el.networkFilter.value);
  if (el.dataFilter.value) params.set('dataAmount', el.dataFilter.value);
  if (el.usageFilter.value) params.set('usage', el.usageFilter.value);
  if (el.activationFilter.value) params.set('activation', el.activationFilter.value);
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
    ['로밍 / 로컬', `${roamingPct}% / ${localPct}%`],
    ['무제한 비중', `${unlimitedPct}%`],
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
  const activationOptions = unique(items.map((it) => it.activation_validity));

  const keep = {
    network: el.networkFilter.value,
    data: el.dataFilter.value,
    usage: el.usageFilter.value,
    activation: el.activationFilter.value,
  };

  el.networkFilter.innerHTML = '<option value="">네트워크 전체</option>' + networkOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.dataFilter.innerHTML = '<option value="">데이터 전체</option>' + dataOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.usageFilter.innerHTML = '<option value="">사용기간 전체</option>' + usageOptions.map((v) => `<option>${safe(v)}</option>`).join('');
  el.activationFilter.innerHTML = '<option value="">활성화기간 전체</option>' + activationOptions.map((v) => `<option>${safe(v)}</option>`).join('');

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

async function loadData() {
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
    renderBars(el.activationBars, {});
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
  renderBars(el.activationBars, summary.byActivation);
  renderTable();
}

function triggerReload() {
  loadData().catch((err) => {
    el.metaText.textContent = `로드 실패: ${err.message}`;
  });
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
  input.addEventListener(evt, triggerReload);
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
el.downloadExcelBtn.addEventListener('click', downloadFilteredExcel);

triggerReload();
