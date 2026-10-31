type QuoteRequest = { method?: string; url?: string }
type QuoteResponse = {
  setHeader: (name: string, value: string) => void
  status: (code: number) => QuoteResponse
  json: (body: unknown) => void
}
type QuoteRow = Record<string, unknown>
type QuotePrice = { close: number; date: string }

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'

function positivePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim().replaceAll(',', '')
  if (!normalized || normalized === '--') return null
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

async function fetchRows(url: string): Promise<QuoteRow[]> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`Quote source responded ${response.status}`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('Quote source returned an invalid payload')
  return payload as QuoteRow[]
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

  const prices: Record<string, QuotePrice> = {}
  const retrievalDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const applyRows = (rows: QuoteRow[], codeField: string, closeField: string) => {
    for (const row of rows) {
      const ticker = String(row[codeField] ?? '').trim().toUpperCase()
      if (!tickers.includes(ticker) || prices[ticker]) continue
      const close = positivePrice(row[closeField])
      if (close !== null) prices[ticker] = { close, date: retrievalDate }
    }
  }

  try {
    applyRows(await fetchRows(TWSE_URL), 'Code', 'ClosingPrice')
  } catch {
    // An unavailable listed-market source must not prevent an OTC lookup.
  }

  const unresolvedAfterTwse = tickers.filter((ticker) => !prices[ticker])
  if (unresolvedAfterTwse.length) {
    try {
      applyRows(await fetchRows(TPEX_URL), 'SecuritiesCompanyCode', 'Close')
    } catch {
      // Leave unresolved tickers in the response's missing list.
    }
  }

  const missing = tickers.filter((ticker) => !prices[ticker])
  if (!missing.length) res.setHeader('Cache-Control', 's-maxage=3600')
  return res.status(200).json({ prices, missing })
}
