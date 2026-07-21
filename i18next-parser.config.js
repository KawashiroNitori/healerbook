/** @type {import('i18next-parser').UserConfig} */
export default {
  locales: ['zh-CN'],
  defaultNamespace: 'common',
  namespaceSeparator: ':',
  keySeparator: '.',
  input: ['src/**/*.{ts,tsx}'],
  output: 'src/i18n/locales/$LOCALE/$NAMESPACE.json',
  sort: true,
  // 源语言文案由人手写进 catalog；parser 仅负责新增 key，新 key 默认空串。
  // 手写文案的插值一律用 ICU 单花括号 `{name}`——运行时挂了 i18next-icu，
  // i18next 原生的 `{{name}}` 不会被解析，会原样显示给用户。
  defaultValue: '',
  // P1 用 true：避免经 i18n.t(...) 引用（lexer 可能识别不到）的 key 被误删
  keepRemoved: true,
}
