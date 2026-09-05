export const VERSION_STATUS = {
  pending: { label: '审核中', variant: 'outline' },
  approved: { label: '已上架', variant: 'secondary' },
  rejected: { label: '未通过', variant: 'outline' },
} as const

export type VersionStatus = keyof typeof VERSION_STATUS
