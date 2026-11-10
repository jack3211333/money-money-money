import { widgetSummary } from '../_shared/widget.ts'
import { admin } from '../_shared/push.ts'
import { jsonResponse, preflight } from '../_shared/cors.ts'

// iPhone 小工具（Scriptable）讀取：今日已支出、本月已支出、淨資產與較上月增減。只讀，不寫入任何資料。
Deno.serve(async (request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return jsonResponse({ reason: 'invalid_request' }, 405)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse({ reason: 'unauthorized' }, 401)
  try {
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return jsonResponse({ reason: 'unauthorized' }, 401)
    const tables = ['accounts', 'transactions', 'stocks', 'liabilities', 'net_worth_snapshots'] as const
    const results = await Promise.all(tables.map((table) => admin.from(table).select('*').eq('user_id', user.id).is('deleted_at', null)))
    if (results.some((result) => result.error)) return jsonResponse({ reason: 'query_failed' }, 500)
    const [accounts, transactions, stocks, liabilities, netWorthSnapshots] = results.map((result) => result.data ?? [])
    return jsonResponse(widgetSummary({ accounts, transactions, stocks, liabilities, netWorthSnapshots }))
  } catch {
    return jsonResponse({ reason: 'query_failed' }, 500)
  }
})
