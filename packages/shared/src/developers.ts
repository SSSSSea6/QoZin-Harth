import { z } from 'zod'

// 邀请码 10 位，字母表去掉易混的 0、O、1、I
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 10
export const INVITES_PER_DEVELOPER = 5
export const INVITE_VALID_DAYS = 30
export const INVITE_BATCH_MAX = 20
export const APPLICATION_MESSAGE_MAX = 500
export const APPLICATION_NOTE_MAX = 300

export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

export const inviteCodeSchema = z
  .string()
  .transform(normalizeInviteCode)
  .pipe(z.string().length(INVITE_CODE_LENGTH).regex(new RegExp(`^[${INVITE_CODE_ALPHABET}]+$`)))

export const applicationMessageSchema = z.string().trim().min(1).max(APPLICATION_MESSAGE_MAX)
