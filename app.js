/* Smart Money Terminal — live public-market data + GMGN snapshot tabs. */
"use strict";

const GT = "https://api.geckoterminal.com/api/v2";
const DS = "https://api.dexscreener.com";
const CG = "https://api.coingecko.com/api/v3";
const SMART_JSON = "data/smart-money.json";

const INTERVAL = {
  majors: 60_000,
  trending: 60_000,
  newPools: 60_000,
  boosts: 60_000,
  trades: 12_000,
  candles: 45_000,
  smartMoney: 5 * 60_000,
  watchlist: 60_000,
};

const MAJORS_SPEC = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "hyperliquid", symbol: "HYPE" },
  { id: "binancecoin", symbol: "BNB" },
  { id: "ripple", symbol: "XRP" },
  { id: "dogecoin", symbol: "DOGE" },
  { id: "zcash", symbol: "ZEC" },
  { id: "sui", symbol: "SUI" },
  { id: "chainlink", symbol: "LINK" },
];

const NAV = [
  { id: "alerts", label: "Live Alerts", kind: "snap" },
  { id: "terminal", label: "Terminal", kind: "live" },
  { id: "accumulation", label: "Accumulation", kind: "snap" },
  { id: "flow", label: "Flow", kind: "live" },
  { id: "watchlist", label: "Watchlist", kind: "live" },
  { id: "kol", label: "KOL Signals", kind: "snap" },
  { id: "nansen", label: "Nansen Scan", kind: "snap" },
  { id: "fib", label: "Fib Levels", kind: "live" },
  { id: "custom", label: "Custom Alerts", kind: "live" },
];

const MOBILE_TABS = [
  { id: "trending", label: "Trending" },
  { id: "alerts", label: "Alerts" },
  { id: "accumulation", label: "Accum." },
  { id: "charts", label: "Charts" },
  { id: "watchlist", label: "Watch" },
];

const TF = {
  m1: { label: "1m", path: "minute", aggregate: 1 },
  m5: { label: "5m", path: "minute", aggregate: 5 },
  m15: { label: "15m", path: "minute", aggregate: 15 },
  h1: { label: "1H", path: "hour", aggregate: 1 },
  h4: { label: "4H", path: "hour", aggregate: 4 },
};

const GT_NET = {
  solana: "solana", ethereum: "eth", eth: "eth", bsc: "bsc",
  base: "base", arbitrum: "arbitrum", polygon: "polygon_pos",
  avalanche: "avax", optimism: "optimism",
};
const GMGN_CHAIN = { solana: "sol", ethereum: "eth", eth: "eth", bsc: "bsc", base: "base" };
const LS_WATCH = "smt-watchlist-v1";
const LS_ALERTS = "smt-alerts-v1";

const state = {
  nav: "terminal",
  mobileTab: "trending",
  listTab: "trending",
  majors: [], majorsAt: null, majorsErr: null,
  trending: [], trendingAt: null, trendingErr: null,
  newPools: [], newPoolsAt: null, newPoolsErr: null,
  boosts: [], boostsAt: null, boostsErr: null, boostPrices: {},
  selected: null,
  candles: [], candlesAt: null, candlesErr: null,
  trades: [], tradesAt: null, tradesErr: null,
  tf: "m15",
  smart: null, smartAt: null, smartFetchedAt: null, smartErr: null,
  watchlist: loadJson(LS_WATCH, []),
  watchData: {}, watchAt: null,
  customAlerts: loadJson(LS_ALERTS, []),
  firedAlerts: {},
  searchQ: "", searchResults: [], searchErr: null, searchAt: null,
  expanded: {},
  rateLimitedUntil: 0,
  caInput: "",
  alertDraft: { condition: "above", price: "" },
};

let chart = null, candleSeries = null, volSeries = null, chartHost = null;
let chartFittedFor = "";
let mq = window.matchMedia("(max-width: 768px)");
let pollers = [];
let tokenAbort = null;
let searchTimer = null;

function isMobile() { return mq.matches; }

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

let backoffUntil = 0;
let backoffMs = 2000;

