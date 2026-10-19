/**
 * Host half of the balance-pill bundle.
 *
 * The pill's cost figure must survive peak/off-peak switches and compaction, so
 * the exact price is folded here from the durable log instead of estimated in
 * the browser. This module registers one client-visible projection,
 * `sessionCost`, that prices every settled assistant sample at the rate in
 * effect when its step started.
 */

/** DeepSeek bills Beijing time: peak = Mon–Fri 09:00–12:00 and 14:00–18:00. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

/**
 * Built-in official holiday dates, used offline and until the Host refreshes.
 * Years not listed here are refreshed from the holiday-cn dataset, which is
 * generated from State Council announcements and gains a year when published.
 */
const FALLBACK_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
  '2027-01-01',
];

/** CNY per million tokens, indexed [off-peak, peak]. */
const PRICING = {
  flash: { hit: [0.02, 0.04], miss: [1, 2], output: [4, 8] },
  pro: { hit: [0.15, 0.3], miss: [4.5, 9], output: [13.5, 27] },
};

/**
 * Search and Fetch are separate APIs billed per successful request (¥5 per
 * 1,000). Harness calls are free until Beijing 2026-11-01 00:00, so requests
 * made before that instant still count but add nothing to the cost.
 */
const SERVICE_PRICE = 5 / 1000;
const SERVICE_BILLING_START = Date.parse('2026-10-31T16:00:00Z');

/**
 * Engines that resolve to DeepSeek's own search API, the only one the platform
 * bills (¥5 per 1,000 requests). Everything else — Tavily, Bing, Exa, DuckDuckGo
 * and the rest of the free-search plugin's third-party engines — is free, so a
 * search that lands on one of those must not add the per-request fee.
 */
const DEEPSEEK_SEARCH_ENGINES = new Set([
  'deepseek-tools',
  'deepseek-official',
  'deepseek-search-api',
  'deepseek',
]);

