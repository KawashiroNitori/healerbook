import { Component, type ReactNode } from 'react'
import i18n from '@/i18n'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] 渲染错误:', error)
    console.error('[ErrorBoundary] 组件栈:', info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
            {i18n.t('common:errorBoundary.renderError', {
              message: this.state.error?.message ?? '',
            })}
          </div>
        )
      )
    }
    return this.props.children
  }
}
