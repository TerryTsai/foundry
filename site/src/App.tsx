import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="container">
      <h1>Foundry</h1>
      <p>Autonomous agent harness for solo founders.</p>
      <button onClick={() => setCount(c => c + 1)}>
        count: {count}
      </button>
    </div>
  )
}