async function fetchJson(url, { signal, timeout = 20000, cacheBust = false } = {}) {
  if (Date.now() < backoffUntil) {
    const err = new Error("Backing off after a 429");
    err.code = "BACKOFF";
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  const finalUrl = cacheBust ? url + (url.includes("?") ? "&" : "?") + "_=" + Date.now() : url;
  try {
    const res = await fetch(finalUrl, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (res.status === 429) {
      const ra = res.headers.get("Retry-After");
      const wait = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : Math.min(backoffMs * 2, 120000);
      backoffMs = Math.min(Math.max(wait, 8000), 120000);
      backoffUntil = Date.now() + backoffMs;
      state.rateLimitedUntil = backoffUntil;
      const err = new Error("Rate limited (429); backing off");
      err.code = "429";
      throw err;
    }
    if (!res.ok) {
      const err = new Error("HTTP " + res.status);
      err.code = res.status;
      throw err;
    }
    backoffMs = 2000;
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function trimNum(v) {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  const s = v.toFixed(2);
  return s.replace(/\.?0+$/, "") || s;
}
function subNum(n) {
  const map = ["₀","₁","₂","₃","₄","₅","₆","₇","₈","₉"];
  return String(n).split("").map((ch) => map[Number(ch)] ?? ch).join("");
}
function formatUsd(n, kind) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const v = Math.abs(n);
  if (kind === "size" || v >= 1000) {
    if (v >= 1e9) return sign + "$" + trimNum(v / 1e9) + "B";
    if (v >= 1e6) return sign + "$" + trimNum(v / 1e6) + "M";
    if (v >= 1e3) return sign + "$" + trimNum(v / 1e3) + "K";
    return sign + "$" + v.toFixed(2);
  }
  if (v >= 100) return sign + "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return sign + "$" + v.toFixed(v >= 10 ? 2 : 4);
  if (v >= 0.01) return sign + "$" + v.toFixed(5);
  if (v === 0) return "$0";
  const exp = Math.floor(Math.log10(v));
  if (exp <= -5) {
    const zeros = -exp - 1;
    const lead = Math.round(v * Math.pow(10, -exp) * 100) / 100;
    if (zeros >= 2 && zeros <= 12) {
      const tail = String(lead).replace(".", "").replace(/^0+/, "") || "0";
      return sign + "$0.0" + subNum(zeros) + tail;
    }
  }
  return sign + "$" + v.toPrecision(4).replace(/e-/, "e−");
}
function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    const body = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "");
    return sign + body + "K%";
  }
  return sign + abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2) + "%";
}
function formatHolders(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) {
    const k = n / 1000;
    return k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "") + "K";
  }
  return n.toLocaleString("en-US");
}
function formatSignedUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + formatUsd(Math.abs(n), "size");
}
function pctClass(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "up" : "down";
}
function shortCa(address) {
  if (!address) return "—";
  if (address.length <= 10) return address;
  return address.slice(0, 4) + "…" + address.slice(-4);
}
function formatET(date, withSeconds) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
  if (withSeconds) opts.second = "2-digit";
  return new Intl.DateTimeFormat("en-US", opts).format(d) + " ET";
}
function formatEtClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(d) + " ET";
}
function formatAge(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
function ratio(buys, sells) {
  if (buys == null || sells == null) return null;
  if (sells === 0) return buys > 0 ? Infinity : null;
  return buys / sells;
}
function formatRatio(buys, sells) {
  const r = ratio(buys, sells);
  if (r == null) return "—";
  if (!Number.isFinite(r)) return "∞";
  return r.toFixed(r >= 10 ? 1 : 2) + "×";
}
function chainLabel(network) {
  if (!network) return "";
  if (network === "solana") return "Solana";
  if (network === "ethereum" || network === "eth") return "Ethereum";
  if (network === "bsc") return "BSC";
  return network.charAt(0).toUpperCase() + network.slice(1);
}
function dsUrl(network, address) {
  const c = network === "eth" ? "ethereum" : network;
  return "https://dexscreener.com/" + c + "/" + address;
}
function gmgnUrl(network, address) {
  const c = GMGN_CHAIN[network] || (network === "solana" ? "sol" : network);
  return c && address ? "https://gmgn.ai/" + c + "/token/" + address : "";
}
function gtUrl(network, pool) {
  const net = GT_NET[network] || network;
  return pool ? "https://www.geckoterminal.com/" + net + "/pools/" + pool : "";
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function toast(msg) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied " + shortCa(text)); }
  catch { toast("Could not copy"); }
}

function mapTx(tx) {
  const out = {};
  if (!tx) return out;
  for (const k of Object.keys(tx)) {
    const w = tx[k] || {};
    out[k] = { buys: num(w.buys) ?? 0, sells: num(w.sells) ?? 0, buyers: num(w.buyers) ?? 0, sellers: num(w.sellers) ?? 0 };
  }
  return out;
}
function mapInc(included) {
  const m = {};
  for (const x of included || []) m[x.id] = x;
  return m;
}
function poolToToken(pool, included) {
  const a = pool.attributes || {};
  const inc = mapInc(included);
  const baseRel = pool.relationships?.base_token?.data;
  const quoteRel = pool.relationships?.quote_token?.data;
  const base = baseRel && inc[baseRel.id];
  const quote = quoteRel && inc[quoteRel.id];
  const network = String(pool.id || "solana").split("_")[0] || "solana";
  const address = base?.attributes?.address || "";
  const chg = a.price_change_percentage || {};
  const vol = a.volume_usd || {};
  const name = base?.attributes?.name || String(a.name || "").split(" / ")[0] || "";
  const symbol = (base?.attributes?.symbol || String(a.name || "").split(" / ")[0] || "").toUpperCase();
  return {
    id: network + ":" + (address || a.address),
    network, chainLabel: chainLabel(network), pool: a.address,
    dex: pool.relationships?.dex?.data?.id || "",
    createdAt: a.pool_created_at || null,
    address, name, symbol,
    quoteSymbol: (quote?.attributes?.symbol || "").toUpperCase(),
    price: num(a.base_token_price_usd),
    mc: num(a.market_cap_usd), fdv: num(a.fdv_usd), liquidity: num(a.reserve_in_usd),
    chg: { m5: num(chg.m5), m15: num(chg.m15), h1: num(chg.h1), h6: num(chg.h6), h24: num(chg.h24) },
    tx: mapTx(a.transactions),
    vol: { m5: num(vol.m5), m15: num(vol.m15), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    image: base?.attributes?.image_url || null,
    source: "live",
  };
}
function dsPairToToken(p) {
  if (!p) return null;
  const network = p.chainId || "solana";
  const address = p.baseToken?.address || "";
  const tx = p.txns || {};
  const mappedTx = {};
  for (const k of Object.keys(tx)) {
    mappedTx[k] = { buys: num(tx[k]?.buys) ?? 0, sells: num(tx[k]?.sells) ?? 0, buyers: null, sellers: null };
  }
  const chg = p.priceChange || {};
  const vol = p.volume || {};
  return {
    id: network + ":" + address, network, chainLabel: chainLabel(network),
    pool: p.pairAddress, dex: p.dexId || "",
    createdAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    address, name: p.baseToken?.name || "", symbol: (p.baseToken?.symbol || "").toUpperCase(),
    quoteSymbol: (p.quoteToken?.symbol || "").toUpperCase(),
    price: num(p.priceUsd), mc: num(p.marketCap), fdv: num(p.fdv), liquidity: num(p.liquidity?.usd),
    chg: { m5: num(chg.m5), h1: num(chg.h1), h6: num(chg.h6), h24: num(chg.h24) },
    tx: mappedTx, vol: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    image: p.info?.imageUrl || null, source: "live",
  };
}
function pickBestPair(pairs) {
  if (!pairs || !pairs.length) return null;
  return pairs.slice().sort((a, b) => (num(b.liquidity?.usd) || num(b.volume?.h24) || 0) - (num(a.liquidity?.usd) || num(a.volume?.h24) || 0))[0];
}
function gmgnToToken(row) {
  return {
    id: (row.chain || "solana") + ":" + row.address,
    network: row.chain || "solana", chainLabel: chainLabel(row.chain || "solana"),
    pool: "", dex: "", createdAt: null, address: row.address, name: row.name, symbol: row.symbol,
    quoteSymbol: "SOL", price: num(row.price), mc: num(row.mc), fdv: num(row.mc), liquidity: null,
    chg: { h1: num(row.chg1h) }, tx: {}, vol: { h1: num(row.vol1h) }, image: null,
    holders: row.holders == null ? null : num(row.holders),
    insiderPct: row.insiderPct == null ? null : num(row.insiderPct),
    top10Pct: row.top10Pct == null ? null : num(row.top10Pct),
    sniperPct: row.sniperPct == null ? null : num(row.sniperPct),
    smartWalletCount: row.smartWalletCount == null ? null : num(row.smartWalletCount),
    kolCount: row.kolCount == null ? null : num(row.kolCount),
    source: "snapshot",
  };
}

function riskNotes(coin) {
  const notes = [];
  if (coin.insiderPct != null && coin.insiderPct >= 10) notes.push("Insider " + trimNum(coin.insiderPct) + "%");
  if (coin.top10Pct != null && coin.top10Pct >= 30) notes.push("Top 10 " + trimNum(coin.top10Pct) + "%");
  if (coin.sniperPct != null && coin.sniperPct >= 10) notes.push("Snipers " + trimNum(coin.sniperPct) + "%");
  return notes;
}
function snapshotCoins() { return (state.smart?.trending || []).map(gmgnToToken); }
function isDuplicateTicker(coin, list) {
  const src = list || snapshotCoins();
  return src.filter((c) => c.symbol === coin.symbol).length > 1;
}
function flowTokenKeys(coin) { return [coin.symbol, coin.name].filter(Boolean).map((s) => s.toLowerCase()); }
function smartFlows() { return state.smart?.smartFlows || []; }
function flowsFor(coin) {
  const keys = flowTokenKeys(coin);
  return smartFlows().filter((f) => {
    const token = String(f.token || "").toLowerCase();
    if (keys.includes(token)) return true;
    if (token === "maxcoin" && (keys.includes("max") || keys.includes("maxcoin"))) return true;
    return false;
  });
}
function coinsForFlowToken(token) {
  const key = String(token || "").toLowerCase();
  return snapshotCoins().filter((c) => {
    const keys = flowTokenKeys(c);
    return keys.includes(key) || (key === "maxcoin" && (keys.includes("max") || keys.includes("maxcoin")));
  });
}
function earlyAccFor(coin) {
  const flows = flowsFor(coin);
  const firstBuys = flows.filter((f) => f.action === "First Buy");
  const buyMore = flows.filter((f) => f.action === "Buy More");
  if (firstBuys.length === 0 && buyMore.length === 0) {
    return { value: "—", detail: "No smart First Buy or Buy More for this token in the GMGN Smart Net Inflow snapshot." };
  }
  const bits = [];
  if (firstBuys.length) bits.push(firstBuys.length + " First Buy" + (firstBuys.length === 1 ? "" : "s") + " (" + firstBuys.map((f) => formatSignedUsd(f.usd)).join(", ") + ")");
  if (buyMore.length) bits.push(buyMore.map((f) => formatSignedUsd(f.usd) + " Buy More").join(", "));
  let detail = bits.join("; ") + " in the GMGN Smart Net Inflow snapshot.";
  if (coin.symbol === "Sakura" || coin.name === "Sakura") {
    detail += " The feed did not include a contract address; two Sakura tickers are on the 1h trending list.";
  }
  const headline = firstBuys.length >= 2 ? firstBuys.length + " First Buys"
    : firstBuys.length === 1 ? "First Buy"
    : buyMore.length ? "Buy More " + formatSignedUsd(buyMore[0].usd) : "—";
  return { value: headline, detail };
}
function accumulationFromFlows() {
  const byToken = new Map();
  for (const f of smartFlows()) {
    if (f.action !== "First Buy" && f.action !== "Buy More") continue;
    const list = byToken.get(f.token) || [];
    list.push(f);
    byToken.set(f.token, list);
  }
  const preferred = ["Sakura", "Maxcoin"];
  const tokens = [...preferred.filter((t) => byToken.has(t)), ...[...byToken.keys()].filter((t) => !preferred.includes(t))];
  return tokens.map((token) => {
    const flows = byToken.get(token) || [];
    const first = flows.filter((f) => f.action === "First Buy");
    const more = flows.filter((f) => f.action === "Buy More");
    const parts = [];
    if (first.length) parts.push(first.length + " First Buy" + (first.length === 1 ? "" : "s") + " (" + first.map((f) => formatSignedUsd(f.usd)).join(", ") + ")");
    if (more.length) parts.push(more.map((f) => formatSignedUsd(f.usd) + " Buy More").join(", "));
    let summary = parts.join("; ");
    if (token === "Sakura") summary += ". Feed had no CA; two Sakura tickers are on the trending list.";
    return { token, summary, coins: coinsForFlowToken(token) };
  });
}
function countOrDash(v) { return v == null || !Number.isFinite(v) ? "—" : String(v); }
function fibFromCandles(rows) {
  if (!rows || rows.length < 2) return [];
  const high = Math.max(...rows.map((r) => r.high));
  const low = Math.min(...rows.map((r) => r.low));
  const range = high - low;
  if (!(range > 0)) return [];
  return [
    { label: "0% (swing high)", ratio: 0 },
    { label: "23.6%", ratio: 0.236 },
    { label: "38.2%", ratio: 0.382 },
    { label: "50%", ratio: 0.5 },
    { label: "61.8%", ratio: 0.618 },
    { label: "78.6%", ratio: 0.786 },
    { label: "100% (swing low)", ratio: 1 },
  ].map((m) => ({ ...m, price: high - range * m.ratio }));
}

async function loadMajors() {
  const ids = MAJORS_SPEC.map((m) => m.id).join(",");
  try {
    const data = await fetchJson(CG + "/simple/price?ids=" + ids + "&vs_currencies=usd&include_24hr_change=true");
    state.majors = MAJORS_SPEC.map((m) => ({
      symbol: m.symbol, price: num(data?.[m.id]?.usd), chg24: num(data?.[m.id]?.usd_24h_change),
    }));
    state.majorsAt = new Date();
    state.majorsErr = null;
    renderTicker(); renderStatus();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.majorsErr = e.message;
    renderTicker(); renderStatus();
  }
}

async function loadTrending() {
  try {
    const data = await fetchJson(GT + "/networks/solana/trending_pools?include=base_token,quote_token,dex");
    state.trending = (data.data || []).map((p) => poolToToken(p, data.included)).filter((t) => t.address);
    state.trendingAt = new Date();
    state.trendingErr = null;
    const firstPick = !state.selected && state.trending[0];
    if (firstPick) {
      await selectToken(state.trending[0]);
    } else {
      maybeRefreshSelectedFromList(state.trending);
      if (!softRefreshLiveLists()) {
        if (["alerts", "accumulation", "flow"].includes(state.nav) || (isMobile() && state.mobileTab === "alerts")) renderWorkspace();
      }
    }
    renderStatus();
    checkCustomAlerts(state.trending);
  } catch (e) {
    if (e.name === "AbortError") return;
    state.trendingErr = e.message;
    renderWorkspace(); renderStatus();
  }
}

async function loadNewPools() {
  try {
    const data = await fetchJson(GT + "/networks/solana/new_pools?include=base_token,quote_token,dex");
    state.newPools = (data.data || []).map((p) => poolToToken(p, data.included)).filter((t) => t.address);
    state.newPoolsAt = new Date();
    state.newPoolsErr = null;
    if (state.listTab === "new" && !softRefreshLiveLists() && onLiveTerminal()) renderWorkspace();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.newPoolsErr = e.message;
    if (state.listTab === "new" && onLiveTerminal()) renderWorkspace();
  }
}

async function loadBoosts() {
  try {
    const data = await fetchJson(DS + "/token-boosts/latest/v1");
    const list = Array.isArray(data) ? data : [];
    state.boosts = list;
    state.boostsAt = new Date();
    state.boostsErr = null;
    const sol = list.filter((b) => b.chainId === "solana").slice(0, 20);
    if (sol.length) {
      const addrs = sol.map((b) => b.tokenAddress).join(",");
      try {
        const pairs = await fetchJson(DS + "/tokens/v1/solana/" + addrs);
        const arr = Array.isArray(pairs) ? pairs : [];
        const byAddr = {};
        for (const p of arr) {
          const a = p.baseToken?.address;
          if (!a) continue;
          const cur = byAddr[a];
          if (!cur || (num(p.liquidity?.usd) || 0) > (num(cur.liquidity?.usd) || 0)) byAddr[a] = p;
        }
        state.boostPrices = byAddr;
      } catch { /* prices optional */ }
    }
    if (state.listTab === "boosted" && !softRefreshLiveLists() && onLiveTerminal()) renderWorkspace();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.boostsErr = e.message;
    if (state.listTab === "boosted" && onLiveTerminal()) renderWorkspace();
  }
}

async function loadSmartMoney() {
  try {
    const data = await fetchJson(SMART_JSON, { cacheBust: true });
    if (!data || typeof data !== "object") throw new Error("Invalid smart-money.json");
    state.smart = data;
    state.smartAt = data.asOfET || data.asOfISO || null;
    state.smartFetchedAt = new Date();
    state.smartErr = null;
    renderStatus();
    if (state.listTab === "smart" && softRefreshLiveLists()) { /* list only */ }
    else if (["alerts", "accumulation", "kol", "nansen"].includes(state.nav) || (isMobile() && ["alerts", "accumulation"].includes(state.mobileTab))) {
      renderWorkspace();
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    state.smartErr = e.message;
    renderStatus(); renderWorkspace();
  }
}

async function loadWatchlist() {
  if (!state.watchlist.length) {
    state.watchData = {};
    state.watchAt = new Date();
    if (state.nav === "watchlist" || state.mobileTab === "watchlist") renderWorkspace();
    return;
  }
  const byChain = {};
  for (const w of state.watchlist) {
    const c = w.chain || "solana";
    (byChain[c] || (byChain[c] = [])).push(w.address);
  }
  const next = { ...state.watchData };
  try {
    for (const [chain, addrs] of Object.entries(byChain)) {
      const pairs = await fetchJson(DS + "/tokens/v1/" + chain + "/" + addrs.join(","));
      const arr = Array.isArray(pairs) ? pairs : [];
      const grouped = {};
      for (const p of arr) {
        const a = p.baseToken?.address;
        if (!a) continue;
        (grouped[a] || (grouped[a] = [])).push(p);
      }
      for (const [addr, ps] of Object.entries(grouped)) {
        const tok = dsPairToToken(pickBestPair(ps));
        if (tok) next[chain + ":" + addr] = tok;
      }
    }
    state.watchData = next;
    state.watchAt = new Date();
    checkCustomAlerts(Object.values(next));
    if (state.nav === "watchlist" || state.mobileTab === "watchlist" || state.nav === "custom") renderWorkspace();
  } catch (e) {
    if (e.name === "AbortError") return;
  }
}

function maybeRefreshSelectedFromList(list) {
  if (!state.selected) return;
  const found = list.find((t) => t.id === state.selected.id);
  if (found) state.selected = { ...state.selected, ...found, source: found.source || state.selected.source };
}

function onLiveTerminal() {
  if (isMobile()) return state.mobileTab === "trending" || state.mobileTab === "charts";
  return state.nav === "terminal";
}

function softRefreshLiveLists() {
  const list = document.getElementById("token-list");
  if (!list || !onLiveTerminal()) return false;
  const updated = document.getElementById("list-updated");
  if (updated) updated.textContent = listUpdated();
  clear(list);
  list.append(tokenListBody());
  const stats = document.getElementById("chart-stats");
  if (stats && state.selected) { clear(stats); stats.append(chartStats(state.selected)); }
  return true;
}

async function selectToken(token, { skipRender } = {}) {
  if (!token) return;
  const same = state.selected && state.selected.id === token.id && state.selected.pool === token.pool;
  state.selected = token;
  if (!same) {
    state.candles = []; state.trades = [];
    state.candlesAt = null; state.tradesAt = null;
    state.candlesErr = null; state.tradesErr = null;
    chartFittedFor = "";
    if (tokenAbort) tokenAbort.abort();
    tokenAbort = new AbortController();
  }
  if (!skipRender) renderWorkspace();
  await Promise.all([loadCandles(tokenAbort?.signal), loadTrades(tokenAbort?.signal)]);
}

async function resolveAndSelect(chain, address) {
  try {
    const pairs = await fetchJson(DS + "/tokens/v1/" + chain + "/" + address);
    const arr = Array.isArray(pairs) ? pairs : [];
    const tok = dsPairToToken(pickBestPair(arr));
    if (!tok) { toast("No pool found for that contract"); return; }
    await selectToken(tok);
    if (isMobile()) { state.mobileTab = "charts"; state.nav = "terminal"; }
    else { state.nav = "terminal"; }
    renderNav(); renderMobileTabs(); renderWorkspace();
  } catch (e) {
    toast("Lookup failed: " + (e.message || e));
  }
}

async function loadCandles(signal) {
  const tok = state.selected;
  if (!tok || !tok.pool) {
    state.candlesErr = tok ? "No pool address for this token yet." : null;
    updateChartPanel();
    return;
  }
  const net = GT_NET[tok.network] || tok.network || "solana";
  const spec = TF[state.tf] || TF.m15;
  const url = GT + "/networks/" + net + "/pools/" + tok.pool + "/ohlcv/" + spec.path +
    "?aggregate=" + spec.aggregate + "&limit=100&currency=usd";
  try {
    const data = await fetchJson(url, { signal });
    const raw = data?.data?.attributes?.ohlcv_list || [];
    const rows = raw
      .map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }))
      .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.open) && Number.isFinite(r.close))
      .sort((a, b) => a.time - b.time);
    const dedup = [];
    for (const r of rows) {
      if (dedup.length && dedup[dedup.length - 1].time === r.time) dedup[dedup.length - 1] = r;
      else dedup.push(r);
    }
    state.candles = dedup;
    state.candlesAt = new Date();
    state.candlesErr = null;
    updateChartPanel();
    if (state.nav === "fib") renderWorkspace();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.candlesErr = e.message;
    updateChartPanel();
  }
}

