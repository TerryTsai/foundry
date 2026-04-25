// Admin SPA placeholder. System-administration features (deeper
// observability, audit log explorer, account management, system
// health, billing reconciliation) land here as they become real
// product needs. Today this just renders a marker so the package
// builds and deploys.

export function App() {
  return (
    <main style={{
      fontFamily:    'system-ui, sans-serif',
      padding:       '2rem',
      maxWidth:      '40rem',
      margin:        '0 auto',
      color:         '#e4e4e7',
      background:    '#0a0a0a',
      minHeight:     '100vh',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>foundry · admin</h1>
      <p style={{ color: '#a1a1aa' }}>
        System administration surface. Empty today. See <code>packages/admin/README.md</code>.
      </p>
    </main>
  )
}
