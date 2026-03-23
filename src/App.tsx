import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import TooltipOverlay from '@/components/TooltipOverlay'
import { AuthProvider } from './contexts/AuthContext'

const HomePage = lazy(() => import('./pages/HomePage'))
const EditorPage = lazy(() => import('./pages/EditorPage'))
const CallbackPage = lazy(() => import('./pages/CallbackPage'))

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/editor/:timelineId" element={<EditorPage />} />
                <Route path="/callback" element={<CallbackPage />} />
              </Routes>
            </Suspense>
            <Toaster />
            <TooltipOverlay />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