async function loadTrades(signal) {
  const tok = state.selected;
  if (!tok || !tok.pool) {
    state.tradesErr = tok ? "No pool address for this token yet." : null;
    updateTradesPanel();
    return;
  }
  const net = GT_NET[tok.network] || tok.network || "solana";
  const url = GT + "/networks/" + net + "/pools/" + tok.pool + "/trades?trade_volume_in_usd_greater_than=1";
  try {
    const data = await fetchJson(url, { signal });
    const rows = (data.data || []).map((t) => {
      const a = t.attributes || {};
      return {
        t: a.block_timestamp,
        side: a.kind === "buy" || a.kind === "sell" ? a.kind : "buy",
        usd: num(a.volume_in_usd),
        price: num(a.price_to_in_usd) || num(a.price_from_in_usd),
        tx: a.tx_hash,
      };
    });
    state.trades = rows.slice(0, 50);
    state.tradesAt = new Date();
    state.tradesErr = null;
    updateTradesPanel();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.tradesErr = e.message;
    updateTradesPanel();
  }
}

async function runSearch(q) {
  const query = q.trim();
  if (query.length < 2) {
    state.searchResults = []; state.searchErr = null;
    renderWorkspace();
    return;
  }
  try {
    const data = await fetchJson(DS + "/latest/dex/search?q=" + encodeURIComponent(query));
    state.searchResults = (data.pairs || []).slice(0, 20).map(dsPairToToken).filter(Boolean);
    state.searchAt = new Date();
    state.searchErr = null;
    renderWorkspace();
  } catch (e) {
    state.searchErr = e.message;
    renderWorkspace();
  }
}

function destroyChart() {
  if (chart) { try { chart.remove(); } catch { /* gone */ } }
  chart = null; candleSeries = null; volSeries = null; chartHost = null;
}
function ensureChart(el) {
  if (!el || !window.LightweightCharts) return false;
  if (chart && chartHost === el && el.isConnected) {
    try { chart.resize(el.clientWidth, Math.max(el.clientHeight, 200)); } catch { /* */ }
    return true;
  }
  destroyChart();
  if (el.clientWidth < 20) return false;
  const L = window.LightweightCharts;
  chartHost = el;
  chart = L.createChart(el, {
    width: el.clientWidth, height: Math.max(el.clientHeight, 280),
    layout: { background: { color: "#0e1218" }, textColor: "#8b97a8", fontFamily: "IBM Plex Mono, monospace" },
    grid: { vertLines: { color: "#1a222d" }, horzLines: { color: "#1a222d" } },
    rightPriceScale: { borderColor: "#232c38" },
    timeScale: { borderColor: "#232c38", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: "#22c55e", downColor: "#f43f5e",
    borderUpColor: "#22c55e", borderDownColor: "#f43f5e",
    wickUpColor: "#22c55e", wickDownColor: "#f43f5e",
  });
  volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  if (!el._ro) {
    el._ro = new ResizeObserver(() => {
      if (chart && el.isConnected) chart.resize(el.clientWidth, Math.max(el.clientHeight, 200));
    });
    el._ro.observe(el);
  }
  return true;
}
function paintChart() {
  const el = document.getElementById("chart-el");
  const empty = document.getElementById("chart-empty");
  if (!el) return;
  if (!state.candles.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = state.candlesErr || (state.selected ? "Loading candles…" : "Select a token to load its live chart.");
    }
    return;
  }
  if (empty) empty.hidden = true;
  if (!ensureChart(el)) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Chart library did not load. Candle data is still in the fib panel.";
    }
    return;
  }
  candleSeries.setData(state.candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  volSeries.setData(state.candles.map((c) => ({
    time: c.time, value: c.volume || 0,
    color: c.close >= c.open ? "rgba(34,197,94,0.4)" : "rgba(244,63,94,0.4)",
  })));
  const fitKey = (state.selected?.id || "") + ":" + state.tf;
  if (chartFittedFor !== fitKey) {
    chart.timeScale().fitContent();
    chartFittedFor = fitKey;
  }
}
function updateChartPanel() {
  const updated = document.getElementById("chart-updated");
  if (updated) updated.textContent = stamp("LIVE", state.candlesAt, state.candlesErr);
  if (document.getElementById("chart-el")) paintChart();
  const stats = document.getElementById("chart-stats");
  if (stats && state.selected) { clear(stats); stats.append(chartStats(state.selected)); }
}
function updateTradesPanel() {
  const body = document.getElementById("trades-body");
  const updated = document.getElementById("trades-updated");
  if (updated) updated.textContent = stamp("LIVE", state.tradesAt, state.tradesErr);
  if (!body) return;
  clear(body);
  body.append(tradesTable());
}
function stamp(kind, at, err) {
  const bits = [];
  if (kind) bits.push(kind);
  if (at) bits.push("updated " + formatEtClock(at));
  if (err) bits.push("error: " + err);
  if (state.rateLimitedUntil > Date.now()) bits.push("backing off until " + formatEtClock(new Date(state.rateLimitedUntil)));
  return bits.join(" · ");
}

