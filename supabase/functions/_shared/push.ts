import { ApplicationServer, PushMessageError, Urgency } from 'jsr:@negrel/webpush@0.5.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const base64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0))
const vapidKeys = async () => {
  const publicKey = base64url(Deno.env.get('VAPID_PUBLIC_KEY')!)
  const privateKey = base64url(Deno.env.get('VAPID_PRIVATE_KEY')!)
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw new Error('Invalid VAPID key format')
  const toBase64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const publicJwk = { kty: 'EC', crv: 'P-256', x: toBase64url(publicKey.slice(1, 33)), y: toBase64url(publicKey.slice(33)), ext: true, key_ops: ['verify'] }
  const privateJwk = { ...publicJwk, d: toBase64url(privateKey), key_ops: ['sign'] }
  const [publicCryptoKey, privateCryptoKey] = await Promise.all([
    crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
    crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
  ])
  return { publicKey: publicCryptoKey, privateKey: privateCryptoKey }
}
let applicationServer: Promise<ApplicationServer> | undefined
const getApplicationServer = () => applicationServer ??= (async () => ApplicationServer.new({ contactInformation: Deno.env.get('VAPID_SUBJECT')!, vapidKeys: await vapidKeys() }))()

export async function userSnapshot(userId: string) {
  const tables = ['transactions', 'recurring_rules', 'forecast_events', 'liabilities', 'investment_plans', 'stocks'] as const
  const results = await Promise.all(tables.map((table) => admin.from(table).select('*').eq('user_id', userId).is('deleted_at', null)))
  for (const result of results) if (result.error) throw result.error
  const [transactions, recurringRules, forecastEvents, liabilities, investmentPlans, stocks] = results.map((result) => result.data ?? [])
  return { transactions, recurringRules, forecastEvents, liabilities, investmentPlans, stocks }
}

export async function send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: object) {
  try {
    const server = await getApplicationServer()
    await server.subscribe({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }).pushTextMessage(JSON.stringify(payload), { ttl: 3600, urgency: Urgency.High, topic: (payload as { tag?: string }).tag })
    return 'sent' as const
  } catch (error) {
    const statusCode = error instanceof PushMessageError ? error.response.status : (error as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) return 'expired' as const
    throw error
  }
}

export async function recordDelivery(id: string, result: 'sent' | 'expired') {
  const update = result === 'expired'
    ? { deleted_at: new Date().toISOString() }
    : { last_success_at: new Date().toISOString() }
  const { error } = await admin.from('push_subscriptions').update(update).eq('id', id).is('deleted_at', null)
  if (error) throw error
}

export const money = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
