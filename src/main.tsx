import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import OperationsApp from './OperationsApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OperationsApp />
  </StrictMode>,
)