function renderAll() {
  renderNav(); renderMobileTabs(); renderTicker(); renderStatus(); renderWorkspace();
}

function goNav(id) {
  state.nav = id;
  if (id === "terminal") state.mobileTab = "trending";
  else if (id === "alerts") state.mobileTab = "alerts";
  else if (id === "accumulation") state.mobileTab = "accumulation";
  else if (id === "watchlist") state.mobileTab = "watchlist";
  else if (id === "fib") state.mobileTab = "charts";
  renderAll();
}

function renderNav() {
  const nav = document.getElementById("side-nav");
  clear(nav);
  for (const item of NAV) {
    nav.append(h("button", {
      class: "nav-btn" + (state.nav === item.id ? " active" : ""),
      type: "button",
      onclick: () => goNav(item.id),
    }, item.label, h("span", { class: "tag" + (item.kind === "live" ? " live" : "") }, item.kind === "live" ? "Live" : "Snapshot")));
  }
}

function renderMobileTabs() {
  const nav = document.getElementById("mobile-tabs");
  clear(nav);
  for (const item of MOBILE_TABS) {
    nav.append(h("button", {
      class: state.mobileTab === item.id ? "active" : "",
      type: "button",
      onclick: () => {
        state.mobileTab = item.id;
        if (item.id === "trending") { state.nav = "terminal"; state.listTab = "trending"; }
        else if (item.id === "alerts") state.nav = "alerts";
        else if (item.id === "accumulation") state.nav = "accumulation";
        else if (item.id === "charts") state.nav = "terminal";
        else if (item.id === "watchlist") state.nav = "watchlist";
        renderAll();
      },
    }, item.label));
  }
}

function renderTicker() {
  const el = document.getElementById("ticker");
  clear(el);
  if (!state.majors.length && state.majorsErr) {
    el.append(h("div", { class: "ticker-item" }, "Majors unavailable: " + state.majorsErr));
  }
  for (const m of state.majors) {
    el.append(h("div", { class: "ticker-item" },
      h("span", { class: "sym", text: m.symbol }),
      h("span", { class: "px mono", text: formatUsd(m.price) }),
      h("span", { class: "chg mono " + pctClass(m.chg24), text: formatPct(m.chg24) })
    ));
  }
  el.append(h("div", { class: "ticker-meta" },
    h("span", { class: "live-pill" }, h("span", { class: "pulse" }), " LIVE"),
    h("span", { text: state.majorsAt ? "CoinGecko · " + formatEtClock(state.majorsAt) : "CoinGecko · loading…" })
  ));
  const ml = document.getElementById("mobile-live");
  if (ml) ml.hidden = false;
}

function renderStatus() {
  const el = document.getElementById("status-bar");
  clear(el);
  el.append(h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE prices, charts & trades"));
  const asOf = state.smart?.asOfET || state.smartAt;
  el.append(h("span", { class: "pill snap", text: asOf ? "GMGN smart-money snapshot as of " + asOf : (state.smartErr ? "Smart-money file: " + state.smartErr : "Loading smart-money snapshot…") }));
  const nansenOn = state.smart?.nansenConnected === true;
  el.append(h("span", { class: "pill " + (nansenOn ? "live" : "warn"), text: nansenOn ? "Nansen connected" : "Nansen Scan not connected" }));
  if (state.rateLimitedUntil > Date.now()) {
    el.append(h("span", { class: "pill danger", text: "API backoff until " + formatEtClock(new Date(state.rateLimitedUntil)) }));
  }
}

function currentList() {
  if (state.listTab === "new") return state.newPools;
  if (state.listTab === "boosted") {
    return state.boosts.filter((b) => b.chainId === "solana").slice(0, 25).map((b) => {
      const p = state.boostPrices[b.tokenAddress];
      const tok = p ? dsPairToToken(p) : {
        id: (b.chainId || "solana") + ":" + b.tokenAddress,
        network: b.chainId || "solana", chainLabel: chainLabel(b.chainId || "solana"),
        pool: "", address: b.tokenAddress, name: "", symbol: shortCa(b.tokenAddress),
        price: null, mc: null, fdv: null, liquidity: null, chg: {}, tx: {}, vol: {}, source: "live",
      };
      tok.boostAmount = b.amount;
      tok.description = b.description || "";
      return tok;
    });
  }
  if (state.listTab === "smart") return snapshotCoins();
  return state.trending;
}
function listUpdated() {
  if (state.listTab === "new") return stamp("LIVE", state.newPoolsAt, state.newPoolsErr);
  if (state.listTab === "boosted") return stamp("LIVE", state.boostsAt, state.boostsErr);
  if (state.listTab === "smart") return "SNAPSHOT as of " + (state.smart?.asOfET || "—");
  return stamp("LIVE", state.trendingAt, state.trendingErr);
}
function listNote() {
  if (state.listTab === "trending") return "GeckoTerminal Solana trending pools, refreshed about every 60s. Click a row to load its live chart and trades.";
  if (state.listTab === "new") return "GeckoTerminal Solana new pools, refreshed about every 60s. These are freshly created pools, not a smart-money signal.";
  if (state.listTab === "boosted") return "DexScreener latest token boosts (Solana). Boost amount is paid promotion, not organic flow. Prices from DexScreener when available.";
  return "GMGN Solana Trending 1h captured at " + (state.smart?.asOfET || "—") + ". Prices and holder-risk figures are from that snapshot, not live. Duplicate tickers (SolanaOS, Sakura) have different CAs and are likely copycats. Smart-wallet and KOL counts: — (not shown in the capture).";
}

function renderWorkspace() {
  const ws = document.getElementById("workspace");
  const mobile = isMobile();
  const tab = state.mobileTab;
  let view = state.nav;
  if (mobile) {
    if (tab === "trending") view = "m-trending";
    else if (tab === "charts") view = "charts";
    else view = tab === "watchlist" ? "watchlist" : tab;
  }
  const scrollTop = ws.scrollTop;
  clear(ws);
  destroyChart();

  if (view === "terminal" || view === "charts" || view === "m-trending") ws.append(renderTerminal(view));
  else if (view === "alerts") ws.append(renderAlerts());
  else if (view === "accumulation") ws.append(renderAccumulation());
  else if (view === "flow") ws.append(renderFlow());
  else if (view === "watchlist") ws.append(renderWatchlist());
  else if (view === "kol") ws.append(renderKol());
  else if (view === "nansen") ws.append(renderNansen());
  else if (view === "fib") ws.append(renderFib());
  else if (view === "custom") ws.append(renderCustom());

  requestAnimationFrame(() => {
    paintChart();
    ws.scrollTop = view === "terminal" ? 0 : scrollTop;
  });
}

function renderTerminal(view) {
  const wrap = h("div", { class: "terminal-grid" });
  const hideList = view === "charts";
  const hideChart = view === "m-trending";
  if (!hideList) wrap.append(renderListPanel());
  if (!hideChart) {
    wrap.append(renderChartPanel());
    wrap.append(renderScorePanel());
    wrap.append(renderTradesPanel());
  }
  return wrap;
}

function renderListPanel() {
  const panel = h("div", { class: "panel list-panel" });
  const tabs = ["trending", "new", "boosted", "smart"];
  const labels = { trending: "Trending", new: "New", boosted: "Boosted", smart: "Smart $" };
  const seg = h("div", { class: "seg" });
  for (const t of tabs) {
    seg.append(h("button", {
      class: state.listTab === t ? "active" : "",
      type: "button",
      onclick: () => {
        state.listTab = t;
        if (t === "new" && !state.newPools.length) loadNewPools();
        if (t === "boosted" && !state.boosts.length) loadBoosts();
        renderWorkspace();
      },
    }, labels[t]));
  }
  panel.append(
    h("div", { class: "panel-head" },
      h("h2", { text: "Tokens" }), seg,
      h("span", { class: "panel-updated", id: "list-updated", text: listUpdated() })
    ),
    h("div", { class: "panel-note", text: listNote() }),
    searchRow(),
    h("div", { class: "panel-body", id: "token-list" }, tokenListBody())
  );
  return panel;
}

function searchRow() {
  const row = h("div", { class: "search-row" });
  const input = h("input", {
    type: "search", placeholder: "Search name or paste a CA",
    value: state.searchQ, autocomplete: "off", spellcheck: "false",
  });
  input.addEventListener("input", (e) => {
    state.searchQ = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(state.searchQ), 400);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      const q = state.searchQ.trim();
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) || /^0x[a-fA-F0-9]{40}$/.test(q)) {
        resolveAndSelect(q.startsWith("0x") ? "ethereum" : "solana", q);
      } else runSearch(q);
    }
  });
  row.append(input, h("button", { type: "button", onclick: () => runSearch(state.searchQ) }, "Search"));
  return row;
}

