/**
 * 工具栏上的"过滤"下拉菜单入口。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { useFilterStore, BUILTIN_PRESETS } from '@/store/filterStore'
import { presetLabel } from './presetLabel'
import ManagePresetsDialog from './ManagePresetsDialog'
import { track } from '@/utils/analytics'

export default function FilterMenu() {
  const { t } = useTranslation(['editor', 'common'])
  const activeFilterId = useFilterStore(s => s.activeFilterId)
  const setActiveFilter = useFilterStore(s => s.setActiveFilter)
  const customPresets = useFilterStore(s => s.customPresets)
  const activePreset =
    [...BUILTIN_PRESETS, ...customPresets].find(p => p.id === activeFilterId) ?? BUILTIN_PRESETS[0]

  const [menuOpen, setMenuOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const handleChange = (id: string) => {
    track('filter-change', { name: id })
    setActiveFilter(id)
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip open={menuOpen ? false : tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                <Filter className="w-4 h-4 shrink-0" />
                <span className="text-xs max-w-[8rem] truncate">
                  {presetLabel(activePreset, t)}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('filterMenu.tooltip')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuRadioGroup value={activeFilterId} onValueChange={handleChange}>
            {BUILTIN_PRESETS.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {presetLabel(p, t)}
              </DropdownMenuRadioItem>
            ))}
            {customPresets.length > 0 && <DropdownMenuSeparator />}
            {customPresets.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {presetLabel(p, t)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              track('filter-preset-manage-open')
              setManageOpen(true)
            }}
          >
            {t('filterMenu.customize')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {manageOpen && <ManagePresetsDialog open={manageOpen} onClose={() => setManageOpen(false)} />}
    </>
  )
}
