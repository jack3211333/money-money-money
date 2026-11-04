import { dailyBudget } from '../_shared/budget.ts'
import { admin, money, recordDelivery, send, userSnapshot } from '../_shared/push.ts'
import { jsonResponse, preflight } from '../_shared/cors.ts'

Deno.serve(async (request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return jsonResponse({ reason: 'invalid_request' }, 405)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse({ reason: 'unauthorized' }, 401)
  try {
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return jsonResponse({ reason: 'unauthorized' }, 401)
    const budget = dailyBudget(await userSnapshot(user.id))
    const { data: subscriptions, error } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', user.id).is('deleted_at', null)
    if (error) return jsonResponse({ reason: 'push_failed', statusCode: 500 }, 500)
    if (!subscriptions?.length) return jsonResponse({ reason: 'no_subscription' })
    let sent = 0
    let failed = 0
    const statusCodes: number[] = []
    for (const subscription of subscriptions ?? []) {
      try {
        const body = budget.planned === 0 ? '測試通知：推播已連通' : `測試通知：今日可支出 $${money(budget.quota)}`
        const result = await send(subscription, { title: '每日可支出', body, tag: 'budget-test' })
        if (result.status === 'failed') { failed += 1; statusCodes.push(result.statusCode); continue }
        await recordDelivery(subscription.id, result.status)
        if (result.status === 'sent') sent += 1
        else { failed += 1; statusCodes.push(410) }
      } catch { failed += 1; statusCodes.push(500) }
    }
    if (sent > 0) return jsonResponse({ reason: 'sent', sent, failed, statusCodes })
    return jsonResponse({ reason: 'push_failed', statusCode: statusCodes[0] ?? 500, sent, failed, statusCodes }, 502)
  } catch {
    return jsonResponse({ reason: 'push_failed', statusCode: 500 }, 500)
  }
})
