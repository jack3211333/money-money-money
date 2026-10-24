/* eslint-disable react/only-export-components -- the shared account icon registry and renderer intentionally live together */
import { Wallet } from 'lucide-react'

export const accountIconOptions = [
  { key: 'account-icon-1', src: '/account-icons/account-icon-1.png' },
  { key: 'account-icon-2', src: '/account-icons/account-icon-2.png' },
  { key: 'account-icon-3', src: '/account-icons/account-icon-3.png' },
  { key: 'account-icon-4', src: '/account-icons/account-icon-4.png' },
  { key: 'account-icon-5', src: '/account-icons/account-icon-5.png' },
  { key: 'account-icon-6', src: '/account-icons/account-icon-6.png' },
  { key: 'account-icon-7', src: '/account-icons/account-icon-7.png' },
  { key: 'account-icon-8', src: '/account-icons/account-icon-8.png' },
  { key: 'account-icon-9', src: '/account-icons/account-icon-9.png' },
  { key: 'account-icon-10', src: '/account-icons/account-icon-10.png' },
  { key: 'account-icon-11', src: '/account-icons/account-icon-11.png' },
  { key: 'account-icon-12', src: '/account-icons/account-icon-12.png' },
  { key: 'account-icon-13', src: '/account-icons/account-icon-13.png' },
]

const iconMap = new Map(accountIconOptions.map(({ key, src }) => [key, src]))

export function AccountIcon({ iconKey, size = 34 }: { iconKey: string | null | undefined; size?: number }) {
  const src = iconKey ? iconMap.get(iconKey) : undefined
  return <span className="account-icon" style={{ width: size, height: size }} aria-hidden="true">
    {src ? <img src={src} alt="" width={size} height={size} /> : <Wallet size={Math.round(size * .58)} strokeWidth={2} />}
  </span>
}
