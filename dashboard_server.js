const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const xlsx = require('xlsx');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const ROOT = __dirname;
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const DATA_DIR = path.join(DASHBOARD_DIR, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

function readJsonFile(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

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
  const parsedPrice = Number(raw.price_jpy);
  return {
    site: raw.site || null,
    title: raw.title || '',
    product_url: typeof raw.product_url === 'string' ? raw.product_url : null,
    price_jpy: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null,
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

function keepDashboardItem(item) {
  return Number.isFinite(item.price_jpy) && item.price_jpy > 0;
}

function getLatestResultsFile() {
  const dirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^out_/i.test(d.name))
    .map((d) => {
      const fullDir = path.join(ROOT, d.name);
      const fullPath = path.join(fullDir, 'results.jsonl');
      if (!fs.existsSync(fullPath)) return null;
      const stat = fs.statSync(fullPath);
      return {
        dir: d.name,
        fullPath,
        file: path.join(d.name, 'results.jsonl'),
        mtimeMs: stat.mtimeMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return dirs[0] || null;
}

function summarize(items) {
  const prices = items.map((it) => it.price_jpy).filter((n) => Number.isFinite(n));
  const sorted = [...prices].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  const roamingCount = items.filter((it) => it.network_type === 'roaming').length;
  const localCount = items.filter((it) => it.network_type === 'local').length;
  const unlimitedCount = items.filter((it) => String(it.data_amount || '').toLowerCase() === 'unlimited').length;

  const carrierTrue = {
    skt: items.filter((it) => it.carrier_support_kr.skt).length,
    kt: items.filter((it) => it.carrier_support_kr.kt).length,
    lgu: items.filter((it) => it.carrier_support_kr.lgu).length,
  };
  const reviewValues = items.map((it) => it.review_count).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const reviewMedian =
    reviewValues.length === 0
      ? null
      : reviewValues.length % 2 === 1
        ? reviewValues[(reviewValues.length - 1) / 2]
        : Math.round((reviewValues[reviewValues.length / 2 - 1] + reviewValues[reviewValues.length / 2]) / 2);
  const badgeCounts = {};
  for (const it of items) {
    if (!it.seller_badge) continue;
    badgeCounts[it.seller_badge] = (badgeCounts[it.seller_badge] || 0) + 1;
  }
  const salesKnownCount = items.filter((it) => Number.isFinite(it.monthly_sold_count)).length;
  const bestsellerBadgeCount = items.filter((it) => it.is_bestseller === true).length;
  const bestsellerRankKnownCount = items.filter((it) => Number.isFinite(it.bestseller_rank)).length;
  const reviewKnownCount = reviewValues.length;
  const top10Count = items.filter((it) => Number.isFinite(it.search_position) && it.search_position <= 10).length;

  const byDataAmount = {};
  const byUsageValidity = {};
  const byActivationValidity = {};

  for (const it of items) {
    const d = it.data_amount || 'unknown';
    const u = it.usage_validity || 'unknown';
    const a = it.activation_validity || 'unknown';
    byDataAmount[d] = (byDataAmount[d] || 0) + 1;
    byUsageValidity[u] = (byUsageValidity[u] || 0) + 1;
    byActivationValidity[a] = (byActivationValidity[a] || 0) + 1;
  }

  return {
    total: items.length,
    priceMin: sorted.length ? sorted[0] : null,
    priceMax: sorted.length ? sorted[sorted.length - 1] : null,
    priceAvg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    priceMedian: median,
    roamingCount,
    localCount,
    unlimitedCount,
    carrierTrue,
    reviewKnownCount,
    reviewMedian,
    badgeCounts,
    top10Count,
    salesKnownCount,
    bestsellerBadgeCount,
    bestsellerRankKnownCount,
    byDataAmount,
    byUsageValidity,
    byActivationValidity,
  };
}

function makeExportFilename(site) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${site || 'market'}_esim_filtered_${ts}.xlsx`;
}

function sendExcel(res, items, site) {
  const isQoo10 = site === 'qoo10_jp';
  const rows = items.map((it) => {
    const base = {
      site: it.site || site || '',
      title: it.title || '',
      price_jpy: it.price_jpy ?? '',
      network_type: it.network_type || '',
      data_amount: it.data_amount || '',
      usage_validity: it.usage_validity || '',
      activation_validity: it.activation_validity || '',
      carrier_support_kr: [it.carrier_support_kr.skt ? 'SKT' : '', it.carrier_support_kr.kt ? 'KT' : '', it.carrier_support_kr.lgu ? 'LGU+' : '']
        .filter(Boolean)
        .join(', '),
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

  const headers = isQoo10
    ? [
        'site',
        'title',
        'price_jpy',
        'review_count',
        'seller_badge',
        'search_position',
        'network_type',
        'data_amount',
        'usage_validity',
        'activation_validity',
        'carrier_support_kr',
        'seller',
        'asin',
        'site_product_id',
      ]
    : [
        'site',
        'title',
        'price_jpy',
        'review_count',
        'monthly_sold_count',
        'is_bestseller',
        'bestseller_rank',
        'network_type',
        'data_amount',
        'usage_validity',
        'activation_validity',
        'carrier_support_kr',
        'seller',
        'brand',
        'asin',
        'site_product_id',
      ];

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows, { header: headers });
  xlsx.utils.book_append_sheet(workbook, worksheet, 'filtered');

  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const filename = makeExportFilename(site);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

function normalizeIndexShape(indexObj) {
  const raw = indexObj && typeof indexObj === 'object' ? indexObj : {};
  const latest = raw.latest && !Array.isArray(raw.latest) ? raw.latest : {};
  const runs = Array.isArray(raw.runs) ? raw.runs : [];

  if (latest.csv || latest.jsonl) {
    return {
      latest: {
        amazon_jp: { ...latest, site: 'amazon_jp' },
      },
      runs: runs.map((run) => ({ ...run, site: run.site || 'amazon_jp' })),
    };
  }

  const normalizedLatest = {};
  for (const [site, record] of Object.entries(latest)) {
    if (record && typeof record === 'object') {
      normalizedLatest[site] = { ...record, site: record.site || site };
    }
  }

  return {
    latest: normalizedLatest,
    runs: runs.map((run) => ({ ...run, site: run.site || 'amazon_jp' })),
  };
}

function readIndexData() {
  if (fs.existsSync(INDEX_PATH)) {
    try {
      const raw = readJsonFile(INDEX_PATH);
      return normalizeIndexShape(raw);
    } catch (_) {
      // fallback below
    }
  }

  const latest = getLatestResultsFile();
  if (!latest) {
    return { latest: {}, runs: [] };
  }

  return {
    latest: {
      amazon_jp: {
        site: 'amazon_jp',
        csv: latest.file.replace(/results\.jsonl$/i, 'results.csv').replaceAll('\\', '/'),
        jsonl: latest.file.replaceAll('\\', '/'),
        metadata: null,
        source: latest.file,
        crawled_at: new Date(latest.mtimeMs).toISOString(),
        published_at: null,
        item_count: null,
      },
    },
    runs: [],
  };
}

function resolveRepoPath(relPath) {
  if (!relPath) return null;
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(DATA_DIR, relPath.replace(/^\.\//, ''));
}

function getDatasetRecord(indexData, site, datasetId) {
  if (datasetId) {
    const run = indexData.runs.find((entry) => String(entry.id) === String(datasetId) && (entry.site || 'amazon_jp') === site);
    if (run) return run;
  }
  return indexData.latest[site] || null;
}

function readDataset(record) {
  if (!record || !record.jsonl) {
    return {
      found: false,
      message: 'No dataset found for selected site.',
      file: null,
      generatedAt: null,
      items: [],
      summary: summarize([]),
      record: null,
    };
  }

  const jsonlPath = resolveRepoPath(record.jsonl);
  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    return {
      found: false,
      message: `Dataset file not found: ${record.jsonl}`,
      file: record.jsonl,
      generatedAt: record.crawled_at || null,
      items: [],
      summary: summarize([]),
      record,
    };
  }

  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const items = parseJsonl(raw).map(normalizeItem).filter(keepDashboardItem);
  return {
    found: true,
    file: record.source || record.jsonl,
    generatedAt: record.crawled_at || new Date(fs.statSync(jsonlPath).mtimeMs).toISOString(),
    items,
    summary: summarize(items),
    record,
  };
}

function readLatestData(site = 'amazon_jp', datasetId = null) {
  const indexData = readIndexData();
  const record = getDatasetRecord(indexData, site, datasetId);
  const data = readDataset(record);
  return {
    ...data,
    index: indexData,
  };
}

function applyFilters(items, queryObj) {
  const q = String(queryObj.q || '').trim().toLowerCase();
  const network = String(queryObj.network || '').trim();
  const dataAmount = String(queryObj.dataAmount || '').trim();
  const usage = String(queryObj.usage || '').trim();
  const activation = String(queryObj.activation || '').trim();
  const carrier = String(queryObj.carrier || '').trim();
  const minPrice = queryObj.minPrice ? Number(queryObj.minPrice) : null;
  const maxPrice = queryObj.maxPrice ? Number(queryObj.maxPrice) : null;
  const sort = String(queryObj.sort || 'priceAsc').trim();

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
    const bag = [it.title, it.seller, it.brand, it.seller_badge, it.network_type, it.data_amount, it.usage_validity, it.activation_validity]
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
  } else if (sort === 'reviewDesc') {
    filtered.sort((a, b) => {
      const aReviews = Number.isFinite(a.review_count) ? a.review_count : -1;
      const bReviews = Number.isFinite(b.review_count) ? b.review_count : -1;
      if (bReviews !== aReviews) return bReviews - aReviews;
      return (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER);
    });
  } else if (sort === 'positionAsc') {
    filtered.sort((a, b) => {
      const aPos = Number.isFinite(a.search_position) ? a.search_position : Number.MAX_SAFE_INTEGER;
      const bPos = Number.isFinite(b.search_position) ? b.search_position : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER);
    });
  } else if (sort === 'usageAsc') {
    filtered.sort((a, b) => (a.usage_days ?? Number.MAX_SAFE_INTEGER) - (b.usage_days ?? Number.MAX_SAFE_INTEGER));
  } else {
    filtered.sort((a, b) => (a.price_jpy ?? Number.MAX_SAFE_INTEGER) - (b.price_jpy ?? Number.MAX_SAFE_INTEGER));
  }

  return filtered;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function createServer() {
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/api/index') {
      sendJson(res, 200, readIndexData());
      return;
    }

    if (parsedUrl.pathname === '/api/latest') {
      const site = String(parsedUrl.query.site || 'amazon_jp');
      const dataset = parsedUrl.query.dataset ? String(parsedUrl.query.dataset) : null;
      const data = readLatestData(site, dataset);
      if (!data.found) {
        sendJson(res, 200, data);
        return;
      }

      const filtered = applyFilters(data.items, parsedUrl.query || {});
      sendJson(res, 200, {
        found: true,
        file: data.file,
        generatedAt: data.generatedAt,
        items: filtered,
        summary: summarize(filtered),
        totalBeforeFilter: data.items.length,
        site,
        dataset,
      });
      return;
    }

    if (parsedUrl.pathname === '/api/export.xlsx') {
      const site = String(parsedUrl.query.site || 'amazon_jp');
      const dataset = parsedUrl.query.dataset ? String(parsedUrl.query.dataset) : null;
      const data = readLatestData(site, dataset);
      if (!data.found) {
        sendJson(res, 404, { message: data.message || 'No data found.' });
        return;
      }
      const filtered = applyFilters(data.items, parsedUrl.query || {});
      sendExcel(res, filtered, site);
      return;
    }

    const requestPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    const safePath = requestPath.replace(/^\/+/, '');
    const fullPath = path.join(DASHBOARD_DIR, safePath);

    if (!fullPath.startsWith(DASHBOARD_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = mime[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(fullPath).pipe(res);
  });
}

function startServer(port = PORT) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`[dashboard] http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  parseJsonl,
  summarize,
  readLatestData,
  readIndexData,
  applyFilters,
  createServer,
  startServer,
};
