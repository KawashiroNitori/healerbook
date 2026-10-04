// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import type { Composition } from '@/types/timeline'
import { getHealerJobs, getJobName } from '@/data/jobs'
import SettingsDialog from './SettingsDialog'

const mocks = vi.hoisted(() => ({
  composition: { players: [] } as Composition | undefined,
  isReadOnly: false,
  updateComposition: vi.fn(),
  setLevel: vi.fn(),
  updateEncounter: vi.fn(),
  updateStatData: vi.fn(),
  resolveActions: vi.fn(() => ({ actions: [] })),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useEditorReadOnly', () => ({ useEditorReadOnly: () => mocks.isReadOnly }))
vi.mock('@/data/resolveAction', () => ({ resolveActions: mocks.resolveActions }))
vi.mock('@/components/GameIcon', () => ({ GameIcon: () => null }))
vi.mock('@/store/timelineStore', () => ({
  useTimelineStore: (selector: (state: unknown) => unknown) =>
    selector({
      timeline: { level: 100, encounter: { id: 101 }, composition: mocks.composition },
      statistics: null,
      ...mocks,
    }),
}))
vi.mock('@/data/raidEncounters', () => {
  const encounters = [
    { id: 101, name: 'initial', shortName: 'initial', level: 100 },
    { id: 1, name: 'fixture', shortName: 'fixture', level: 70 },
  ]
  return {
    RAID_TIERS: [{ zone: 1, name: 'fixture', encounters }],
    getEncounterById: (id: number) => encounters.find(e => e.id === id),
  }
})
vi.mock('@/components/ui/select', () => {
  const Container = ({ children }: PropsWithChildren) => <>{children}</>
  return {
    Select: ({
      children,
      value,
      onValueChange,
      disabled,
    }: PropsWithChildren<{
      value: string
      onValueChange: (value: string) => void
      disabled?: boolean
    }>) => (
      <select value={value} disabled={disabled} onChange={e => onValueChange(e.target.value)}>
        {children}
      </select>
    ),
    SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => (
      <option value={value}>{children}</option>
    ),
    SelectContent: Container,
    SelectGroup: Container,
    SelectLabel: () => null,
    SelectTrigger: () => null,
    SelectValue: () => null,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.composition = { players: [] }
  mocks.isReadOnly = false
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function changeEncounter(id: string) {
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: id } })
}
function changeLevel(level: string) {
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: level } })
}

