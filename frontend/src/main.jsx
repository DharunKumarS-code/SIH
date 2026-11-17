import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App, { startupReady } from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SelectionProvider } from './context/SelectionContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { AppErrorBoundary } from './components/ui/AppErrorBoundary.jsx'

// Signed-in direct loads first preload the shell + current page (see App.jsx),
// capped so a slow network still renders (with its Suspense fallback) quickly.
const firstRender = Promise.race([startupReady, new Promise((r) => setTimeout(r, 1500))])

firstRender.then(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <SelectionProvider>
              <App />
            </SelectionProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
))
