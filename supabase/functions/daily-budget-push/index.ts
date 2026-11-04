import { dailyBudget } from '../_shared/budget.ts'
import { admin, money, recordDelivery, send, userSnapshot } from '../_shared/push.ts'
import { jsonResponse, preflight } from '../_shared/cors.ts'

Deno.serve(async (request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return jsonResponse({ reason: 'invalid_request' }, 405)
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return jsonResponse({ reason: 'unauthorized' }, 401)
  let kind: 'morning' | 'evening'
  try {
    const body = await request.json()
    if (body.kind !== 'morning' && body.kind !== 'evening') return jsonResponse({ reason: 'invalid_request' }, 400)
    kind = body.kind
  } catch { return jsonResponse({ reason: 'invalid_request' }, 400) }
  let subscriptions: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[] | null
  let error: { message: string } | null
  try {
    const result = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').is('deleted_at', null)
    subscriptions = result.data
    error = result.error
  } catch { return jsonResponse({ reason: 'push_failed', statusCode: 500, sent: 0, skipped: 0, failed: 1 }, 500) }
  if (error) return jsonResponse({ reason: 'push_failed', statusCode: 500, sent: 0, skipped: 0, failed: 1 }, 500)
  if (!subscriptions?.length) return jsonResponse({ reason: 'no_subscription', sent: 0, skipped: 0, failed: 0 })
  const stats = { sent: 0, skipped: 0, failed: 0, plannedZero: 0, statusCodes: [] as number[] }
  for (const subscription of subscriptions ?? []) {
    try {
      const budget = dailyBudget(await userSnapshot(subscription.user_id))
      if (budget.planned === 0) { stats.skipped += 1; stats.plannedZero += 1; continue }
      const title = kind === 'morning' ? '今日可支出' : '今日支出情況'
      const body = kind === 'morning'
        ? `今日可支出: $${money(budget.quota)}`
        : budget.quota === 0
          ? budget.spentToday === 0 ? '今日支出情況: 0%' : '今日支出情況: 已超出額度'
          : `今日支出情況: ${Math.round(budget.spentToday / budget.quota * 100)}%`
      const result = await send(subscription, { title, body, tag: kind === 'morning' ? 'budget-morning' : 'budget-evening' })
      if (result.status === 'failed') { stats.failed += 1; stats.statusCodes.push(result.statusCode); continue }
      await recordDelivery(subscription.id, result.status)
      if (result.status === 'sent') stats.sent += 1
      else stats.skipped += 1
    } catch { stats.failed += 1; stats.statusCodes.push(500) }
  }
  const reason = stats.sent > 0 ? 'sent' : stats.failed > 0 ? 'push_failed' : stats.plannedZero > 0 ? 'planned_zero' : 'no_subscription'
  return jsonResponse({ reason, sent: stats.sent, skipped: stats.skipped, failed: stats.failed, statusCodes: stats.statusCodes })
})
