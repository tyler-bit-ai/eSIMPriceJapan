(function attachExchangeRateUtils(root, factory) {
  const utils = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = utils;
  }
  if (root) {
    root.ExchangeRateUtils = utils;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildExchangeRateUtils() {
  const PAIR = 'JPY/KRW';
  const SOURCE = 'Frankfurter (ECB reference)';
  const ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=JPY&symbols=KRW';
  const CACHE_KEY = 'esim.dashboard.exchange-rate.jpy-krw.v1';
  const FRESH_TTL_MS = 12 * 60 * 60 * 1000;
  const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function roundCurrency(value) {
    const n = toFiniteNumber(value);
    return n === null ? null : Math.round(n);
  }

  function convertJpyToKrw(jpy, rate) {
    const price = toFiniteNumber(jpy);
    const fx = toFiniteNumber(rate);
    if (price === null || fx === null || price <= 0 || fx <= 0) return null;
    return Math.round(price * fx);
  }

  function summarizeNumbers(values) {
    const filtered = values.map(toFiniteNumber).filter((value) => value !== null);
    if (!filtered.length) {
      return { min: null, max: null, avg: null, median: null };
    }
    const sorted = [...filtered].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sum / sorted.length),
      median,
    };
  }

  function buildExchangeRateMeta(meta) {
    return {
      pair: PAIR,
      rate: toFiniteNumber(meta && meta.rate),
      source: (meta && meta.source) || SOURCE,
      updatedAt: (meta && meta.updatedAt) || null,
      fetchedAt: (meta && meta.fetchedAt) || null,
      stale: Boolean(meta && meta.stale),
      unavailable: Boolean(meta && meta.unavailable),
      error: (meta && meta.error) || null,
      url: (meta && meta.url) || ENDPOINT,
    };
  }

  function parseFrankfurterPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid exchange rate payload');
    }
    const rate = toFiniteNumber(payload.rates && payload.rates.KRW);
    if (rate === null || rate <= 0) {
      throw new Error('KRW rate missing in payload');
    }
    return buildExchangeRateMeta({
      rate,
      updatedAt: typeof payload.date === 'string' ? payload.date : null,
      fetchedAt: new Date().toISOString(),
      stale: false,
      unavailable: false,
    });
  }

  function readCache(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return buildExchangeRateMeta(parsed);
    } catch (_) {
      return null;
    }
  }

  function writeCache(storage, meta) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(buildExchangeRateMeta(meta)));
    } catch (_) {
      // Ignore storage quota or serialization failures.
    }
  }

  function isFresh(meta, ttlMs) {
    if (!meta || !meta.fetchedAt) return false;
    const fetchedAtMs = Date.parse(meta.fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) return false;
    return (Date.now() - fetchedAtMs) <= ttlMs;
  }

  function isStaleUsable(meta) {
    if (!meta || !meta.fetchedAt) return false;
    const fetchedAtMs = Date.parse(meta.fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) return false;
    return (Date.now() - fetchedAtMs) <= STALE_TTL_MS;
  }

  async function fetchExchangeRate(fetchImpl, options) {
    const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const storage = options && options.storage ? options.storage : null;
    const cached = readCache(storage);
    if (cached && isFresh(cached, FRESH_TTL_MS)) {
      return buildExchangeRateMeta({ ...cached, stale: false, unavailable: false });
    }

    if (!fetchFn) {
      if (cached && isStaleUsable(cached)) {
        return buildExchangeRateMeta({ ...cached, stale: true, unavailable: false, error: 'fetch_unavailable' });
      }
      return buildExchangeRateMeta({ stale: true, unavailable: true, error: 'fetch_unavailable' });
    }

    try {
      const response = await fetchFn(ENDPOINT, { cache: 'no-store' });
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response ? response.status : 'unknown'}`);
      }
      const payload = await response.json();
      const meta = parseFrankfurterPayload(payload);
      writeCache(storage, meta);
      return meta;
    } catch (error) {
      if (cached && isStaleUsable(cached)) {
        return buildExchangeRateMeta({
          ...cached,
          stale: true,
          unavailable: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return buildExchangeRateMeta({
        stale: true,
        unavailable: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function attachKrwPrices(items, exchangeRateMeta) {
    const rate = exchangeRateMeta && !exchangeRateMeta.unavailable ? exchangeRateMeta.rate : null;
    return (items || []).map((item) => ({
      ...item,
      price_krw: convertJpyToKrw(item.price_jpy, rate),
    }));
  }

  function formatExchangeRateStatus(meta) {
    if (!meta || meta.unavailable || !meta.rate) {
      return 'KRW 환산 unavailable';
    }
    const staleSuffix = meta.stale ? ' (cached)' : '';
    return `1 JPY = ${meta.rate.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} KRW${staleSuffix}`;
  }

  return {
    PAIR,
    SOURCE,
    ENDPOINT,
    CACHE_KEY,
    FRESH_TTL_MS,
    convertJpyToKrw,
    summarizeNumbers,
    buildExchangeRateMeta,
    parseFrankfurterPayload,
    fetchExchangeRate,
    attachKrwPrices,
    formatExchangeRateStatus,
    roundCurrency,
  };
}));
