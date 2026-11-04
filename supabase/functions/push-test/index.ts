import { dailyBudget } from '../_shared/budget.ts'
import { admin, money, recordDelivery, send, userSnapshot } from '../_shared/push.ts'

Deno.serve(async (request) => {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const budget = dailyBudget(await userSnapshot(user.id))
    if (budget.planned === 0) return Response.json({ error: '尚未設定推演' }, { status: 400 })
    const { data: subscriptions, error } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', user.id).is('deleted_at', null)
    if (error) throw error
    let sent = 0
    for (const subscription of subscriptions ?? []) {
      try {
        const result = await send(subscription, { title: '每日可支出', body: `測試通知:今日可支出 $${money(budget.quota)}`, tag: 'budget-test' })
        await recordDelivery(subscription.id, result)
        if (result === 'sent') sent += 1
      } catch { /* Continue to the user's remaining active subscriptions. */ }
    }
    return Response.json({ sent })
  } catch { return Response.json({ error: '無法傳送測試通知' }, { status: 500 }) }
})
