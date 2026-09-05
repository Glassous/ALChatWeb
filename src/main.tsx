import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/playwrite-no/index.css'
import './types.d.ts'
import './index.css'
import App from './App.tsx'
import { LayerProvider } from './components/LayerSystem/LayerSystem'

try {
  const cachedUser = localStorage.getItem('user')
  if (cachedUser) {
    const parsedUser: unknown = JSON.parse(cachedUser)
    if (parsedUser && typeof parsedUser === 'object' && 'theme_config' in parsedUser) {
      delete (parsedUser as Record<string, unknown>).theme_config
      localStorage.setItem('user', JSON.stringify(parsedUser))
    }
  }
} catch {
  // A malformed cache must not prevent the application from starting.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LayerProvider>
      <App />
    </LayerProvider>
  </StrictMode>,
)
