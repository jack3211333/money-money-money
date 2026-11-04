import { dailyBudget } from '../_shared/budget.ts'
import { admin, money, recordDelivery, send, userSnapshot } from '../_shared/push.ts'

Deno.serve(async (request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let kind: 'morning' | 'evening'
  try {
    const body = await request.json()
    if (body.kind !== 'morning' && body.kind !== 'evening') return Response.json({ error: 'Invalid kind' }, { status: 400 })
    kind = body.kind
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { data: subscriptions, error } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').is('deleted_at', null)
  if (error) return Response.json({ error: 'Could not load subscriptions' }, { status: 500 })
  const stats = { sent: 0, skipped: 0, failed: 0 }
  for (const subscription of subscriptions ?? []) {
    try {
      const budget = dailyBudget(await userSnapshot(subscription.user_id))
      if (budget.planned === 0) { stats.skipped += 1; continue }
      const title = kind === 'morning' ? '今日可支出' : '今日支出情況'
      const body = kind === 'morning'
        ? `今日可支出: $${money(budget.quota)}`
        : budget.quota === 0
          ? budget.spentToday === 0 ? '今日支出情況: 0%' : '今日支出情況: 已超出額度'
          : `今日支出情況: ${Math.round(budget.spentToday / budget.quota * 100)}%`
      const result = await send(subscription, { title, body, tag: kind === 'morning' ? 'budget-morning' : 'budget-evening' })
      await recordDelivery(subscription.id, result)
      if (result === 'sent') stats.sent += 1
      else stats.skipped += 1
    } catch { stats.failed += 1 }
  }
  return Response.json(stats)
})