function tokenListBody() {
  const box = h("div");
  if (state.searchQ.trim().length >= 2) {
    box.append(h("div", { class: "panel-note", text: state.searchErr ? "Search error: " + state.searchErr : "DexScreener search results" + (state.searchAt ? " · " + formatEtClock(state.searchAt) : "") }));
    if (!state.searchResults.length && !state.searchErr) box.append(h("div", { class: "empty", text: "No pairs matched." }));
    for (const c of state.searchResults) box.append(coinRow(c, { tab: "trending" }));
    box.append(h("div", { class: "panel-note", text: "List below" }));
  }
  const list = currentList();
  const err = state.listTab === "trending" ? state.trendingErr
    : state.listTab === "new" ? state.newPoolsErr
    : state.listTab === "boosted" ? state.boostsErr
    : state.smartErr;
  if (!list.length) box.append(h("div", { class: "empty", text: err || "Loading…" }));
  for (const c of list) box.append(isMobile() && state.mobileTab === "trending" ? tokenCard(c) : coinRow(c, { tab: state.listTab }));
  return box;
}

function coinRow(coin, { tab }) {
  const selected = state.selected && state.selected.id === coin.id;
  const chg = coin.chg?.h1 ?? coin.chg?.h24 ?? coin.chg?.m15 ?? coin.chg?.m5;
  const risks = riskNotes(coin);
  let sub = "";
  if (tab === "new") {
    sub = "Opened " + formatAge(coin.createdAt) + " ago · Liq " + formatUsd(coin.liquidity, "size") + " · 5m " + formatPct(coin.chg?.m5);
  } else if (tab === "boosted") {
    sub = (coin.boostAmount != null ? "Boost " + coin.boostAmount : "Boosted") + (coin.vol?.h24 != null ? " · 24h vol " + formatUsd(coin.vol.h24, "size") : "");
  } else if (tab === "smart") {
    const bits = [
      "1h " + formatPct(coin.chg?.h1), "Vol " + formatUsd(coin.vol?.h1, "size"),
      formatHolders(coin.holders) + " holders",
      "Insider " + (coin.insiderPct == null ? "—" : trimNum(coin.insiderPct) + "%"),
      "Top 10 " + (coin.top10Pct == null ? "—" : trimNum(coin.top10Pct) + "%"),
      "Snipers " + (coin.sniperPct == null ? "—" : trimNum(coin.sniperPct) + "%"),
      "Smart wallets " + countOrDash(coin.smartWalletCount),
      "KOL " + countOrDash(coin.kolCount),
    ];
    if (isDuplicateTicker(coin)) bits.push("CA " + shortCa(coin.address) + " · possible copycat ticker");
    if (risks.length) bits.push("Risk: " + risks.join(", "));
    sub = bits.join(" · ");
  } else {
    const w = coin.tx?.h1;
    const flow = w ? formatRatio(w.buys, w.sells) + " buy/sell · " + (w.buys ?? 0).toLocaleString("en-US") + " buys / " + (w.sells ?? 0).toLocaleString("en-US") + " sells" : "";
    sub = [flow, "Vol " + formatUsd(coin.vol?.h1, "size"), coin.dex, coin.quoteSymbol ? "quoted in " + coin.quoteSymbol : ""].filter(Boolean).join(" · ");
  }
  const row = h("div", {
    class: "coin-row" + (selected ? " selected" : ""),
    role: "button", tabindex: "0",
    onclick: () => onPickCoin(coin),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPickCoin(coin); } },
  });
  const name = h("div", { class: "name-row" },
    h("span", { class: "sym accent", text: coin.symbol || "—" }),
    h("span", { class: "chip", text: coin.chainLabel || "" })
  );
  if (isDuplicateTicker(coin) || tab === "smart") name.append(h("span", { class: "chip", text: shortCa(coin.address) }));
  if (risks.length) name.append(h("span", { class: "chip risk", text: risks[0] }));
  row.append(
    h("div", {}, name, h("div", { class: "sub", text: sub })),
    h("div", { class: "right" },
      h("div", { class: "mono", text: formatUsd(coin.price) }),
      h("div", { class: "mono " + pctClass(chg), text: formatPct(chg) }),
      h("div", { class: "mono", style: { fontSize: "11px", color: "var(--text-mute)" }, text: "MC " + formatUsd(coin.mc ?? coin.fdv, "size") })
    )
  );
  return row;
}

function tokenCard(coin) {
  const open = !!state.expanded[coin.id];
  const chg = coin.chg?.h1 ?? coin.chg?.h24;
  const risks = riskNotes(coin);
  const card = h("div", { class: "token-card" + (open ? " open" : ""), onclick: () => { state.expanded[coin.id] = !open; renderWorkspace(); } });
  card.append(h("div", { class: "top" },
    h("div", {},
      h("div", { class: "name-row" },
        h("span", { class: "sym", text: coin.symbol }),
        h("span", { class: "chip", text: coin.chainLabel }),
        risks[0] ? h("span", { class: "chip risk", text: risks[0] }) : null
      ),
      h("div", { class: "sub", text: coin.name })
    ),
    h("div", { class: "right" },
      h("div", { class: "mono", text: formatUsd(coin.price) }),
      h("div", { class: "mono " + pctClass(chg), text: formatPct(chg) })
    )
  ));
  if (open) {
    const snap = coin.source === "snapshot";
    const body = h("div", { class: "expand-body" });
    if (snap) {
      body.append(
        h("div", { class: "stat-row" },
          statChip("Holders", formatHolders(coin.holders)),
          statChip("Insider", coin.insiderPct == null ? "—" : trimNum(coin.insiderPct) + "%"),
          statChip("Top 10", coin.top10Pct == null ? "—" : trimNum(coin.top10Pct) + "%"),
          statChip("Snipers", coin.sniperPct == null ? "—" : trimNum(coin.sniperPct) + "%"),
          statChip("Smart wallets", countOrDash(coin.smartWalletCount)),
          statChip("KOL", countOrDash(coin.kolCount))
        ),
        h("div", { class: "ca", text: coin.address })
      );
    } else {
      const w = coin.tx?.h1 || {};
      body.append(
        h("div", { class: "stat-row" },
          statChip("MC", formatUsd(coin.mc ?? coin.fdv, "size")),
          statChip("Liq", formatUsd(coin.liquidity, "size")),
          statChip("1h vol", formatUsd(coin.vol?.h1, "size")),
          statChip("1h buy/sell", formatRatio(w.buys, w.sells)),
          statChip("5m", formatPct(coin.chg?.m5)),
          statChip("24h", formatPct(coin.chg?.h24))
        ),
        h("div", { class: "ca", text: coin.address })
      );
    }
    const acts = h("div", { class: "actions" });
    acts.append(h("button", { class: "btn sm", type: "button", onclick: (e) => { e.stopPropagation(); copyText(coin.address); } }, "Copy CA"));
    acts.append(h("button", { class: "btn sm primary", type: "button", onclick: (e) => {
      e.stopPropagation(); onPickCoin(coin);
      if (isMobile()) { state.mobileTab = "charts"; state.nav = "terminal"; renderAll(); }
    } }, "Live chart"));
    const g = gmgnUrl(coin.network, coin.address);
    if (g) acts.append(h("a", { class: "btn sm", href: g, target: "_blank", rel: "noreferrer", onclick: (e) => e.stopPropagation() }, "GMGN"));
    acts.append(h("a", { class: "btn sm", href: dsUrl(coin.network, coin.address), target: "_blank", rel: "noreferrer", onclick: (e) => e.stopPropagation() }, "DexScreener"));
    if (coin.pool) acts.append(h("a", { class: "btn sm", href: gtUrl(coin.network, coin.pool), target: "_blank", rel: "noreferrer", onclick: (e) => e.stopPropagation() }, "GeckoTerminal"));
    body.append(acts);
    if (snap) body.append(h("div", { class: "sub", style: { marginTop: "8px" }, text: "Holder-risk figures are from the GMGN snapshot as of " + (state.smart?.asOfET || "—") + ", not live." }));
    card.append(body);
  }
  return card;
}
function statChip(k, v) { return h("span", { class: "chip" }, k + " " + v); }

function onPickCoin(coin) {
  if (coin.source === "snapshot" && !coin.pool) {
    resolveAndSelect(coin.network || "solana", coin.address);
    return;
  }
  selectToken(coin);
}