describe('SettingsDialog 草稿设置', () => {
  it('改绑与等级修改不会立即写入，取消后重开丢弃草稿', () => {
    const onClose = vi.fn()
    const { rerender } = render(<SettingsDialog open onClose={onClose} />)
    changeEncounter('1')
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('70')
    expect(mocks.resolveActions).toHaveBeenLastCalledWith(70)
    changeLevel('80')
    expect(mocks.updateEncounter).not.toHaveBeenCalled()
    expect(mocks.setLevel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('common:cancel'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(mocks.updateStatData).not.toHaveBeenCalled()
    rerender(<SettingsDialog open={false} onClose={onClose} />)
    // 淡出期间草稿仍显示；子元素动画结束不能提前卸载整个模态框。
    const levelSelect = screen.getAllByRole('combobox')[1]
    expect((levelSelect as HTMLSelectElement).value).toBe('80')
    fireEvent.transitionEnd(levelSelect)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    const backdrop = document.body.querySelector('.fixed.inset-0')!
    fireEvent.transitionEnd(backdrop)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    rerender(<SettingsDialog open onClose={onClose} />)
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('101')
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('100')
  })

  it('保存才提交改绑与用户最终选择的等级', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)
    changeEncounter('1')
    changeLevel('80')
    fireEvent.click(screen.getByText('editor:statData.save'))
    expect(mocks.updateEncounter).not.toHaveBeenCalled()
    expect(mocks.setLevel).not.toHaveBeenCalled()
    expect(mocks.updateStatData).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('editor:statData.save'))
    expect(mocks.updateEncounter).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.setLevel).toHaveBeenCalledExactlyOnceWith(80)
    expect(mocks.updateStatData).toHaveBeenCalledOnce()
  })

  it('解除绑定保留草稿等级，保存时使用副本 ID 0', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)
    changeLevel('90')
    changeEncounter('0')
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('90')
    expect(mocks.updateEncounter).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('editor:statData.save'))
    expect(mocks.updateEncounter).not.toHaveBeenCalled()
    expect(mocks.setLevel).not.toHaveBeenCalled()
    expect(mocks.updateStatData).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('editor:statData.save'))
    expect(mocks.updateEncounter).toHaveBeenCalledExactlyOnceWith(0)
    expect(mocks.setLevel).toHaveBeenCalledExactlyOnceWith(90)
  })

  it('等级变化使保存按钮变为危险色，取消二次确认保留草稿而不提交', () => {
    const onClose = vi.fn()
    render(<SettingsDialog open onClose={onClose} />)
    const save = screen.getByText('editor:statData.save')
    expect(save.classList.contains('bg-primary')).toBe(true)
    changeLevel('70')
    expect(save.classList.contains('bg-destructive')).toBe(true)
    fireEvent.click(save)
    const confirmation = screen.getByRole('alertdialog')
    expect(within(confirmation).getByText('editor:settings.levelChangeDescription')).toBeTruthy()
    fireEvent.click(within(confirmation).getByText('common:cancel'))
    expect(mocks.setLevel).not.toHaveBeenCalled()
    expect(mocks.updateStatData).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('70')
  })

  it('等级恢复原值时直接保存，不弹出二次确认', () => {
    render(<SettingsDialog open onClose={vi.fn()} />)
    changeEncounter('1')
    changeLevel('100')
    const save = screen.getByText('editor:statData.save')
    expect(save.classList.contains('bg-primary')).toBe(true)
    fireEvent.click(save)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.updateEncounter).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.setLevel).not.toHaveBeenCalled()
    expect(mocks.updateStatData).toHaveBeenCalledOnce()
  })

  it('阵容缺失时仍显示基本和安全血量设置，技能数值显示为空', () => {
    mocks.composition = undefined
    render(<SettingsDialog open onClose={vi.fn()} />)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getByText('editor:statData.safeHpTitle')).toBeTruthy()
    expect(screen.getByText('editor:statData.noActions')).toBeTruthy()
    fireEvent.click(screen.getByText('editor:statData.save'))
    expect(mocks.updateStatData).toHaveBeenCalledOnce()
  })

  it('阵容编辑保留为草稿，点击保存后才提交队员', () => {
    const job = getHealerJobs()[0]
    render(<SettingsDialog open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'editor:composition.adjustComposition' }))
    fireEvent.click(screen.getByRole('button', { name: getJobName(job) }))
    expect(screen.getByText('1/8')).toBeTruthy()
    expect(mocks.updateComposition).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('editor:statData.save'))
    expect(mocks.updateComposition).toHaveBeenCalledExactlyOnceWith({
      players: [{ id: expect.any(Number), job }],
    })
  })

  it('阵容最多八人，删除队员只更新草稿', () => {
    const job = getHealerJobs()[0]
    render(<SettingsDialog open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'editor:composition.adjustComposition' }))
    const add = screen.getByRole('button', { name: getJobName(job) })
    for (let i = 0; i < 9; i++) fireEvent.click(add)
    expect(screen.getByText('8/8')).toBeTruthy()
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'editor:composition.removeHint' })[0])
    expect(screen.getByText('7/8')).toBeTruthy()
    expect((add as HTMLButtonElement).disabled).toBe(false)
    expect(mocks.updateComposition).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('common:cancel'))
    expect(mocks.updateComposition).not.toHaveBeenCalled()
  })

  it('只读模式展示阵容但不能增删队员', () => {
    const job = getHealerJobs()[0]
    mocks.isReadOnly = true
    mocks.composition = { players: [{ id: 1, job }] }
    render(<SettingsDialog open onClose={vi.fn()} />)
    expect(screen.getByText('1/8')).toBeTruthy()
    expect(screen.queryByText('editor:composition.adjustComposition')).toBeNull()
    const remove = screen.getByRole('button', { name: getJobName(job) })
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(remove)
    expect(mocks.updateComposition).not.toHaveBeenCalled()
  })

  it('调整阵容默认折叠，展开后可添加，收起时保留当前阵容', () => {
    const job = getHealerJobs()[0]
    render(<SettingsDialog open onClose={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: 'editor:composition.adjustComposition' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: getJobName(job) })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: getJobName(job) }))
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'editor:composition.removeHint' })).toBeNull()
    expect(screen.getByText('1/8')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: getJobName(job) }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(mocks.updateComposition).not.toHaveBeenCalled()
  })

  it('已有队员在展开调整阵容后才允许删除', () => {
    const job = getHealerJobs()[0]
    mocks.composition = { players: [{ id: 1, job }] }
    render(<SettingsDialog open onClose={vi.fn()} />)
    const locked = screen.getByRole('button', { name: getJobName(job) })
    expect((locked as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(locked)
    expect(screen.getByText('1/8')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'editor:composition.adjustComposition' }))
    const remove = screen.getByRole('button', { name: 'editor:composition.removeHint' })
    expect((remove as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(remove)
    expect(screen.getByText('0/8')).toBeTruthy()
    expect(mocks.updateComposition).not.toHaveBeenCalled()
  })
})
