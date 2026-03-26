export function track(event: string, data?: Record<string, unknown>): void {
  window.umami?.track(event, data)
}
