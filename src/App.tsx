import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import TooltipOverlay from '@/components/TooltipOverlay'

const HomePage = lazy(() => import('./pages/HomePage'))
const EditorPage = lazy(() => import('./pages/EditorPage'))

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/editor/:timelineId" element={<EditorPage />} />
          </Routes>
        </Suspense>
        <Toaster />
        <TooltipOverlay />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
