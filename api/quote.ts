type QuoteRequest = { method?: string; url?: string }
type QuoteResponse = {
  setHeader: (name: string, value: string) => void
  status: (code: number) => QuoteResponse
  json: (body: unknown) => void
}

// 與 supabase/functions/_shared/twQuotes.ts 相同的收盤價邏輯（ESM 下無法跨目錄引用），修改時兩邊同步。
type TwQuote = { close: number; date: string }
type Row = Record<string, unknown>

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

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Quote source responded ${response.status}`)
  return response.json()
}

type Table = { fields?: unknown; data?: unknown }
const tableRows = (payload: unknown, codeField: string, closeField: string): [string, unknown][] => {
  const tables = (payload as { tables?: unknown })?.tables
  if (!Array.isArray(tables)) return []
  const rows: [string, unknown][] = []
  for (const table of tables as Table[]) {
    if (!Array.isArray(table?.fields) || !Array.isArray(table?.data)) continue
    const codeIndex = table.fields.indexOf(codeField)
    const closeIndex = table.fields.indexOf(closeField)
    if (codeIndex < 0 || closeIndex < 0) continue
    for (const row of table.data) if (Array.isArray(row)) rows.push([String(row[codeIndex] ?? ''), row[closeIndex]])
  }
  return rows
}

/** today 為台灣日期 YYYY-MM-DD；回傳每個代號的收盤價與行情日期。 */
async function fetchTwCloses(tickers: string[], today: string): Promise<{ quotes: Map<string, TwQuote>; sourceErrors: string[] }> {
  const wanted = new Set(tickers.map((ticker) => ticker.trim().toUpperCase()))
  const quotes = new Map<string, TwQuote>()
  const sourceErrors: string[] = []
  const pending = () => [...wanted].some((ticker) => !quotes.has(ticker))
  const apply = (rows: Iterable<[string, unknown]>, date: string | null) => {
    if (!date) return
    for (const [code, closeValue] of rows) {
      const ticker = code.trim().toUpperCase()
      if (!wanted.has(ticker) || quotes.has(ticker)) continue
      const close = positivePrice(closeValue)
      if (close !== null) quotes.set(ticker, { close, date })
    }
  }
  const compact = today.replaceAll('-', '')
  const sources: [string, () => Promise<void>][] = [
    ['twse', async () => {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact}&type=ALLBUT0999&response=json`) as { stat?: unknown; date?: unknown }
      if (payload?.stat === 'OK') apply(tableRows(payload, '證券代號', '收盤價'), normalizeDate(payload.date, today))
    }],
    ['tpex', async () => {
      const payload = await fetchJson(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${encodeURIComponent(today.replaceAll('-', '/'))}&id=&response=json`) as { date?: unknown }
      apply(tableRows(payload, '代號', '收盤'), normalizeDate(payload?.date, today))
    }],
    ['twse-openapi', async () => {
      const rows = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL')
      if (Array.isArray(rows)) for (const row of rows as Row[]) apply([[String(row.Code ?? ''), row.ClosingPrice]], normalizeDate(row.Date, today))
    }],
    ['tpex-openapi', async () => {
      const rows = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
      if (Array.isArray(rows)) for (const row of rows as Row[]) apply([[String(row.SecuritiesCompanyCode ?? ''), row.Close]], normalizeDate(row.Date, today))
    }],
  ]
  for (const [name, load] of sources) {
    if (!pending()) break
    try { await load() } catch { sourceErrors.push(name) }
  }
  return { quotes, sourceErrors }
}

export default async function handler(req: QuoteRequest, res: QuoteResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const query = new URL(req.url ?? '/', 'https://localhost').searchParams.get('tickers') ?? ''
  const tickers = [...new Set(query.split(',').map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length || tickers.length > 100 || tickers.some((ticker) => !/^[A-Z0-9]{1,10}$/.test(ticker))) {
    return res.status(400).json({ error: '請提供有效股票代號（每次最多 100 檔）。' })
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const { quotes } = await fetchTwCloses(tickers, today)
  const prices = Object.fromEntries(quotes)
  const missing = tickers.filter((ticker) => !quotes.has(ticker))
  return res.status(200).json({ prices, missing })
}
