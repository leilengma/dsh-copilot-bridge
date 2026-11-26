/** Shared Copilot client identity; request-specific headers and Harness attribution stay at call sites. */
export const COPILOT_EDITOR_HEADERS = {
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const

export const COPILOT_USER_AGENT = 'GitHubCopilotChat/0.35.0'
