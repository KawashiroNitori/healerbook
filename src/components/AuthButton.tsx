import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'

export default function AuthButton() {
  const { t } = useTranslation(['common'])
  const { username, isLoggedIn, login, logout } = useAuth()

  if (isLoggedIn && username) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{username}</span>
        <Button variant="outline" size="sm" onClick={logout}>
          {t('authButton.logout')}
        </Button>
      </div>
    )
  }

  return (
    <Button variant="default" size="sm" onClick={login}>
      {t('authButton.login')}
    </Button>
  )
}
