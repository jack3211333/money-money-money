import type { FinanceSnapshot, Transaction } from './types'

export type PendingTransaction = Omit<Transaction, 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'> & { user_id: string; queued_at: string; account_name?: string; category_name?: string }
export type FailedTransaction = PendingTransaction & { failed_at: string; reason: string; read: boolean }

const DB = 'money-money-money-offline'
const VERSION = 1
const SNAPSHOTS = 'snapshots'
const PENDING = 'pending'
const FAILED = 'failed'

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB, VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    for (const name of [SNAPSHOTS, PENDING, FAILED]) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'key' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const key = (userId: string, id = 'snapshot') => `${userId}:${id}`
const run = async <T>(store: string, mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<T>) => {
  const database = await open()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(store, mode)
    const request = action(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => { database.close(); reject(transaction.error) }
  })
}

const list = async <T>(store: string, userId: string): Promise<T[]> => {
  const rows = await run<any[]>(store, 'readonly', (objectStore) => objectStore.getAll())
  return rows.filter((row) => row.user_id === userId).map(({ key: _key, ...row }) => row as T)
}

export const offlineStore = {
  async snapshot(userId: string) {
    const row = await run<any>(SNAPSHOTS, 'readonly', (store) => store.get(key(userId)))
    return row?.data as FinanceSnapshot | undefined
  },
  saveSnapshot: (userId: string, data: FinanceSnapshot) => run(SNAPSHOTS, 'readwrite', (store) => store.put({ key: key(userId), user_id: userId, data, saved_at: new Date().toISOString() })),
  pending: (userId: string) => list<PendingTransaction>(PENDING, userId),
  failed: (userId: string) => list<FailedTransaction>(FAILED, userId),
  addPending: (item: PendingTransaction) => run(PENDING, 'readwrite', (store) => store.put({ ...item, key: key(item.user_id, item.id) })),
  removePending: (userId: string, id: string) => run(PENDING, 'readwrite', (store) => store.delete(key(userId, id))),
  fail: async (item: PendingTransaction, reason: string) => {
    await run(FAILED, 'readwrite', (store) => store.put({ ...item, key: key(item.user_id, item.id), failed_at: new Date().toISOString(), reason, read: false }))
    await offlineStore.removePending(item.user_id, item.id)
  },
  markFailedRead: async (userId: string) => {
    const rows = await offlineStore.failed(userId)
    await Promise.all(rows.filter((row) => !row.read).map((row) => run(FAILED, 'readwrite', (store) => store.put({ ...row, key: key(userId, row.id), read: true }))))
  },
  removeFailed: (userId: string, id: string) => run(FAILED, 'readwrite', (store) => store.delete(key(userId, id))),
  async persist() { if ('storage' in navigator && navigator.storage.persist) await navigator.storage.persist() },
}
