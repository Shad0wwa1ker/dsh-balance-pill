window.__ModuleLoader__.load({
  id: '@local/dsh-balance-pill',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'balance-pill';

    /** DeepSeek bills Beijing time: peak = Mon–Fri 09:00–12:00 and 14:00–18:00. */
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];

    /**
     * Built-in official holiday dates, used offline and before a new year's
     * arrangement is published. The browser refreshes unlisted years from the
     * same public dataset the Host uses.
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

    const holidayDays = new Set(FALLBACK_HOLIDAYS);
    const knownYears = new Set([2026]);
    const holidayListeners = new Set();
    const holidayEndpoint = (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${String(year)}.json`;

    function publishHolidayDays(dates) {
      let changed = false;
      for (const date of dates) {
        if (!holidayDays.has(date)) {
          holidayDays.add(date);
          changed = true;
        }
      }
      if (changed) for (const listener of holidayListeners) listener();
    }

    /** Pull unlisted years from the public dataset; failures keep the fallback. */
    async function refreshHolidayDays(now) {
      if (typeof fetch !== 'function') return;
      const year = bjDate(now).getUTCFullYear();
      for (const value of [year, year + 1]) {
        if (knownYears.has(value)) continue;
        try {
          const response = await fetch(holidayEndpoint(value));
          if (!response.ok) continue;
          const payload = await response.json();
          const days = Array.isArray(payload?.days) ? payload.days : [];
          const offDays = days
            .filter((day) => day !== null && typeof day === 'object' && day.isOffDay === true && typeof day.date === 'string')
            .map((day) => day.date);
          if (offDays.length === 0) continue;
          knownYears.add(value);
          publishHolidayDays(offDays);
        } catch {
          // Offline or blocked: keep whatever is already known.
        }
      }
    }

    /** Re-render the pill whenever a newer holiday list lands. */
    function useHolidayDays() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1);
        holidayListeners.add(listener);
        return () => holidayListeners.delete(listener);
      }, []);
      return holidayDays;
    }

    /**
     * List prices in CNY per million tokens, indexed [off-peak, peak]. Cache
     * writes have no separate DeepSeek price, so they price as cache misses.
     */
    const PRICING = {
      flash: { hit: [0.02, 0.04], miss: [1, 2], output: [4, 8] },
      pro: { hit: [0.15, 0.3], miss: [4.5, 9], output: [13.5, 27] },
    };

    const DICTIONARIES = {
      zh: {
        'phase.peak': '峰时',
        'phase.offPeak': '谷时',
        'balance.amount': '{amount}',
        'balance.unknown': '余额 --',
        'title.peak': '高峰时段（北京时间 9:00–12:00、14:00–18:00）· 下次转入空闲：{next}',
        'title.offPeak': '空闲时段，价格为高峰的 5 折 · 下次转入高峰：{next}',
        'title.unknown': '余额读取失败，点击重试',
        'title.refresh': '点击刷新余额',
        'title.grantedDetail': '充值 {topped} ＋ 赠送 {granted}',
        'cost.inline': '本次 {amount}',
        'cost.title': '本会话估算：命中 {hit} tok／未命中 {miss} tok／输出 {out} tok，按 deepseek-flash {phase}价。跨峰谷的历史请求按当前时段统一计价。',
        'cost.exact.title': '本会话逐请求计价：命中 {hit} tok／未命中 {miss} tok／输出 {out} tok，每条请求按其发生时的峰谷价计。',
      },
      en: {
        'phase.peak': 'Peak',
        'phase.offPeak': 'Off-peak',
        'balance.amount': '{amount}',
        'balance.unknown': '--',
        'title.peak': 'Peak hours (09:00–12:00, 14:00–18:00 Beijing time) · off-peak at {next}',
        'title.offPeak': 'Off-peak, half the peak price · peak starts {next}',
        'title.unknown': 'Balance unavailable, click to retry',
        'title.refresh': 'Click to refresh the balance',
        'title.grantedDetail': 'Topped up {topped} + granted {granted}',
        'cost.inline': 'Session {amount}',
        'cost.title': 'Session estimate: {hit} hit / {miss} miss / {out} output tokens at deepseek-flash {phase} rates. Requests spanning both windows are priced uniformly at the current one.',
        'cost.exact.title': 'Session priced per request: {hit} hit / {miss} miss / {out} output tokens, each at the phase in effect when it was sent.',
      },
    };

    const bjDate = (ms) => new Date(ms + BEIJING_OFFSET_MS);
    const bjDay = (ms) => bjDate(ms).toISOString().slice(0, 10);

    /** @param ms - epoch milliseconds @param days - off-day set @returns whether Beijing wall time is peak. */
    function isPeak(ms, days = holidayDays) {
      const d = bjDate(ms);
      const weekday = d.getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      if (days.has(bjDay(ms))) return false;
      const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
      for (const [from, to] of PEAK_WINDOWS) {
        if (minute >= from && minute < to) return true;
      }
      return false;
    }

    /** The next epoch millisecond at which the peak flag flips, or null within eight days. */
    function nextSwitch(ms, days = holidayDays) {
      const current = isPeak(ms, days);
      for (let step = 1; step <= 8 * 24 * 60; step += 1) {
        const at = ms + step * 60 * 1000;
        if (isPeak(at, days) !== current) return at;
      }
      return null;
    }

    function formatBeijingTime(ms) {
      const d = bjDate(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    /** Format one amount in the wallet currency; tiny non-zero amounts keep four decimals. */
    function formatAmount(amount, currency) {
      const symbol = currency === 'USD' ? '$' : '¥';
      const value = Number(amount);
      if (!Number.isFinite(value)) return `${symbol}${amount}`;
      const fixed = Math.abs(value) >= 0.01 || value === 0 ? value.toFixed(2) : value.toFixed(4);
      return `${symbol}${fixed}`;
    }

    /**
     * Combine recharge and granted wallets per currency, keeping the two parts
     * visible for the tooltip. Platform reports both lists separately and bills
     * them together, so the readable total is their sum.
     */
    function sumWallets(normalWallets, bonusWallets) {
      const totals = new Map();
      const add = (wallets, part) => {
        for (const wallet of Array.isArray(wallets) ? wallets : []) {
          if (!wallet || typeof wallet.currency !== 'string') continue;
          const entry = totals.get(wallet.currency)
            ?? { currency: wallet.currency, toppedUp: 0, granted: 0 };
          const value = Number(wallet.balance);
          if (Number.isFinite(value)) entry[part] += value;
          totals.set(wallet.currency, entry);
        }
      };
      add(normalWallets, 'toppedUp');
      add(bonusWallets, 'granted');
      const entries = [...totals.values()].map((entry) => ({
        ...entry,
        total: entry.toppedUp + entry.granted,
      }));
      entries.sort((a, b) => (a.currency === 'CNY' ? -1 : b.currency === 'CNY' ? 1 : 0));
      return entries[0];
    }

    /**
     * Price one session's provider-reported usage, in CNY. `tier` selects the
     * model price list; flash is the profile default.
     */
    function estimateCost(usage, peak, tier = 'flash') {
      const rates = PRICING[tier] ?? PRICING.flash;
      const at = peak ? 1 : 0;
      const hit = usage.cacheReadTokens || 0;
      const miss = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0);
      const out = usage.outputTokens || 0;
      return (hit * rates.hit[at] + miss * rates.miss[at] + out * rates.output[at]) / 1e6;
    }

    /** Format a cost reading; amounts under one yuan keep four decimals. */
    function formatCost(amount) {
      if (!Number.isFinite(amount)) return '¥--';
      if (amount === 0) return '¥0.00';
      return amount >= 1 ? `¥${amount.toFixed(2)}` : `¥${amount.toFixed(4)}`;
    }

    function formatTokens(count) {
      return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** Read-only identity of the requesting UI, as every account call expects. */
    function clientMetadata(ctx) {
      const boot = globalThis.__DSH_BOOT__;
      const version = boot && boot.release && typeof boot.release.version === 'string'
        ? boot.release.version
        : '';
      return {
        version: version || '0.0.0',
        locale: ctx.locale.getSnapshot().active,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    function createPill(ctx) {
      /** Composer pill: account balance and the current billing phase. */
      return function BalancePill({ useSession, useProjection }) {
        const t = ctx.locale.bind(NS);
        const [reading, setReading] = React.useState({ status: 'loading', wallet: undefined });
        const [now, setNow] = React.useState(() => Date.now());
        const [busy, setBusy] = React.useState(false);
        const alive = React.useRef(true);
        const settle = React.useRef(false);
        const useRunning = typeof useSession === 'function' ? useSession : (() => undefined);
        const running = useRunning((snapshot) => (snapshot ? snapshot.running : undefined));
        const project = typeof useProjection === 'function' ? useProjection : (() => undefined);
        const days = useHolidayDays();
        const usage = project('tokenUsage');

        React.useEffect(() => () => {
          alive.current = false;
        }, []);

        const load = React.useCallback(async () => {
          setBusy(true);
          try {
            const result = await ctx.remote.account.getBalance(clientMetadata(ctx));
            if (!alive.current) return;
            if (!result || !result.ok) {
              setReading({ status: 'unavailable', wallet: undefined });
              return;
            }
            const outcome = result.value;
            if (!outcome || outcome.status !== 'ready') {
              setReading({ status: 'absent', wallet: undefined });
              return;
            }
            setReading({ status: 'ready', wallet: sumWallets(outcome.value, outcome.bonusWallets) });
          } catch {
            if (alive.current) setReading({ status: 'unavailable', wallet: undefined });
          } finally {
            if (alive.current) setBusy(false);
          }
        }, []);

        React.useEffect(() => {
          void load();
          const balanceTimer = setInterval(() => void load(), 60 * 1000);
          const clockTimer = setInterval(() => setNow(Date.now()), 30 * 1000);
          return () => {
            clearInterval(balanceTimer);
            clearInterval(clockTimer);
          };
        }, [load]);

        /** Refresh once when a running turn settles, so the charge shows up promptly. */
        React.useEffect(() => {
          if (running === true) {
            settle.current = true;
            return;
          }
          if (running === false && settle.current) {
            settle.current = false;
            void load();
          }
        }, [running, load]);

        const peak = isPeak(now, days);
        const phase = t(peak ? 'phase.peak' : 'phase.offPeak');
        const boundary = nextSwitch(now, days);
        const until = boundary === null ? '--' : formatBeijingTime(boundary);
        const amount = reading.wallet ? formatAmount(reading.wallet.total, reading.wallet.currency) : undefined;
        const exact = project('sessionCost');
        const exactCost = exact !== undefined && exact !== null && Number.isFinite(exact.cost) ? exact.cost : undefined;
        const cost = exactCost !== undefined
          ? exactCost
          : usage ? estimateCost(usage, peak) : undefined;
        const costText = cost === undefined ? null : t('cost.inline', { amount: formatCost(cost) });
        const label = [
          amount === undefined ? null : t('balance.amount', { amount }),
          phase,
          costText,
        ].filter(Boolean).join(' · ');
        const detail = reading.wallet && reading.wallet.granted > 0
          ? t('title.grantedDetail', {
            topped: formatAmount(reading.wallet.toppedUp, reading.wallet.currency),
            granted: formatAmount(reading.wallet.granted, reading.wallet.currency),
          })
          : null;
        const costTokens = exactCost !== undefined ? exact : usage;
        const costDetail = costTokens === undefined ? null : exactCost !== undefined
          ? t('cost.exact.title', {
            hit: formatTokens(costTokens.cacheReadTokens || 0),
            miss: formatTokens((costTokens.inputTokens || 0) + (costTokens.cacheWriteTokens || 0)),
            out: formatTokens(costTokens.outputTokens || 0),
          })
          : t('cost.title', {
            hit: formatTokens(usage.cacheReadTokens || 0),
            miss: formatTokens((usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)),
            out: formatTokens(usage.outputTokens || 0),
            phase,
          });
        const title = [
          reading.status === 'unavailable'
            ? t('title.unknown')
            : t(peak ? 'title.peak' : 'title.offPeak', { next: until }),
          detail,
          costDetail,
          t('title.refresh'),
        ].filter(Boolean).join(' · ');

        return h('button', {
          type: 'button',
          'data-balance-pill': true,
          title,
          'aria-label': label,
          'aria-busy': busy,
          onClick: () => void load(),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 18,
            padding: '0 6px',
            border: 0,
            borderRadius: 999,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 11,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            opacity: busy ? 0.55 : 0.75,
          },
        }, label);
      };
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      /** Pure helpers, exported for verification outside the browser. */
      __test: { isPeak, nextSwitch, formatAmount, sumWallets, estimateCost, formatCost },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'balance-pill: dictionaries');
        void refreshHolidayDays(Date.now());
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'balance-pill',
          order: 2,
          locale: NS,
        }, createPill(ctx)));
      },
    };
  },
});
