import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse, preflight } from '../_shared/cors.ts'

type QuoteRow = Record<string, unknown>
type Quote = { close: number; date: string }

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const taipeiToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

function positivePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim().replaceAll(',', '')
  if (!normalized || normalized === '--') return null
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

// Sources report ROC dates such as 1151110; fall back to today when the field is absent or unrecognised.
function quoteDate(value: unknown, fallback: string): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  let year: number, rest: string
  if (digits.length === 8) { year = Number(digits.slice(0, 4)); rest = digits.slice(4) }
  else if (digits.length === 6 || digits.length === 7) { year = Number(digits.slice(0, -4)) + 1911; rest = digits.slice(-4) }
  else return fallback
  const date = `${year}-${rest.slice(0, 2)}-${rest.slice(2)}`
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) && date <= fallback ? date : fallback
}

async function fetchRows(url: string): Promise<QuoteRow[]> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Quote source responded ${response.status}`)
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('Quote source returned an invalid payload')
  return payload as QuoteRow[]
}

Deno.serve(async (request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return jsonResponse({ reason: 'invalid_request' }, 405)
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return jsonResponse({ reason: 'unauthorized' }, 401)

  const { data: stocks, error } = await admin.from('stocks').select('id,ticker,shares,valuation_amount,valuation_date').is('deleted_at', null).not('shares', 'is', null)
  if (error) return jsonResponse({ reason: 'load_failed' }, 500)
  if (!stocks?.length) return jsonResponse({ reason: 'no_stocks', updated: 0 })

  const today = taipeiToday()
  const tickers = new Set(stocks.map((stock) => String(stock.ticker).trim().toUpperCase()))
  const quotes = new Map<string, Quote>()
  const sourceErrors: string[] = []
  const applyRows = (rows: QuoteRow[], codeField: string, closeField: string) => {
    for (const row of rows) {
      const ticker = String(row[codeField] ?? '').trim().toUpperCase()
      if (!tickers.has(ticker) || quotes.has(ticker)) continue
      const close = positivePrice(row[closeField])
      if (close !== null) quotes.set(ticker, { close, date: quoteDate(row.Date, today) })
    }
  }
  try { applyRows(await fetchRows(TWSE_URL), 'Code', 'ClosingPrice') } catch { sourceErrors.push('twse') }
  if ([...tickers].some((ticker) => !quotes.has(ticker))) {
    try { applyRows(await fetchRows(TPEX_URL), 'SecuritiesCompanyCode', 'Close') } catch { sourceErrors.push('tpex') }
  }

  const stats = { updated: 0, unchanged: 0, missing: [] as string[], failed: 0 }
  for (const stock of stocks) {
    const ticker = String(stock.ticker).trim().toUpperCase()
    const quote = quotes.get(ticker)
    if (!quote) { if (!stats.missing.includes(ticker)) stats.missing.push(ticker); continue }
    const valuationAmount = Math.round(Number(stock.shares) * quote.close)
    // Never overwrite a manual valuation that is newer than the quote, and skip no-op writes.
    if (stock.valuation_date > quote.date || (stock.valuation_date === quote.date && Number(stock.valuation_amount) === valuationAmount)) { stats.unchanged += 1; continue }
    const { error: updateError } = await admin.from('stocks').update({ valuation_amount: valuationAmount, valuation_date: quote.date }).eq('id', stock.id).is('deleted_at', null)
    if (updateError) stats.failed += 1
    else stats.updated += 1
  }
  const reason = stats.failed || (sourceErrors.length && !stats.updated) ? 'partial_failure' : 'ok'
  return jsonResponse({ reason, ...stats, sourceErrors }, reason === 'ok' ? 200 : 502)
})
