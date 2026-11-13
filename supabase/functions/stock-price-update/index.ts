import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse, preflight } from '../_shared/cors.ts'
import { fetchTwCloses } from '../_shared/twQuotes.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return jsonResponse({ reason: 'invalid_request' }, 405)
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return jsonResponse({ reason: 'unauthorized' }, 401)

  const { data: stocks, error } = await admin.from('stocks').select('id,ticker,shares,valuation_amount,valuation_date').is('deleted_at', null).not('shares', 'is', null)
  if (error) return jsonResponse({ reason: 'load_failed' }, 500)
  if (!stocks?.length) return jsonResponse({ reason: 'no_stocks', updated: 0 })

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
  const { quotes, sourceErrors } = await fetchTwCloses(stocks.map((stock) => String(stock.ticker)), today)

  const stats = { updated: 0, checked: 0, skipped: 0, missing: [] as string[], failed: 0 }
  const checkedAt = new Date().toISOString()
  for (const stock of stocks) {
    const ticker = String(stock.ticker).trim().toUpperCase()
    const quote = quotes.get(ticker)
    if (!quote) { if (!stats.missing.includes(ticker)) stats.missing.push(ticker); continue }
    // 不覆蓋估值日期較新的手動估值。
    if (stock.valuation_date > quote.date) { stats.skipped += 1; continue }
    const valuationAmount = Math.round(Number(stock.shares) * quote.close)
    const changed = stock.valuation_date !== quote.date || Number(stock.valuation_amount) !== valuationAmount
    // 數值未變仍記錄更新時間，代表已以最新收盤價確認。
    const { error: updateError } = await admin.from('stocks').update({ valuation_amount: valuationAmount, valuation_date: quote.date, price_updated_at: checkedAt }).eq('id', stock.id).is('deleted_at', null)
    if (updateError) stats.failed += 1
    else if (changed) stats.updated += 1
    else stats.checked += 1
  }
  const reason = stats.failed ? 'partial_failure' : 'ok'
  return jsonResponse({ reason, ...stats, sourceErrors, quotes: Object.fromEntries(quotes) }, reason === 'ok' ? 200 : 502)
})
