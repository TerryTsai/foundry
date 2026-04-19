import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { router } from './router.js'
import { queryClient } from './queryClient.js'
import { ThemeProvider } from './theme.js'
import { BreadcrumbProvider } from './Breadcrumb.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BreadcrumbProvider>
          <RouterProvider router={router} />
        </BreadcrumbProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
