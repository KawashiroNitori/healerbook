interface Window {
  umami?: {
    track: (event: string, data?: Record<string, unknown>) => void
  }
}