function renderChartPanel() {
  const tok = state.selected;
  const panel = h("div", { class: "panel chart-panel" });
  panel.append(h("div", { class: "panel-head" },
    h("h2", { text: "Chart" }),
    h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
    h("span", { class: "panel-updated", id: "chart-updated", text: stamp("LIVE", state.candlesAt, state.candlesErr) })
  ));
  if (!tok) {
    panel.append(h("div", { class: "chart-empty", text: "Select a token from the list." }));
    return panel;
  }
  const title = h("div", { class: "chart-header" },
    h("div", { class: "chart-title" },
      h("a", { class: "sym", href: gmgnUrl(tok.network, tok.address) || dsUrl(tok.network, tok.address), target: "_blank", rel: "noreferrer", text: tok.symbol }),
      h("span", { class: "nm", text: tok.name }),
      h("span", { class: "chip", text: tok.chainLabel }),
      h("span", { class: "chip", text: shortCa(tok.address) })
    )
  );
  title.append(h("div", { class: "chart-stats", id: "chart-stats" }, chartStats(tok)));
  const tools = h("div", { class: "chart-tools" });
  const tfSeg = h("div", { class: "seg" });
  for (const [k, v] of Object.entries(TF)) {
    tfSeg.append(h("button", {
      class: state.tf === k ? "active" : "", type: "button",
      onclick: () => {
        state.tf = k; chartFittedFor = "";
        renderWorkspace();
        if (tokenAbort) tokenAbort.abort();
        tokenAbort = new AbortController();
        loadCandles(tokenAbort.signal);
      },
    }, v.label));
  }
  tools.append(tfSeg);
  tools.append(h("button", { class: "btn sm", type: "button", onclick: () => copyText(tok.address) }, "Copy CA"));
  tools.append(watchBtn(tok));
  if (tok.pool) tools.append(h("a", { class: "btn sm", href: gtUrl(tok.network, tok.pool), target: "_blank", rel: "noreferrer" }, "GeckoTerminal"));
  tools.append(h("a", { class: "btn sm", href: dsUrl(tok.network, tok.address), target: "_blank", rel: "noreferrer" }, "DexScreener"));
  const g = gmgnUrl(tok.network, tok.address);
  if (g) tools.append(h("a", { class: "btn sm", href: g, target: "_blank", rel: "noreferrer" }, "GMGN"));
  panel.append(title, tools);
  panel.append(h("div", { id: "chart-el" }));
  panel.append(h("div", { class: "chart-empty", id: "chart-empty", hidden: state.candles.length ? true : false, text: state.candlesErr || "Loading candles…" }));
  return panel;
}
function chartStats(tok) {
  const frag = document.createDocumentFragment();
  const items = [
    ["Price", formatUsd(tok.price), pctClass(tok.chg?.h1)],
    ["1h", formatPct(tok.chg?.h1), pctClass(tok.chg?.h1)],
    ["24h", formatPct(tok.chg?.h24), pctClass(tok.chg?.h24)],
    ["MC", formatUsd(tok.mc ?? tok.fdv, "size"), ""],
    ["Liq", formatUsd(tok.liquidity, "size"), ""],
    ["1h vol", formatUsd(tok.vol?.h1, "size"), ""],
  ];
  for (const [k, v, cls] of items) {
    frag.append(h("span", {}, h("span", { class: "k", text: k }), h("span", { class: "mono " + cls, text: v })));
  }
  return frag;
}
function watchBtn(tok) {
  const id = (tok.network || "solana") + ":" + tok.address;
  const on = state.watchlist.some((w) => (w.chain + ":" + w.address) === id);
  return h("button", { class: "btn sm" + (on ? " primary" : ""), type: "button", onclick: () => toggleWatch(tok) }, on ? "Watching" : "Add to watchlist");
}
function toggleWatch(tok) {
  const chain = tok.network || "solana";
  const i = state.watchlist.findIndex((w) => w.chain === chain && w.address === tok.address);
  if (i >= 0) state.watchlist.splice(i, 1);
  else state.watchlist.push({ chain, address: tok.address, symbol: tok.symbol, name: tok.name, addedAt: new Date().toISOString() });
  saveJson(LS_WATCH, state.watchlist);
  loadWatchlist();
  renderWorkspace();
  toast(i >= 0 ? "Removed from watchlist" : "Added to watchlist");
}

function renderScorePanel() {
  const tok = state.selected;
  const panel = h("div", { class: "panel score-panel" });
  panel.append(h("div", { class: "panel-head" }, h("h2", { text: "Setup" }), h("span", { class: "panel-updated", text: tok?.source === "snapshot" ? "snapshot figures" : "live public flow" })));
  if (!tok) { panel.append(h("div", { class: "empty", text: "—" })); return panel; }
  const acc = earlyAccFor(tok);
  const w = tok.tx?.h1 || {};
  const has = (w.buys || 0) + (w.sells || 0) > 0;
  const grid = h("div", { class: "score-grid" });
  grid.append(scoreCard("Early accumulation", acc.value, acc.detail + " As of " + (state.smart?.asOfET || "—") + "."));
  grid.append(scoreCard("Smart-money wallets", countOrDash(tok.smartWalletCount), "GMGN did not show smart-wallet counts in the capture. This is not a count of zero. As of " + (state.smart?.asOfET || "—") + "."));
  grid.append(scoreCard(
    "Buy/sell ratio (1h)",
    has ? formatRatio(w.buys, w.sells) : "—",
    has
      ? (w.buys ?? 0).toLocaleString("en-US") + " buys / " + (w.sells ?? 0).toLocaleString("en-US") + " sells"
        + (w.buyers != null ? " · " + w.buyers.toLocaleString("en-US") + " buyers / " + (w.sellers ?? 0).toLocaleString("en-US") + " sellers" : "")
        + " · live public flow, not labeled smart money"
      : "No public 1h flow on this token yet."
  ));
  grid.append(scoreCard("Volume", formatUsd(tok.vol?.h1, "size"), "1h · 24h " + formatUsd(tok.vol?.h24, "size") + " · Liq " + formatUsd(tok.liquidity, "size")));
  panel.append(grid);
  return panel;
}
function scoreCard(k, v, d) {
  return h("div", { class: "score-card" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), h("div", { class: "d", text: d }));
}

function renderTradesPanel() {
  const panel = h("div", { class: "panel trades-panel" });
  panel.append(
    h("div", { class: "panel-head" },
      h("h2", { text: "Trades" }),
      h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
      h("span", { class: "panel-updated", id: "trades-updated", text: stamp("LIVE", state.tradesAt, state.tradesErr) })
    ),
    h("div", { class: "panel-note", text: "GeckoTerminal pool trades, refreshed about every 12s. Public tape — not labeled as smart-money wallets." }),
    h("div", { class: "panel-body", id: "trades-body" }, tradesTable())
  );
  return panel;
}
function tradesTable() {
  if (state.tradesErr && !state.trades.length) return h("div", { class: "err", text: state.tradesErr });
  if (!state.trades.length) return h("div", { class: "empty", text: state.selected ? "Waiting for trades…" : "Select a token." });
  const table = h("table", { class: "data" });
  table.append(h("thead", {}, h("tr", {}, h("th", { text: "Time" }), h("th", { text: "Side" }), h("th", { class: "num", text: "Size" }), h("th", { class: "num", text: "Price" }))));
  const tb = h("tbody");
  for (const t of state.trades) {
    tb.append(h("tr", {},
      h("td", { text: formatEtClock(t.t) }),
      h("td", { class: t.side === "buy" ? "side-buy" : "side-sell", text: t.side === "buy" ? "Buy" : "Sell" }),
      h("td", { class: "num", text: formatUsd(t.usd, "size") }),
      h("td", { class: "num", text: formatUsd(t.price) })
    ));
  }
  table.append(tb);
  return table;
}

function snapBanner() {
  return h("div", { class: "callout warn" },
    "This tab is a GMGN snapshot as of ",
    h("strong", { text: state.smart?.asOfET || "—" }),
    ", not a live feed. Smart-wallet and KOL counts were not on the captured page, so they are shown as — rather than guessed. Nansen Scan is not connected."
  );
}

function renderAlerts() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Live Alerts" }));
  wrap.append(h("p", { class: "page-lead", text: "Two tapes are shown separately: GMGN Smart Net Inflow from the snapshot, and live public-market movers from GeckoTerminal trending (not labeled smart money)." }));
  wrap.append(snapBanner());
  const snap = h("div", { class: "panel" });
  snap.append(
    h("div", { class: "panel-head" },
      h("h2", { text: "GMGN Smart Net Inflow" }),
      h("span", { class: "pill snap", text: "SNAPSHOT as of " + (state.smart?.asOfET || "—") })
    ),
    h("div", { class: "panel-note", text: "Ages are as GMGN showed them at capture (1s–28s then). They do not tick forward. Wallet and KOL counts were not on the page." })
  );
  const flows = smartFlows();
  if (!flows.length) snap.append(h("div", { class: "empty", text: state.smartErr || "No snapshot flow records." }));
  else {
    const table = h("table", { class: "data" });
    table.append(h("thead", {}, h("tr", {}, h("th", { text: "Wallet" }), h("th", { text: "Action" }), h("th", { text: "Token" }), h("th", { class: "num", text: "Net inflow" }), h("th", { class: "num", text: "Age" }))));
    const tb = h("tbody");
    for (const f of flows) {
      const matches = coinsForFlowToken(f.token);
      const tokenCell = h("td");
      if (matches.length === 1) tokenCell.append(h("a", { href: gmgnUrl(matches[0].network, matches[0].address), target: "_blank", rel: "noreferrer", text: f.token }));
      else tokenCell.textContent = f.token + (matches.length > 1 ? " (2 CAs)" : "");
      tb.append(h("tr", {},
        h("td", { class: "mono", text: f.wallet }),
        h("td", { text: f.action }),
        tokenCell,
        h("td", { class: "num " + pctClass(f.usd), text: formatSignedUsd(f.usd) }),
        h("td", { class: "num", text: f.age })
      ));
    }
    table.append(tb);
    snap.append(table);
  }
  wrap.append(snap);

  const live = h("div", { class: "panel" });
  live.append(
    h("div", { class: "panel-head" },
      h("h2", { text: "Public-market movers" }),
      h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
      h("span", { class: "panel-updated", text: stamp("LIVE", state.trendingAt, state.trendingErr) })
    ),
    h("div", { class: "panel-note", text: "From live GeckoTerminal trending: 1h move of at least 10%, 15m of at least 8%, 24h of at least 25%, or a 5m buy/sell ratio of at least 2.5× on 20 or more txs. This is public flow, not smart-money labels." })
  );
  const movers = liveMovers();
  if (!movers.length) live.append(h("div", { class: "empty", text: "No live movers currently meet those thresholds." }));
  else {
    const table = h("table", { class: "data" });
    table.append(h("thead", {}, h("tr", {}, h("th", { text: "Token" }), h("th", { class: "num", text: "Price" }), h("th", { class: "num", text: "1h" }), h("th", { text: "Why" }))));
    const tb = h("tbody");
    for (const m of movers) {
      const tr = h("tr", { style: { cursor: "pointer" }, onclick: () => { state.nav = "terminal"; if (isMobile()) state.mobileTab = "charts"; selectToken(m.coin); renderNav(); } });
      tr.append(
        h("td", {}, h("strong", { text: m.coin.symbol }), " ", h("span", { class: "sub", text: m.coin.name })),
        h("td", { class: "num", text: formatUsd(m.coin.price) }),
        h("td", { class: "num " + pctClass(m.coin.chg?.h1), text: formatPct(m.coin.chg?.h1) }),
        h("td", { text: m.why })
      );
      tb.append(tr);
    }
    table.append(tb);
    live.append(table);
  }
  wrap.append(live);
  const fired = Object.values(state.firedAlerts).filter(Boolean);
  if (fired.length) {
    const box = h("div", { class: "panel" });
    box.append(h("div", { class: "panel-head" }, h("h2", { text: "Your custom price alerts" }), h("span", { class: "pill live", text: "Local" })));
    for (const a of fired) box.append(h("div", { class: "callout info", text: a }));
    wrap.append(box);
  }
  return wrap;
}
function liveMovers() {
  const out = [];
  for (const coin of state.trending) {
    const reasons = [];
    const w5 = coin.tx?.m5 || {};
    const trades5 = (w5.buys || 0) + (w5.sells || 0);
    const r5 = ratio(w5.buys, w5.sells);
    if (coin.chg?.h1 != null && Math.abs(coin.chg.h1) >= 10) reasons.push("1h " + formatPct(coin.chg.h1));
    if (coin.chg?.m15 != null && Math.abs(coin.chg.m15) >= 8) reasons.push("15m " + formatPct(coin.chg.m15));
    if (coin.chg?.h24 != null && Math.abs(coin.chg.h24) >= 25) reasons.push("24h " + formatPct(coin.chg.h24));
    if (r5 != null && r5 >= 2.5 && trades5 >= 20) reasons.push("5m buy/sell " + formatRatio(w5.buys, w5.sells) + " on " + trades5 + " txs");
    if (reasons.length) out.push({ coin, why: reasons.join(" · "), change: coin.chg?.h1 ?? coin.chg?.m15 ?? coin.chg?.h24 ?? null });
  }
  out.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  return out;
}

