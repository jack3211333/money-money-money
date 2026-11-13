// 台股收盤價來源。api/quote.ts（Vercel，ESM 無法跨目錄引用）內有相同邏輯，修改時兩邊同步。
// 1. 先平行查當日全市場行情：TWSE MI_INDEX、TPEx dailyQuotes。
// 2. 仍缺的代號逐檔查 TWSE STOCK_DAY／TPEx tradingStock（本月，無資料再查上月），取最近一個交易日。
//    可涵蓋假日、盤中尚未公布，以及暫停交易（例如 ETF 分割）只剩較早收盤價的情況。
// OpenAPI STOCK_DAY_ALL 收盤當晚仍為前一交易日資料，且會缺漏部分代號，因此不再使用。
export type TwQuote = { close: number; date: string }

const positivePrice = (value: unknown): number | null => {
  const normalized = String(value ?? '').trim().replaceAll(',', '')
  if (!normalized || normalized === '--') return null
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

// 接受 20261110、2026/11/10、1151110、115/11/10；無法辨識或晚於 today 時回傳 null。
const normalizeDate = (value: unknown, today: string): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '')
  let date: string
  if (digits.length === 8) date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
  else if (digits.length === 6 || digits.length === 7) date = `${Number(digits.slice(0, -4)) + 1911}-${digits.slice(-4, -2)}-${digits.slice(-2)}`
  else return null
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) && date <= today ? date : null
}

const fetchJson = async (url: string, timeoutMs = 25_000): Promise<unknown> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Quote source responded ${response.status}`)
  return response.json()
}

type Table = { fields?: unknown; data?: unknown }
const tablesOf = (payload: unknown): Table[] => {
  const value = payload as { tables?: unknown; fields?: unknown; data?: unknown } | null
  if (Array.isArray(value?.tables)) return value.tables as Table[]
  return value && Array.isArray(value.fields) ? [value] : []
}
const tableRows = (payload: unknown, keyField: string, closeField: string): [string, unknown][] => {
  const rows: [string, unknown][] = []
  for (const table of tablesOf(payload)) {
    if (!Array.isArray(table?.fields) || !Array.isArray(table?.data)) continue
    const fields = table.fields.map((field) => String(field).replace(/\s/g, ''))
    const keyIndex = fields.indexOf(keyField)
    const closeIndex = fields.indexOf(closeField)
    if (keyIndex < 0 || closeIndex < 0) continue
    for (const row of table.data) if (Array.isArray(row)) rows.push([String(row[keyIndex] ?? ''), row[closeIndex]])
  }
  return rows
}

const previousMonth = (today: string) => {
  const [year, month] = today.split('-').map(Number)
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`
}

// 逐檔查詢：回傳 today 以前最近一個有收盤價的交易日。
async function latestDailyClose(ticker: string, today: string): Promise<TwQuote | null> {
  for (const month of [today, previousMonth(today)]) {
    const urls: [string, string][] = [
      [`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${month.replaceAll('-', '')}&stockNo=${ticker}&response=json`, '收盤價'],
      [`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${ticker}&date=${encodeURIComponent(month.replaceAll('-', '/'))}&response=json`, '收盤'],
    ]
    for (const [url, closeField] of urls) {
      let best: TwQuote | null = null
      try {
        for (const [dateValue, closeValue] of tableRows(await fetchJson(url, 15_000), '日期', closeField)) {
          const date = normalizeDate(dateValue, today)
          const close = positivePrice(closeValue)
          if (date && close !== null && (!best || date > best.date)) best = { close, date }
        }
      } catch { /* 改查下一個來源 */ }
      if (best) return best
    }
  }
  return null
}

/** today 為台灣日期 YYYY-MM-DD；回傳每個代號最近一個交易日的收盤價與行情日期。 */
export async function fetchTwCloses(tickers: string[], today: string): Promise<{ quotes: Map<string, TwQuote>; sourceErrors: string[] }> {
  const wanted = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()))]
  const quotes = new Map<string, TwQuote>()
  const sourceErrors: string[] = []
  const compact = today.replaceAll('-', '')
  const [twse, tpex] = await Promise.allSettled([
    fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact}&type=ALLBUT0999&response=json`),
    fetchJson(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${encodeURIComponent(today.replaceAll('-', '/'))}&id=&response=json`),
  ])
  const apply = (rows: [string, unknown][], date: string | null) => {
    if (!date) return
    for (const [code, closeValue] of rows) {
      const ticker = code.trim().toUpperCase()
      if (!wanted.includes(ticker) || quotes.has(ticker)) continue
      const close = positivePrice(closeValue)
      if (close !== null) quotes.set(ticker, { close, date })
    }
  }
  if (twse.status === 'fulfilled') {
    const payload = twse.value as { stat?: unknown; date?: unknown }
    if (payload?.stat === 'OK') apply(tableRows(payload, '證券代號', '收盤價'), normalizeDate(payload.date, today))
  } else sourceErrors.push('twse')
  if (tpex.status === 'fulfilled') apply(tableRows(tpex.value, '代號', '收盤'), normalizeDate((tpex.value as { date?: unknown })?.date, today))
  else sourceErrors.push('tpex')

  for (const ticker of wanted.filter((code) => !quotes.has(code)).slice(0, 30)) {
    const quote = await latestDailyClose(ticker, today)
    if (quote) quotes.set(ticker, quote)
  }
  return { quotes, sourceErrors }
}