/** Parse a tool call's JSON argument string, or undefined when malformed. */
function parseArguments(raw) {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Distinct, non-empty queries in one web_search call; duplicates run once. */
function searchQueryCount(args) {
  if (args === undefined || args === null || !Array.isArray(args.queries)) return 0;
  const seen = new Set();
  for (const query of args.queries) {
    if (typeof query === 'string' && query.trim() !== '') seen.add(query);
  }
  return seen.size;
}

/** Joined text blocks of a tool result message. */
function resultText(data) {
  const content = data?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * The engine that answered a search, read from the free-search result header
 * (`Search (tavily, timeRange=day):`, `Multi-Search (multi):`). Returns null for
 * results without a header, which are the core DSH tool's DeepSeek results.
 */
function searchEngineName(text) {
  const match = /^(?:Multi-)?Search \(([^)]*)\)/m.exec(text);
  if (match === null) return null;
  const name = match[1].split(',')[0].trim().toLowerCase();
  return name === '' ? null : name;
}

/**
 * Whether one web tool result corresponds to a billable API request.
 *
 * Search charges only when DeepSeek's own search engine answered; third-party
 * engines of the free-search plugin are free, so their results never add the
 * per-request fee. Search charges only for non-empty result lists; Fetch charges
 * only when the API returned page content with HTTP 200. Anything that looks
 * like a failure is not billed.
 */
function billableRequests(kind, data, text) {
  if (data?.message?.isError === true) return 0;
  if (kind === 'search') {
    const engine = searchEngineName(text);
    if (engine !== null && !DEEPSEEK_SEARCH_ENGINES.has(engine)) return 0;
    if (engine === null && !text.startsWith('External web content follows')) return 0;
    const hasSources = text.includes('Sources:');
    return !hasSources && text.includes('No results found.') ? 0 : 1;
  }
  if (kind === 'fetch') {
    const match = /\(HTTP (\d{3})\)/.exec(text);
    if (match === null) return 0;
    const status = Number(match[1]);
    return status >= 200 && status < 300 ? 1 : 0;
  }
  return 0;
}

const holidayDays = new Set(FALLBACK_HOLIDAYS);
const fetchedYears = new Set([2026]);

/** Read the holiday-cn shape: `{ year, days: [{ date, isOffDay }] }`. */
export function parseHolidayCn(payload, year) {
  if (payload === null || typeof payload !== 'object' || payload.year !== year) return [];
  const days = Array.isArray(payload.days) ? payload.days : [];
  return days
    .filter((day) => day !== null && typeof day === 'object' && day.isOffDay === true
      && typeof day.date === 'string' && day.date.startsWith(`${year}-`))
    .map((day) => day.date);
}

/** Read the timor.tech shape: `{ code, holiday: { 'MM-DD': { date, holiday } } }`. */
export function parseTimor(payload, year) {
  if (payload === null || typeof payload !== 'object' || payload.code !== 0
    || payload.holiday === null || typeof payload.holiday !== 'object') return [];
  return Object.values(payload.holiday)
    .filter((day) => day !== null && typeof day === 'object' && day.holiday === true
      && typeof day.date === 'string' && day.date.startsWith(`${year}-`))
    .map((day) => day.date);
}

/**
 * Holiday sources in preference order: GitHub first, then a global CDN, then a
 * mainland-accessible API for networks where GitHub and jsDelivr are blocked,
 * then a GitHub proxy. Every source is CORS-enabled for the browser half.
 */
export const HOLIDAY_CHANNELS = [
  {
    id: 'github',
    url: (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${String(year)}.json`,
    parse: parseHolidayCn,
  },
  {
    id: 'jsdelivr',
    url: (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${String(year)}.json`,
    parse: parseHolidayCn,
  },
  {
    id: 'timor',
    url: (year) => `https://timor.tech/api/holiday/year/${String(year)}`,
    parse: parseTimor,
  },
  {
    id: 'ghproxy',
    url: (year) => `https://ghproxy.net/https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${String(year)}.json`,
    parse: parseHolidayCn,
  },
];

const HOLIDAY_TIMEOUT_MS = 6000;

const bjDate = (ms) => new Date(ms + BEIJING_OFFSET_MS);
const bjDay = (ms) => bjDate(ms).toISOString().slice(0, 10);

/** @param ms - epoch milliseconds @returns the Beijing calendar year. */
export function beijingYear(ms) {
  return bjDate(ms).getUTCFullYear();
}

/**
 * Load the current Beijing year's off-days once.
 *
 * One fetch per year is enough: the schedule does not change after publication,
 * and a later year only needs loading once it becomes current. Channels are
 * tried in order until one answers with a non-empty, same-year schedule; a year
 * whose announcement is not out yet stays unknown and is retried later.
 *
 * @param now - reference time in epoch milliseconds.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns whether the current year was learned.
 */
export async function refreshHolidays(now = Date.now(), fetchImpl = globalThis.fetch) {
  const year = beijingYear(now);
  if (fetchedYears.has(year)) return false;
  if (typeof fetchImpl !== 'function') return false;
  for (const channel of HOLIDAY_CHANNELS) {
    try {
      const response = await fetchImpl(channel.url(year), { signal: AbortSignal.timeout(HOLIDAY_TIMEOUT_MS) });
      if (!response.ok) continue;
      const offDays = channel.parse(await response.json(), year);
      if (offDays.length === 0) continue;
      for (const date of offDays) holidayDays.add(date);
      fetchedYears.add(year);
      return true;
    } catch {
      // Unreachable or blocked: try the next channel.
    }
  }
  return false;
}

/** @param ms - epoch milliseconds @param days - off-day set @returns whether Beijing wall time is peak. */
export function isPeak(ms, days = holidayDays) {
  const d = bjDate(ms);
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (days.has(bjDay(ms))) return false;
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return PEAK_WINDOWS.some(([from, to]) => minute >= from && minute < to);
}

/** Map a provider model id onto its price list; anything non-pro is flash. */
export function priceTier(model) {
  return typeof model === 'string' && /pro/i.test(model) ? 'pro' : 'flash';
}

/** Price one usage sample at the rate in effect at `at`, in CNY. */
export function sampleCost(usage, at, model) {
  const rates = PRICING[priceTier(model)];
  const index = isPeak(at) ? 1 : 0;
  const hit = usage.cacheReadTokens ?? 0;
  const miss = (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const out = usage.outputTokens ?? 0;
  return (hit * rates.hit[index] + miss * rates.miss[index] + out * rates.output[index]) / 1e6;
}

/** Last `usage` chunk of a durable assistant stream, when the event carries one. */
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk.usage;
  }
  return undefined;
}

function usageOf(event) {
  const data = event.data;
  if (data === undefined || data === null) return undefined;
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage;
  return lastStreamUsage(data.stream);
}

const emptyBuckets = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const sameBuckets = (left, right) => left.inputTokens === right.inputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens;

const round = (value) => Math.round(value * 1e9) / 1e9;

export function init() {
  return {
    cost: 0,
    ...emptyBuckets(),
    model: null,
    stepStart: null,
    last: null,
    searchRequests: 0,
    searchFree: 0,
    fetchRequests: 0,
    serviceCost: 0,
    pending: {},
  };
}

/**
 * Fold one committed event. Returns the same state reference when the event
 * cannot change the price, which is what keeps the projection quiet.
 *
 * @param state - previous whole state.
 * @param event - committed session event with `type`, `time`, `data`.
 */
export function fold(state, event) {
  switch (event.type) {
    case 'model/selection': {
      const model = event.data?.model;
      return typeof model === 'string' && model !== state.model ? { ...state, model } : state;
    }
    case 'request/header': {
      const model = event.data?.header?.model;
      return typeof model === 'string' && model !== state.model ? { ...state, model } : state;
    }
    case 'step/start': {
      return typeof event.time === 'number' ? { ...state, stepStart: event.time } : state;
    }
    case 'llm/retry-started': {
      return state.last === null
        || state.last.turn !== event.data?.turn
        || state.last.step !== event.data?.step
        ? state
        : { ...state, last: null };
    }
    case 'assistant/message':
    case 'assistant/attempt': {
      const usage = usageOf(event);
      const turn = event.data?.turn;
      const step = event.data?.step;
      if (usage === undefined || typeof turn !== 'number' || typeof step !== 'number') return state;
      const buckets = {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      };
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null;
      if (previous !== null && sameBuckets(previous.buckets, buckets)) return state;
      const at = typeof state.stepStart === 'number' ? state.stepStart : event.time;
      const cost = sampleCost(buckets, at, state.model);
      return {
        ...state,
        cost: round(state.cost - (previous?.cost ?? 0) + cost),
        inputTokens: state.inputTokens - (previous?.buckets.inputTokens ?? 0) + buckets.inputTokens,
        outputTokens: state.outputTokens - (previous?.buckets.outputTokens ?? 0) + buckets.outputTokens,
        cacheReadTokens: state.cacheReadTokens - (previous?.buckets.cacheReadTokens ?? 0) + buckets.cacheReadTokens,
        cacheWriteTokens: state.cacheWriteTokens - (previous?.buckets.cacheWriteTokens ?? 0) + buckets.cacheWriteTokens,
        last: { turn, step, cost, buckets },
      };
    }
    case 'tool/call': {
      const name = event.data?.name;
      if (name !== 'web_search' && name !== 'advanced_search' && name !== 'web_fetch') return state;
      const callId = event.data?.callId;
      if (typeof callId !== 'string') return state;
      const args = parseArguments(event.data?.arguments);
      const count = name === 'web_fetch' ? 1 : name === 'web_search' ? searchQueryCount(args) : 1;
      if (count === 0) return state;
      return {
        ...state,
        pending: {
          ...state.pending,
          [callId]: { kind: name === 'web_fetch' ? 'fetch' : 'search', count, at: event.time },
        },
      };
    }
    case 'tool/result': {
      const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId;
      const entry = typeof callId === 'string' ? state.pending?.[callId] : undefined;
      if (entry === undefined) return state;
      const pending = { ...state.pending };
      delete pending[callId];
      const text = resultText(event.data);
      const engine = entry.kind === 'search' ? searchEngineName(text) : null;
      const free = engine !== null && !DEEPSEEK_SEARCH_ENGINES.has(engine)
        && event.data?.message?.isError !== true;
      const billable = free ? 0 : billableRequests(entry.kind, event.data, text) === 1 ? entry.count : 0;
      if (billable === 0 && !free) return { ...state, pending };
      const charged = typeof entry.at === 'number' && entry.at >= SERVICE_BILLING_START
        ? billable * SERVICE_PRICE
        : 0;
      return {
        ...state,
        pending,
        searchRequests: state.searchRequests + (entry.kind === 'search' ? billable : 0),
        searchFree: state.searchFree + (free && entry.kind === 'search' ? entry.count : 0),
        fetchRequests: state.fetchRequests + (entry.kind === 'fetch' ? billable : 0),
        serviceCost: round(state.serviceCost + charged),
      };
    }
    case 'turn/end': {
      return state.pending === undefined || Object.keys(state.pending).length === 0
        ? state
        : { ...state, pending: {} };
    }
    default:
      return state;
  }
}

/** Parsed leniently: the wire shape is plain JSON and versioned by stateVersion. */
const passthrough = { parse: (value) => value };

const views = new WeakMap();

export const sessionCostProjection = {
  key: 'sessionCost',
  stateVersion: 3,
  stateSchema: passthrough,
  init,
  apply: fold,
  wire: {
    viewSchema: passthrough,
    view: (state) => {
      let view = views.get(state);
      if (view === undefined) {
        view = {
          cost: state.cost,
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          cacheReadTokens: state.cacheReadTokens,
          cacheWriteTokens: state.cacheWriteTokens,
          model: state.model,
          searchRequests: state.searchRequests,
          searchFree: state.searchFree,
          fetchRequests: state.fetchRequests,
          serviceCost: state.serviceCost,
          exact: true,
        };
        views.set(state, view);
      }
      return view;
    },
  },
};

export function apply(ctx) {
  try {
    ctx.inject(['sessionProjections'], (scope) => {
      try {
        scope.sessionProjections.register(sessionCostProjection);
      } catch (error) {
        console.error('[balance-pill] sessionCost projection registration failed', error);
      }
    });
  } catch (error) {
    console.error('[balance-pill] sessionProjections injection unavailable', error);
  }

  try {
    void refreshHolidays();
    const daily = setInterval(() => void refreshHolidays(), 24 * 60 * 60 * 1000);
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => clearInterval(daily), 'balance-pill: holiday refresh timer');
    } else if (typeof daily.unref === 'function') {
      daily.unref();
    }
  } catch (error) {
    console.error('[balance-pill] holiday refresh unavailable', error);
  }
}
