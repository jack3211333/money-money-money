// 驗證 Excel 報表：以假資料產生活頁簿、寫出再讀回，檢查工作表與關鍵數字。
// 執行：node scripts/verify-excel-report.ts [輸出路徑]
import ExcelJS from 'exceljs'
import { buildExcelReport } from '../src/lib/excelReport.ts'
import { financialTotals } from '../src/lib/finance.ts'

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message) }
const base = { user_id: 'u', updated_at: '', deleted_at: null }
const today = '2026-11-10'
const data = {
  accounts: [
    { ...base, id: 'a1', created_at: '2026-08-01T02:00:00Z', name: '國泰世華', kind: 'bank', icon_key: null, opening_balance: 100000, currency: 'TWD', is_archived: false, sort_order: 0 },
    { ...base, id: 'a2', created_at: '2026-08-01T02:00:00Z', name: '錢包', kind: 'cash', icon_key: null, opening_balance: 5000, currency: 'TWD', is_archived: false, sort_order: 1 },
  ],
  categories: [
    { ...base, id: 'c1', created_at: '', name: '飲食', direction: 'expense', color: '', icon_key: '', parent_id: null, sort_order: 0 },
    { ...base, id: 'c2', created_at: '', name: '午餐', direction: 'expense', color: '', icon_key: '', parent_id: 'c1', sort_order: 0 },
    { ...base, id: 'c3', created_at: '', name: '薪資', direction: 'income', color: '', icon_key: '', parent_id: null, sort_order: 0 },
    { ...base, id: 'c4', created_at: '', name: '舊分類', direction: 'expense', color: '', icon_key: '', parent_id: null, sort_order: 1, deleted_at: '2026-10-01' },
  ],
  transactions: [
    { ...base, id: 't1', created_at: '1', transaction_date: '2026-09-05', amount: 50000, kind: 'income', account_id: 'a1', category_id: 'c3', transfer_group_id: null, is_transfer_fee: false, note: '九月薪水' },
    { ...base, id: 't2', created_at: '2', transaction_date: '2026-09-06', amount: 120, kind: 'expense', account_id: 'a2', category_id: 'c2', transfer_group_id: null, is_transfer_fee: false, note: '便當' },
    { ...base, id: 't3', created_at: '3', transaction_date: '2026-10-01', amount: 3000, kind: 'transfer_out', account_id: 'a1', category_id: null, transfer_group_id: 'g1', is_transfer_fee: false, note: '提款' },
    { ...base, id: 't4', created_at: '3', transaction_date: '2026-10-01', amount: 3000, kind: 'transfer_in', account_id: 'a2', category_id: null, transfer_group_id: 'g1', is_transfer_fee: false, note: '提款' },
    { ...base, id: 't5', created_at: '3', transaction_date: '2026-10-01', amount: 15, kind: 'expense', account_id: 'a1', category_id: null, transfer_group_id: 'g1', is_transfer_fee: true, note: '' },
    { ...base, id: 't6', created_at: '4', transaction_date: '2026-11-02', amount: 800, kind: 'expense', account_id: 'a2', category_id: 'c4', transfer_group_id: null, is_transfer_fee: false, note: '' },
  ],
  quickTransactions: [{ ...base, id: 'q1', created_at: '', kind: 'expense', amount: 120, account_id: 'a2', category_id: 'c2', note: '便當' }],
  liabilities: [{ ...base, id: 'l1', created_at: '', name: '手機分期', kind: 'installment', principal: 12000, annual_rate_bps: 0, monthly_payment: 1000, term_months: 12, start_date: '2026-09-01' }],
  stocks: [{ ...base, id: 's1', created_at: '2026-09-10T02:00:00Z', account_id: null, ticker: '0050', shares: 1000, annual_return_bps: 800, valuation_amount: 200000, valuation_date: '2026-09-10' }],
  recurringRules: [{ ...base, id: 'r1', created_at: '', name: '房租', kind: 'expense', amount: 15000, category_id: null, interval_months: 1, day_of_month: 5, start_date: '2026-01-05', end_date: null, is_active: true }],
  investmentPlans: [{ ...base, id: 'p1', created_at: '', name: '0050 定投', stock_id: 's1', monthly_amount: 5000, day_of_month: 6, start_date: '2026-01-06', end_date: null, is_active: true }],
  forecastEvents: [{ ...base, id: 'f1', created_at: '', name: '年終', kind: 'income', amount: 60000, event_date: '2027-01-20' }],
  netWorthSnapshots: [
    { ...base, id: 'n1', created_at: '', snapshot_month: '2026-10-01', cash: 150000, stocks: 200000, liabilities: 11000, net_worth: 339000, is_estimated: true },
    { ...base, id: 'n2', created_at: '', snapshot_month: '2026-11-01', cash: 151000, stocks: 202000, liabilities: 10000, net_worth: 343000, is_estimated: false },
  ],
} as any

