import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/playwrite-no'
import './types.d.ts'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
