// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { ACTIONS } from '@/data/mitigationActions'
import { useFilterStore } from '@/store/filterStore'
import { getJobName, ROLE_LABELS } from '@/data/jobs'
import type { FilterPreset } from '@/types/filter'
import type { Job } from '@/data/jobs'
import EditPresetDialog from './EditPresetDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// uiStore.ts 顶层引入 src/i18n（会 .use(initReactI18next) 触发真实 i18n 初始化），
// 与上面对 react-i18next 的整体 mock 冲突；GameIcon 需要 iconLearned 字段，
// 参照 LanguageToggle.test.tsx / TranslationBanner.test.tsx 的既有写法直接 mock 该 store。
vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: { iconLearned: string; locale: string }) => unknown) =>
    sel({ iconLearned: 'cafemaker', locale: 'zh-CN' }),
}))

// 模拟「90 级下医养（37010，minLevel 96）不可见」：其余数据沿用真实 ACTIONS，
// 只精确摘掉这一个 id，贴近 resolveActions(90) 的真实过滤结果——
// EditPresetDialog 全选/取消全选批量写回时绝不能把这类不可见 id 从预设里删掉。
const HIDDEN_ACTION_ID = 37010
const visibleAtLevel90 = ACTIONS.filter(a => a.id !== HIDDEN_ACTION_ID)

vi.mock('@/hooks/useResolvedActions', () => ({
  useResolvedActions: () => ({
    actions: visibleAtLevel90,
    actionMap: new Map(visibleAtLevel90.map(a => [a.id, a])),
  }),
}))

// 与组件内 visibleActions 的去重规则保持一致（同 trackGroup 只保留代表 action）
const dedupedVisible = visibleAtLevel90.filter(a => !a.trackGroup || a.trackGroup === a.id)
const visibleIdsOf = (job: Job) => dedupedVisible.filter(a => a.jobs.includes(job)).map(a => a.id)
const whmVisibleActionIds = visibleIdsOf('WHM')

function makePreset(selectedActionsByJob: Partial<Record<Job, number[]>>): FilterPreset {
  return {
    kind: 'custom',
    id: 'custom:test-preset',
    name: 'test-preset',
    rule: { selectedActionsByJob },
  }
}

function getSavedRule(presetId: string) {
  const preset = useFilterStore
    .getState()
    .customPresets.find(p => p.id === presetId && p.kind === 'custom')
  if (!preset || preset.kind !== 'custom') throw new Error('preset not found after save')
  return preset.rule
}

/** 职业行内只有一个按钮（全选/取消全选），按职业名文本定位其所在行再取按钮，避免全局同名按钮引发歧义 */
function getJobRowToggleButton(job: Job): HTMLElement {
  const row = screen.getByText(getJobName(job)).closest('div')
  if (!row) throw new Error(`job row not found for ${job}`)
  return within(row).getByRole('button')
}

/** 角色分组表头有两个按钮（展开折叠 trigger + 全选/取消全选），按角色标题文本定位表头行后精确取后者 */
function getRoleHeaderToggleButton(roleLabel: string): HTMLElement {
  const heading = screen.getByText(roleLabel)
  const header = heading.closest('.justify-between')
  if (!header) throw new Error(`role header not found for ${roleLabel}`)
  return within(header as HTMLElement).getByRole('button', {
    name: /editPreset\.(select|deselect)All/,
  })
}