function renderAccumulation() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Accumulation" }));
  wrap.append(h("p", { class: "page-lead", text: "Early accumulation from the GMGN Smart Net Inflow snapshot: tokens with a smart First Buy, plus Maxcoin’s $345.80 Buy More. This is the inflow tape, not a wallet-count or clustered-holder model. Smart-wallet counts were not shown and are left as —." }));
  wrap.append(snapBanner());
  const early = accumulationFromFlows();
  if (!early.length) wrap.append(h("div", { class: "empty", text: "No First Buy or Buy More prints in the snapshot." }));
  for (const row of early) {
    const card = h("div", { class: "acc-card" });
    card.append(h("div", { style: { fontWeight: "600", marginBottom: "4px" }, text: row.token }));
    card.append(h("div", { class: "sub", text: row.summary }));
    card.append(h("div", { class: "sub", text: "Smart-wallet count: — · KOL count: —" }));
    if (row.coins.length) {
      const acts = h("div", { class: "actions" });
      for (const c of row.coins) {
        acts.append(h("button", { class: "btn sm primary", type: "button", onclick: () => { onPickCoin(c); state.nav = "terminal"; if (isMobile()) state.mobileTab = "charts"; renderAll(); } }, "Chart " + c.symbol + " " + shortCa(c.address)));
        acts.append(h("a", { class: "btn sm", href: gmgnUrl(c.network, c.address), target: "_blank", rel: "noreferrer" }, "GMGN"));
      }
      if (row.coins.length > 1) acts.append(h("span", { class: "sub", text: "Two trending CAs" }));
      card.append(acts);
    }
    wrap.append(card);
  }
  const pub = state.trending.filter((c) => {
    const w = c.tx?.h1;
    if (!w) return false;
    const r = ratio(w.buys, w.sells);
    const n = (w.buys || 0) + (w.sells || 0);
    return r != null && r >= 1.15 && (w.buyers == null || w.buyers >= (w.sellers || 0)) && n >= 20;
  });
  const live = h("div", { class: "panel" });
  live.append(
    h("div", { class: "panel-head" },
      h("h2", { text: "Public 1h buy-side flow (not smart money)" }),
      h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
      h("span", { class: "panel-updated", text: stamp("LIVE", state.trendingAt, state.trendingErr) })
    ),
    h("div", { class: "panel-note", text: "Live GeckoTerminal trending pools whose 1h buy/sell ratio is at least 1.15×, with at least 20 txs. This is unlabeled public flow." })
  );
  if (!pub.length) live.append(h("div", { class: "empty", text: "No live pools currently meet that public-flow filter." }));
  else {
    const table = h("table", { class: "data" });
    table.append(h("thead", {}, h("tr", {}, h("th", { text: "Token" }), h("th", { class: "num", text: "1h buy/sell" }), h("th", { class: "num", text: "1h vol" }), h("th", { class: "num", text: "1h" }))));
    const tb = h("tbody");
    for (const c of pub) {
      const w = c.tx.h1;
      const tr = h("tr", { style: { cursor: "pointer" }, onclick: () => { state.nav = "terminal"; if (isMobile()) state.mobileTab = "charts"; selectToken(c); renderNav(); } });
      tr.append(
        h("td", {}, h("strong", { text: c.symbol }), " ", h("span", { class: "sub", text: c.name })),
        h("td", { class: "num", text: formatRatio(w.buys, w.sells) }),
        h("td", { class: "num", text: formatUsd(c.vol?.h1, "size") }),
        h("td", { class: "num " + pctClass(c.chg?.h1), text: formatPct(c.chg?.h1) })
      );
      tb.append(tr);
    }
    table.append(tb);
    live.append(table);
  }
  wrap.append(live);
  return wrap;
}

function renderFlow() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Flow" }));
  wrap.append(h("p", { class: "page-lead", text: "Live public buy and sell counts on GeckoTerminal Solana trending pools, refreshed about every 60s. This is not labeled smart-money flow. The GMGN Smart Net Inflow tape is on Live Alerts, as a snapshot." }));
  const panel = h("div", { class: "panel" });
  panel.append(h("div", { class: "panel-head" },
    h("h2", { text: "Trending pool flow" }),
    h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
    h("span", { class: "panel-updated", text: stamp("LIVE", state.trendingAt, state.trendingErr) })
  ));
  const table = h("table", { class: "data" });
  table.append(h("thead", {}, h("tr", {},
    h("th", { text: "Token" }), h("th", { class: "num", text: "5m B/S" }), h("th", { class: "num", text: "1h B/S" }),
    h("th", { class: "num", text: "1h ratio" }), h("th", { class: "num", text: "1h vol" }), h("th", { class: "num", text: "1h" })
  )));
  const tb = h("tbody");
  const rows = state.trending.slice().sort((a, b) => {
    const ra = ratio(a.tx?.h1?.buys, a.tx?.h1?.sells) || 0;
    const rb = ratio(b.tx?.h1?.buys, b.tx?.h1?.sells) || 0;
    return (Number.isFinite(rb) ? rb : 99) - (Number.isFinite(ra) ? ra : 99);
  });
  for (const c of rows) {
    const m5 = c.tx?.m5 || {};
    const h1w = c.tx?.h1 || {};
    const tr = h("tr", { style: { cursor: "pointer" }, onclick: () => { state.nav = "terminal"; selectToken(c); renderNav(); } });
    tr.append(
      h("td", {}, h("strong", { text: c.symbol }), " ", h("span", { class: "chip", text: c.dex || "" })),
      h("td", { class: "num", text: (m5.buys ?? "—") + " / " + (m5.sells ?? "—") }),
      h("td", { class: "num", text: (h1w.buys ?? "—") + " / " + (h1w.sells ?? "—") }),
      h("td", { class: "num", text: formatRatio(h1w.buys, h1w.sells) }),
      h("td", { class: "num", text: formatUsd(c.vol?.h1, "size") }),
      h("td", { class: "num " + pctClass(c.chg?.h1), text: formatPct(c.chg?.h1) })
    );
    tb.append(tr);
  }
  table.append(tb);
  panel.append(table);
  wrap.append(panel);
  return wrap;
}

function renderWatchlist() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Watchlist" }));
  wrap.append(h("p", { class: "page-lead", text: "Saved in this browser only (localStorage). Paste a Solana contract address, or an EVM 0x address. Prices refresh about every 60s from DexScreener." }));
  const form = h("div", { class: "watch-add" });
  const input = h("input", { type: "text", placeholder: "Paste a contract address", value: state.caInput, spellcheck: "false" });
  input.addEventListener("input", (e) => { state.caInput = e.target.value; });
  const add = () => {
    const q = state.caInput.trim();
    if (!q) return;
    const chain = q.startsWith("0x") ? "ethereum" : "solana";
    if (state.watchlist.some((w) => w.address === q && w.chain === chain)) { toast("Already on your watchlist"); return; }
    state.watchlist.push({ chain, address: q, symbol: shortCa(q), name: "", addedAt: new Date().toISOString() });
    saveJson(LS_WATCH, state.watchlist);
    state.caInput = "";
    loadWatchlist().then(() => renderWorkspace());
    resolveAndSelect(chain, q);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  form.append(input, h("button", { class: "btn primary", type: "button", onclick: add }, "Add"));
  wrap.append(form);
  wrap.append(h("div", { class: "panel-note", style: { border: "none", padding: "0 0 8px" }, text: stamp("LIVE", state.watchAt, null) }));
  if (!state.watchlist.length) {
    wrap.append(h("div", { class: "empty", text: "No watched tokens yet. Paste a CA above, or use “Add to watchlist” on a chart." }));
    return wrap;
  }
  for (const w of state.watchlist) {
    const tok = state.watchData[w.chain + ":" + w.address];
    const card = h("div", { class: "token-card" });
    const sym = tok?.symbol || w.symbol;
    const chg = tok?.chg?.h1 ?? tok?.chg?.h24;
    card.append(h("div", { class: "top" },
      h("div", {},
        h("div", { class: "name-row" }, h("span", { class: "sym", text: sym }), h("span", { class: "chip", text: chainLabel(w.chain) })),
        h("div", { class: "ca", text: w.address })
      ),
      h("div", { class: "right" },
        h("div", { class: "mono", text: formatUsd(tok?.price) }),
        h("div", { class: "mono " + pctClass(chg), text: formatPct(chg) }),
        h("div", { class: "sub", text: "MC " + formatUsd(tok?.mc, "size") })
      )
    ));
    const acts = h("div", { class: "actions" });
    acts.append(h("button", { class: "btn sm primary", type: "button", onclick: () => {
      if (tok) { selectToken(tok); state.nav = "terminal"; if (isMobile()) state.mobileTab = "charts"; renderAll(); }
      else resolveAndSelect(w.chain, w.address);
    } }, "Live chart"));
    acts.append(h("button", { class: "btn sm", type: "button", onclick: () => copyText(w.address) }, "Copy CA"));
    acts.append(h("a", { class: "btn sm", href: dsUrl(w.chain, w.address), target: "_blank", rel: "noreferrer" }, "DexScreener"));
    acts.append(h("button", { class: "btn sm", type: "button", onclick: () => {
      state.watchlist = state.watchlist.filter((x) => !(x.chain === w.chain && x.address === w.address));
      saveJson(LS_WATCH, state.watchlist);
      renderWorkspace();
    } }, "Remove"));
    card.append(acts);
    wrap.append(card);
  }
  return wrap;
}

