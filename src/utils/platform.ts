/**
 * 平台相关工具：用于快捷键显示等 UI 场景
 */

export const isMac =
  // @ts-expect-error userAgentData is not yet in all TS lib types
  navigator.userAgentData?.platform === 'macOS' || /Mac/.test(navigator.platform)

/** 用于拼接在单字母后的组合键前缀，如 `{modKey}C` → "⌘C" / "Ctrl+C" */
export const modKey = isMac ? '⌘' : 'Ctrl+'

/** 单独按键标签（供 Kbd 组件使用） */
export const modKeyLabel = isMac ? '⌘' : 'Ctrl'
export const shiftKeyLabel = isMac ? '⇧' : 'Shift'
export const deleteKeyLabel = isMac ? '⌫' : 'Del'