describe('EditPresetDialog 等级过滤下的批量全选/取消全选', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
  })

  it('取消全选：不可见的历史选中 actionId（37010）保留在预设里', () => {
    // WHM 当前可见技能全选 + 37010（不可见，来自之前更高等级下的选择）
    const preset = makePreset({ WHM: [...whmVisibleActionIds, HIDDEN_ACTION_ID] })
    useFilterStore.setState({ customPresets: [preset] })

    render(<EditPresetDialog open onClose={() => {}} preset={preset} />)

    // 当前可见项已全选，WHM 行按钮此刻应显示"取消全选"
    const toggleBtn = getJobRowToggleButton('WHM')
    expect(toggleBtn.textContent).toBe('editor:editPreset.deselectAll')
    fireEvent.click(toggleBtn)
    fireEvent.click(screen.getByRole('button', { name: 'editor:editPreset.save' }))

    const rule = getSavedRule(preset.id)
    const saved = rule.selectedActionsByJob.WHM ?? []
    // 可见项被取消全选清空
    expect(whmVisibleActionIds.every(id => !saved.includes(id))).toBe(true)
    // 不可见的历史 id 必须原样保留，不能被批量写回清掉
    expect(saved).toEqual([HIDDEN_ACTION_ID])
  })

  it('全选：可见项与不可见历史项都在，且不重复写入', () => {
    // WHM 只选中了不可见的 37010，可见项均未选中
    const preset = makePreset({ WHM: [HIDDEN_ACTION_ID] })
    useFilterStore.setState({ customPresets: [preset] })

    render(<EditPresetDialog open onClose={() => {}} preset={preset} />)

    // 可见项未全选，WHM 行按钮此刻应显示"全选"
    const toggleBtn = getJobRowToggleButton('WHM')
    expect(toggleBtn.textContent).toBe('editor:editPreset.selectAll')
    fireEvent.click(toggleBtn)
    fireEvent.click(screen.getByRole('button', { name: 'editor:editPreset.save' }))

    const rule = getSavedRule(preset.id)
    const saved = rule.selectedActionsByJob.WHM ?? []
    // 可见项全部写入
    expect(whmVisibleActionIds.every(id => saved.includes(id))).toBe(true)
    // 不可见历史项保留
    expect(saved.includes(HIDDEN_ACTION_ID)).toBe(true)
    // 恰好是「可见集合 + 一个隐藏项」，没有重复 id（锁住 hiddenSelectedIds 与 jobActionIds 互斥的不变量）
    expect(saved).toHaveLength(whmVisibleActionIds.length + 1)
    expect(new Set(saved).size).toBe(saved.length)
  })

  it('按职能批量取消全选：同批次内每个职业各自保留自己不可见的历史项', () => {
    // 治疗职能四个职业的可见项都全选，其中只有 WHM 额外带一个不可见的历史项
    const preset = makePreset({
      WHM: [...whmVisibleActionIds, HIDDEN_ACTION_ID],
      AST: [...visibleIdsOf('AST')],
      SGE: [...visibleIdsOf('SGE')],
      SCH: [...visibleIdsOf('SCH')],
    })
    useFilterStore.setState({ customPresets: [preset] })

    render(<EditPresetDialog open onClose={() => {}} preset={preset} />)

    // 治疗职能整体已全选，表头按钮此刻应显示"取消全选"
    const roleToggleBtn = getRoleHeaderToggleButton(ROLE_LABELS.healer)
    expect(roleToggleBtn.textContent).toBe('editor:editPreset.deselectAll')
    fireEvent.click(roleToggleBtn)
    fireEvent.click(screen.getByRole('button', { name: 'editor:editPreset.save' }))

    const rule = getSavedRule(preset.id)
    // WHM 的不可见历史项被保留，可见项被清空
    expect(rule.selectedActionsByJob.WHM).toEqual([HIDDEN_ACTION_ID])
    // 其余职业没有不可见历史项，取消全选后应清空为空
    expect(rule.selectedActionsByJob.AST ?? []).toEqual([])
    expect(rule.selectedActionsByJob.SGE ?? []).toEqual([])
    expect(rule.selectedActionsByJob.SCH ?? []).toEqual([])
  })
})

describe('EditPresetDialog 新建预设的默认全选不受当前等级过滤污染', () => {
  beforeEach(() => {
    localStorage.clear()
    useFilterStore.setState({ customPresets: [], activeFilterId: 'builtin:all' })
  })

  it('90 级时间轴新建预设：defaultSelectedAll 仍包含当前等级不可见的医养（37010）', () => {
    // preset 为 undefined → 走新建路径，selectedActionsByJob 初值取 defaultSelectedAll。
    // useResolvedActions 被 mock 成「90 级视角」（不含 37010），若 defaultSelectedAll
    // 误用了按等级过滤后的 actionsByJob，WHM 数组会缺 37010——切回 100 级或换到另一条
    // 100 级时间轴复用该预设时，医养轨道会被永久隐藏。
    render(<EditPresetDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('editor:editPreset.namePlaceholder'), {
      target: { value: '新预设' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'editor:editPreset.save' }))

    const preset = useFilterStore.getState().customPresets[0]
    if (!preset || preset.kind !== 'custom') throw new Error('preset not found after save')
    expect(preset.rule.selectedActionsByJob.WHM ?? []).toContain(HIDDEN_ACTION_ID)
  })
})