function renderKol() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "KOL Signals" }));
  wrap.append(snapBanner());
  wrap.append(h("div", { class: "callout info" },
    "KOL count: —. GMGN did not show KOL counts in this capture, so no KOL figure is filled in. Nansen Scan is not connected (Cloudflare check). Nothing here is invented."
  ));
  const table = h("table", { class: "data" });
  table.append(h("thead", {}, h("tr", {}, h("th", { text: "Token" }), h("th", { class: "num", text: "KOL count" }), h("th", { class: "num", text: "Smart wallets" }), h("th", { class: "num", text: "Snapshot 1h" }))));
  const tb = h("tbody");
  for (const c of snapshotCoins()) {
    tb.append(h("tr", {},
      h("td", {}, h("strong", { text: c.symbol }), " ", h("span", { class: "ca", text: shortCa(c.address) })),
      h("td", { class: "num", text: countOrDash(c.kolCount) }),
      h("td", { class: "num", text: countOrDash(c.smartWalletCount) }),
      h("td", { class: "num " + pctClass(c.chg?.h1), text: formatPct(c.chg?.h1) })
    ));
  }
  table.append(tb);
  const panel = h("div", { class: "panel" });
  panel.append(
    h("div", { class: "panel-head" }, h("h2", { text: "Snapshot tokens" }), h("span", { class: "pill snap", text: "as of " + (state.smart?.asOfET || "—") })),
    table
  );
  wrap.append(panel);
  return wrap;
}

function renderNansen() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Nansen Scan" }));
  wrap.append(h("div", { class: "callout warn" },
    h("strong", { text: "Nansen Scan not connected. " }),
    "A Cloudflare security check blocked the earlier session, so no Nansen figures are on this site. This panel stays empty rather than filling in estimated numbers. Turning on “Route traffic through this computer” in the Grok Bot app may help on a later refresh."
  ));
  wrap.append(h("p", { class: "page-lead", text: "When a future refresh sets nansenConnected to true in data/smart-money.json and provides fields, they will appear here. Until then, every Nansen value is shown as not connected." }));
  return wrap;
}

function renderFib() {
  const wrap = h("div", { class: "stack" });
  const tok = state.selected;
  wrap.append(h("h1", { class: "page-head", text: "Fib Levels" + (tok ? " · " + tok.symbol : "") }));
  wrap.append(h("p", { class: "page-lead", text: "Retracements from the swing high to swing low of the currently loaded live candles (" + (TF[state.tf]?.label || state.tf) + "). Levels update when the chart’s candle set updates. This is a geometric reading of public OHLCV, not a signal from smart wallets." }));
  if (!tok) {
    wrap.append(h("div", { class: "empty", text: "Select a token on the Terminal first." }));
    return wrap;
  }
  wrap.append(h("div", { class: "panel-head", style: { border: "1px solid var(--border)", borderRadius: "10px", marginBottom: "10px" } },
    h("span", { class: "pill live" }, h("span", { class: "pulse" }), "LIVE"),
    h("span", { class: "panel-updated", text: stamp("LIVE", state.candlesAt, state.candlesErr) })
  ));
  const levels = fibFromCandles(state.candles);
  if (!levels.length) {
    wrap.append(h("div", { class: "empty", text: state.candlesErr || "Not enough candle data yet. Open Terminal, wait for the chart to load, then return here." }));
    return wrap;
  }
  const table = h("table", { class: "data" });
  table.append(h("thead", {}, h("tr", {}, h("th", { text: "Level" }), h("th", { class: "num", text: "Price" }))));
  const tb = h("tbody");
  for (const lv of levels) tb.append(h("tr", {}, h("td", { text: lv.label }), h("td", { class: "num", text: formatUsd(lv.price) })));
  table.append(tb);
  const panel = h("div", { class: "panel" });
  panel.append(table);
  wrap.append(panel);
  wrap.append(h("button", { class: "btn primary", type: "button", onclick: () => { state.nav = "terminal"; if (isMobile()) state.mobileTab = "charts"; renderAll(); } }, "Back to chart"));
  return wrap;
}

function renderCustom() {
  const wrap = h("div", { class: "stack" });
  wrap.append(h("h1", { class: "page-head", text: "Custom Alerts" }));
  wrap.append(h("p", { class: "page-lead", text: "Price alerts are stored only in this browser. They fire against live DexScreener or GeckoTerminal prices for tokens on your watchlist or the trending list. They are not wallet alerts and they are not sent as push notifications unless you grant permission." }));
  const tok = state.selected;
  const form = h("div", { class: "watch-add", style: { flexWrap: "wrap" } });
  form.append(h("span", { class: "sub", style: { alignSelf: "center" }, text: tok ? "Alert on " + tok.symbol : "Select a token on Terminal first" }));
  const cond = h("select", { class: "btn" });
  cond.append(h("option", { value: "above", text: "Price above" }), h("option", { value: "below", text: "Price below" }));
  cond.value = state.alertDraft.condition;
  cond.addEventListener("change", (e) => { state.alertDraft.condition = e.target.value; });
  const price = h("input", { type: "number", step: "any", placeholder: "USD price", value: state.alertDraft.price, style: { maxWidth: "160px" } });
  price.addEventListener("input", (e) => { state.alertDraft.price = e.target.value; });
  form.append(cond, price, h("button", { class: "btn primary", type: "button", onclick: () => {
    if (!tok) { toast("Select a token first"); return; }
    const p = Number(state.alertDraft.price);
    if (!Number.isFinite(p) || p <= 0) { toast("Enter a price"); return; }
    state.customAlerts.push({
      id: "a" + Date.now(), chain: tok.network, address: tok.address, symbol: tok.symbol,
      condition: state.alertDraft.condition, price: p, createdAt: new Date().toISOString(),
    });
    saveJson(LS_ALERTS, state.customAlerts);
    state.alertDraft.price = "";
    toast("Alert saved locally");
    renderWorkspace();
  } }, "Save alert"));
  wrap.append(form);
  if (!state.customAlerts.length) {
    wrap.append(h("div", { class: "empty", text: "No custom alerts yet." }));
    return wrap;
  }
  const table = h("table", { class: "data" });
  table.append(h("thead", {}, h("tr", {}, h("th", { text: "Token" }), h("th", { text: "Condition" }), h("th", { class: "num", text: "Level" }), h("th", { text: "Status" }), h("th", { text: "" }))));
  const tb = h("tbody");
  for (const a of state.customAlerts) {
    const fired = state.firedAlerts[a.id];
    tb.append(h("tr", {},
      h("td", { text: a.symbol + "  " + shortCa(a.address) }),
      h("td", { text: a.condition }),
      h("td", { class: "num", text: formatUsd(a.price) }),
      h("td", { class: fired ? "side-buy" : "", text: fired ? "Triggered" : "Watching" }),
      h("td", {}, h("button", { class: "btn sm", type: "button", onclick: () => {
        state.customAlerts = state.customAlerts.filter((x) => x.id !== a.id);
        saveJson(LS_ALERTS, state.customAlerts);
        renderWorkspace();
      } }, "Remove"))
    ));
  }
  table.append(tb);
  const panel = h("div", { class: "panel" });
  panel.append(table);
  wrap.append(panel);
  return wrap;
}

function checkCustomAlerts(tokens) {
  if (!state.customAlerts.length || !tokens) return;
  const byId = {};
  for (const t of tokens) byId[(t.network || "solana") + ":" + t.address] = t;
  for (const a of state.customAlerts) {
    if (state.firedAlerts[a.id]) continue;
    const t = byId[(a.chain || "solana") + ":" + a.address];
    if (!t || t.price == null) continue;
    const hit = a.condition === "above" ? t.price >= a.price : t.price <= a.price;
    if (hit) {
      const msg = a.symbol + " is " + formatUsd(t.price) + " (" + a.condition + " " + formatUsd(a.price) + ") at " + formatET(new Date(), true);
      state.firedAlerts[a.id] = msg;
      toast(msg);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("Smart Money Terminal", { body: msg }); } catch { /* */ }
      }
    }
  }
}

function startPollers() {
  for (const p of pollers) clearInterval(p);
  pollers = [];
  const every = (fn, ms) => {
    pollers.push(setInterval(() => {
      if (document.hidden) return;
      if (Date.now() < backoffUntil) return;
      fn();
    }, ms));
  };
  every(loadMajors, INTERVAL.majors);
  every(loadTrending, INTERVAL.trending);
  every(loadNewPools, INTERVAL.newPools);
  every(loadBoosts, INTERVAL.boosts);
  every(loadSmartMoney, INTERVAL.smartMoney);
  every(loadWatchlist, INTERVAL.watchlist);
  every(() => loadCandles(tokenAbort?.signal), INTERVAL.candles);
  every(() => loadTrades(tokenAbort?.signal), INTERVAL.trades);
}

function init() {
  renderAll();
  Promise.all([
    loadMajors(), loadSmartMoney(), loadTrending(), loadNewPools(), loadBoosts(), loadWatchlist(),
  ]).then(() => {
    if (state.selected) {
      if (tokenAbort) tokenAbort.abort();
      tokenAbort = new AbortController();
      return Promise.all([loadCandles(tokenAbort.signal), loadTrades(tokenAbort.signal)]);
    }
  });
  startPollers();
  mq.addEventListener("change", () => renderAll());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadMajors();
      loadTrending();
      if (state.selected) {
        loadCandles(tokenAbort?.signal);
        loadTrades(tokenAbort?.signal);
      }
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
