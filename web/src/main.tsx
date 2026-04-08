import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from './router.js'
import { ThemeProvider } from './theme.js'
import { BreadcrumbProvider } from './Breadcrumb.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BreadcrumbProvider>
        <RouterProvider router={router} />
      </BreadcrumbProvider>
    </ThemeProvider>
  </StrictMode>
)
