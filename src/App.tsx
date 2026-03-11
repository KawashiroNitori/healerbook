import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HomePage from './pages/HomePage'
import EditorPage from './pages/EditorPage'
import { Toaster } from '@/components/ui/sonner'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/editor/:timelineId" element={<EditorPage />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
