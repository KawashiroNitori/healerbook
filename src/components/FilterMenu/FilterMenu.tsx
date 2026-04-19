/**
 * 工具栏上的"过滤"下拉菜单入口。
 */

import { useState } from 'react'
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
import ManagePresetsDialog from './ManagePresetsDialog'
import { track } from '@/utils/analytics'

export default function FilterMenu() {
  const activeFilterId = useFilterStore(s => s.activeFilterId)
  const setActiveFilter = useFilterStore(s => s.setActiveFilter)
  const customPresets = useFilterStore(s => s.customPresets)

  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const handleChange = (id: string) => {
    track('filter-change', { id })
    setActiveFilter(id)
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip open={menuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Filter className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">过滤</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuRadioGroup value={activeFilterId} onValueChange={handleChange}>
            {BUILTIN_PRESETS.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.name}
              </DropdownMenuRadioItem>
            ))}
            {customPresets.length > 0 && <DropdownMenuSeparator />}
            {customPresets.map(p => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {p.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>管理预设…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {manageOpen && <ManagePresetsDialog open={manageOpen} onClose={() => setManageOpen(false)} />}
    </>
  )
}
