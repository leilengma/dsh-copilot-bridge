import { useSyncExternalStore } from 'react'
import type { LocaleRuntime } from './harness.ts'

/** Locale namespace the dictionaries are registered under. */
export const LOCALE_NS = 'copilot-bridge'

const EN = {
  nav: 'GitHub Copilot',
  title: 'GitHub Copilot',
  intro: 'Sign in with the GitHub OAuth device flow, on github.com or your GitHub Enterprise host. The plugin stores the long-lived OAuth credential; the Harness route refreshes short-lived Copilot tokens and discovers the models available to your account.',
  signedIn: 'Signed in',
  pending: 'Waiting for GitHub authorization',
  signedOut: 'Signed out',
  signIn: 'Sign in to GitHub Copilot',
  requesting: 'Requesting…',
  waiting: 'Waiting for authorization…',
  signOut: 'Sign out',
  processing: 'Processing…',
  refresh: 'Refresh status',
  pendingIntro: 'Open the GitHub device page and enter this code:',
  deviceCode: 'Device code',
  copyCode: 'Copy code',
  copied: 'Copied',
  pendingHint: 'This page updates automatically after authorization. You never need to paste a token here.',
  signedInAt: 'Signed in at {host}.',
  hiddenModelsTitle: 'Model visibility',
  modelListPending: 'The model list appears after the first request to the github-copilot provider.',
  modelCounts: '{available} available, {hidden} hidden',
  modelsShowing: ', showing {shown}',
  filterModels: 'Filter models',
  clearModelFilter: 'Clear model filter',
  hideModel: 'Hide {id}',
  noMatchingModels: 'No matching models',
  hiddenModelsReadOnly: 'This profile cannot save settings from here (no settings service or profile entry). Set hiddenModels in the profile\'s cordis.patch.yml instead.',
  hiddenModelsWarning: 'Hiding a model in use makes its session\'s next request fail with UNKNOWN_MODEL; its picker will show “Select model”.',
  whereToSelect: 'Signing in publishes the credential to the "{provider}" provider. Pick a model there under Settings → Models.',
  commandHint: 'The /copilot-login, /copilot-status, and /copilot-logout commands remain available on chat surfaces.',
  pluginVersion: 'Plugin version:',
  hostTitle: 'GitHub host',
  hostIntro: 'Sign-in targets {host}. Enter your GitHub Enterprise URL (for example https://<company>.ghe.com/) to sign in there instead. The value is saved in this profile\'s configuration file.',
  hostLabel: 'GitHub Enterprise URL',
  hostPlaceholder: 'https://<company>.ghe.com/',
  saveHost: 'Save',
  saving: 'Saving…',
  resetHost: 'Use github.com',
  hostSaved: 'Saved. Sign-in now targets {host}.',
  hostMismatch: 'The stored credential was issued by {signedIn}, but the configured host is {host}. Sign out and sign in again to switch.',
  hostReadOnly: 'This profile cannot save settings from here (no settings service or profile entry). Set enterpriseUrl in the profile\'s cordis.patch.yml instead.',
  loginDialogTitle: 'Sign in to GitHub Copilot',
  loginDialogDescription: 'Open the GitHub device page, then enter the device code below.',
  openGitHub: 'Open GitHub',
  close: 'Close',
  logoutOption: 'Sign out of GitHub Copilot',
  logoutOptionDetail: 'Remove the GitHub OAuth credential stored on this device',
  logoutConfirmTitle: 'Sign out of GitHub Copilot?',
  logoutConfirmDescription: 'This removes the OAuth credential stored on this device. Provider configuration is kept. You can sign in again later.',
  logoutAcknowledge: 'I understand and want to sign out of GitHub Copilot',
  cancel: 'Cancel',
  logoutConfirm: 'Sign out',
  sessionUnavailable: 'The current session is not ready.',
  logoutFailed: 'GitHub Copilot sign-out failed: {message}',
  commandUnavailable: 'The Host does not provide /copilot-logout.',
  cardSignedIn: 'Signed in to GitHub Copilot at {host} via dsh-copilot-bridge. No API key needed; the stored sign-in is used.',
  cardApply: 'Leave the API key field empty and click {apply}.',
  cardSignedOut: 'No API key needed: sign in under Settings → GitHub Copilot, then leave the API key field empty.',
  modelsApply: 'Apply',
} as const

export type TextKey = keyof typeof EN
type Dictionary = Readonly<Record<TextKey, string>>