const workbook = buildExcelReport(data, { email: 'test@example.com', today, generatedAt: new Date('2026-11-10T04:00:00Z') })
const buffer = await workbook.xlsx.writeBuffer()
const output = process.argv[2]
if (output) await workbook.xlsx.writeFile(output)
const read = new ExcelJS.Workbook()
await read.xlsx.load(buffer as ArrayBuffer)

const expected = ['摘要', '月度收支', '支出分類分析', '收入分類分析', '交易明細', '帳戶', '股票', '負債', '固定收支', '持續投入', '一次性收支', '12個月推演', '淨資產紀錄', '分類設定', '快速記帳選項']
assert(JSON.stringify(read.worksheets.map((sheet) => sheet.name)) === JSON.stringify(expected), `sheets ${read.worksheets.map((sheet) => sheet.name)}`)

const find = (sheetName: string, label: string, column = 1) => {
  const sheet = read.getWorksheet(sheetName)!
  let found: ExcelJS.Row | undefined
  sheet.eachRow((row) => { if (!found && row.getCell(column).value === label) found = row })
  assert(!!found, `${sheetName} 找不到 ${label}`)
  return found!
}
const totals = financialTotals(data)
assert(find('摘要', '淨資產').getCell(2).value === Math.round(totals.netWorth), '摘要淨資產與 financialTotals 不一致')
assert(find('摘要', '總收入').getCell(2).value === 50000, '摘要總收入')
assert(find('摘要', '總支出').getCell(2).value === 935, '摘要總支出（含手續費）')

// 月度收支：10 月只有手續費 15（轉帳不計）。
assert(find('月度收支', '2026/10').getCell(3).value === 15, '10 月支出應只含手續費')
assert(find('月度收支', '合計').getCell(2).value === 50000, '月度收入合計')

// 交易明細：轉帳合併為一列，共 5 列＋合計。
const detail = read.getWorksheet('交易明細')!
const transfer = find('交易明細', '轉帳', 3)
assert(transfer.getCell(6).value === '國泰世華' && transfer.getCell(7).value === '錢包' && transfer.getCell(10).value === 3000, '轉帳列')
assert(find('交易明細', '支出（轉帳手續費）', 3).getCell(9).value === 15, '手續費列')
assert(find('交易明細', '合計').getCell(3).value === '5 筆', `交易筆數 ${detail.rowCount}`)
assert(find('交易明細', '2026-11-02').getCell(4).value === '舊分類', '已刪除分類名稱仍可對應')

// 帳戶餘額
assert(find('帳戶', '國泰世華').getCell(10).value === 100000 + 50000 - 3000 - 15, '國泰世華餘額')
assert(find('帳戶', '合計').getCell(10).value === Math.round(totals.cash), '帳戶合計')

// 支出分類：飲食 › 午餐 120，舊分類 800，未分類手續費 15。
assert(find('支出分類分析', '合計').getCell(15).value === 935, '支出分類合計')
assert(find('支出分類分析', '午餐', 2).getCell(15).value === 120, '午餐')

// 負債、推演、淨資產
assert(find('負債', '手機分期').getCell(11).value === Math.round(totals.liabilities), '負債餘額')
assert(read.getWorksheet('12個月推演')!.getRow(4).getCell(1).value === '2026/12', '推演第一個月')
assert(find('淨資產紀錄', '2026/11').getCell(6).value === 4000 && find('淨資產紀錄', '2026/10').getCell(8).value === '推算', '淨資產紀錄')
assert(!JSON.stringify(read.getWorksheet('分類設定')!.getSheetValues()).includes('舊分類'), '分類設定不應列出已刪除分類')
console.log('Excel 報表驗證通過', output ?? '')
