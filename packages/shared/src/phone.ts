// 大陆手机号统一成 E.164（+86 开头），入库、比较、限额都用这一个键
const MAINLAND_MOBILE = /^1[3-9]\d{9}$/

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '')
  const bare = digits.startsWith('+86') ? digits.slice(3) : digits.startsWith('86') && digits.length === 13 ? digits.slice(2) : digits
  return MAINLAND_MOBILE.test(bare) ? `+86${bare}` : null
}

// 页面上只显示尾号
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)} ****${phone.slice(-4)}`
}

export const PHONE_ERROR_CODES = {
  PHONE_REQUIRED: '发言前先绑定手机号',
  SMS_UNAVAILABLE: '短信服务暂不可用',
  SMS_RATE_LIMITED: '验证码发得太频繁，稍后再试',
} as const

export const SMS_LIMITS = {
  cooldownSeconds: 60,
  perPhoneHourly: 5,
  perPhoneDaily: 10,
  perUserHourly: 5,
  perIpHourly: 30,
} as const