const ZH: Dictionary = {
  nav: 'GitHub Copilot',
  title: 'GitHub Copilot',
  intro: '通过 GitHub OAuth 设备码登录 github.com 或你的 GitHub Enterprise 主机。插件会保存长期 OAuth 凭据；Harness 路由会自动刷新短期 Copilot token，并动态发现当前账号可用的模型。',
  signedIn: '已登录',
  pending: '等待 GitHub 授权',
  signedOut: '未登录',
  signIn: '登录 GitHub Copilot',
  requesting: '正在请求…',
  waiting: '等待授权…',
  signOut: '退出登录',
  processing: '处理中…',
  refresh: '刷新状态',
  pendingIntro: '请打开 GitHub 设备登录页面，然后输入下面的设备码：',
  deviceCode: '设备码',
  copyCode: '复制设备码',
  copied: '已复制',
  pendingHint: '完成授权后本页会自动更新；无需在此粘贴任何 token。',
  signedInAt: '已在 {host} 登录。',
  hiddenModelsTitle: '模型可见性',
  modelListPending: '首次请求 github-copilot 提供方后将显示模型列表。',
  modelCounts: '{available} 个可用，{hidden} 个已隐藏',
  modelsShowing: '，显示 {shown} 个',
  filterModels: '筛选模型',
  clearModelFilter: '清除模型筛选',
  hideModel: '隐藏 {id}',
  noMatchingModels: '没有匹配的模型',
  hiddenModelsReadOnly: '此配置档无法在这里保存设置（缺少设置服务或配置条目）。请在配置档的 cordis.patch.yml 中设置 hiddenModels。',
  hiddenModelsWarning: '隐藏正在使用的模型将导致该会话的下次请求报 UNKNOWN_MODEL，模型选择器将显示“选择模型”。',
  whereToSelect: '登录后凭据会发布给 "{provider}" 提供方。请到设置 → 模型 中选择该提供方下的模型。',
  commandHint: '聊天界面仍可使用 /copilot-login、/copilot-status 和 /copilot-logout。',
  pluginVersion: '插件版本：',
  hostTitle: 'GitHub 主机',
  hostIntro: '当前登录目标为 {host}。输入你的 GitHub Enterprise 地址（例如 https://<company>.ghe.com/）即可改为在该主机登录。该值保存在此配置档的配置文件中。',
  hostLabel: 'GitHub Enterprise 地址',
  hostPlaceholder: 'https://<company>.ghe.com/',
  saveHost: '保存',
  saving: '正在保存…',
  resetHost: '使用 github.com',
  hostSaved: '已保存。登录目标现为 {host}。',
  hostMismatch: '已保存的凭据来自 {signedIn}，但当前配置的主机是 {host}。请退出并重新登录以切换。',
  hostReadOnly: '此配置档无法在这里保存设置（缺少设置服务或配置条目）。请在配置档的 cordis.patch.yml 中设置 enterpriseUrl。',
  loginDialogTitle: '登录 GitHub Copilot',
  loginDialogDescription: '打开 GitHub 设备登录页面，然后输入下面的设备码。',
  openGitHub: '打开 GitHub',
  close: '关闭',
  logoutOption: '退出 GitHub Copilot',
  logoutOptionDetail: '删除本机保存的 GitHub OAuth 凭据',
  logoutConfirmTitle: '确认退出 GitHub Copilot？',
  logoutConfirmDescription: '退出后将删除本机保存的 OAuth 凭据，保留提供方配置。以后仍可重新登录。',
  logoutAcknowledge: '我确认要退出 GitHub Copilot',
  cancel: '取消',
  logoutConfirm: '退出登录',
  sessionUnavailable: '当前会话尚未就绪。',
  logoutFailed: 'GitHub Copilot 退出失败：{message}',
  commandUnavailable: '当前 Host 没有提供 /copilot-logout 命令。',
  cardSignedIn: '已通过 dsh-copilot-bridge 在 {host} 登录 GitHub Copilot。无需 API 密钥，将使用已保存的登录凭据。',
  cardApply: '请将 API 密钥留空，直接点击「{apply}」。',
  cardSignedOut: '无需 API 密钥：请先在 设置 → GitHub Copilot 中登录，然后将 API 密钥留空。',
  modelsApply: '保存',
}

export const DICTIONARIES: Readonly<Record<'en' | 'zh', Dictionary>> = { en: EN, zh: ZH }

let runtime: LocaleRuntime | undefined

/** Bind the Harness locale runtime; called once from `apply`. */
export function bindLocale(locale: LocaleRuntime): void {
  runtime = locale
}

/** Localized text with `{name}` placeholders filled; unknown locales fall back to English. */
export function text(key: TextKey, params?: Readonly<Record<string, string | number>>): string {
  const template = (runtime?.getSnapshot().active === 'zh' ? ZH : EN)[key]
  if (params === undefined) return template
  return template.replace(/\{([^}]+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const subscribe = (listener: () => void) => runtime?.subscribe(listener) ?? (() => {})
const revision = () => runtime?.getSnapshot().revision ?? 0

/** Re-render the calling component when the active locale changes. */
export function useLocaleRevision(): void {
  useSyncExternalStore(subscribe, revision, () => 0)
}
