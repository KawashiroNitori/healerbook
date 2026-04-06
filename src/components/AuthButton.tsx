import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'

export default function AuthButton() {
  const { username, isLoggedIn, login, logout } = useAuth()

  if (isLoggedIn && username) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{username}</span>
        <Button variant="outline" size="sm" onClick={logout}>
          退出
        </Button>
      </div>
    )
  }

  return (
    <Button variant="default" size="sm" onClick={login}>
      登录 FFLogs
    </Button>
  )
}
