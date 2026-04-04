import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <p className="mt-4 text-lg text-muted-foreground">页面不存在</p>
        <Link to="/" className="mt-6 inline-block text-sm text-primary hover:underline">
          返回首页
        </Link>
      </div>
    </div>
  )
}
