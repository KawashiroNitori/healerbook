import { defineConfig } from 'vitepress'
import { withSidebar } from 'vitepress-sidebar'

const vitePressConfig = defineConfig({
  title: 'Healerbook',
  description: 'FF14 减伤规划工具',
  lang: 'zh-CN',
  base: '/docs/',
  outDir: '../dist/docs',
  cleanUrls: true,

  themeConfig: {
    nav: [],

    outline: {
      label: ' ',
      level: [2, 3],
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',

    socialLinks: [{ icon: 'github', link: 'https://github.com/KawashiroNitori/healerbook' }],
  },
})

export default withSidebar(vitePressConfig, {
  documentRootPath: '/docs',
  useTitleFromFrontmatter: true,
  sortMenusByFrontmatterOrder: true,
  sortFolderTo: 'bottom',
  excludeByGlobPattern: ['index.md'],
  excludeFilesByFrontmatterFieldName: 'exclude',
  collapsed: false,
  useFolderTitleFromIndexFile: true,
  useFolderLinkFromIndexFile: false,
})
