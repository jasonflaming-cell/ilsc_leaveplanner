import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

console.log('Booting Leave Planner…')

try {
  const root = createRoot(document.getElementById('root'))
  root.render(<App />)
} catch (e) {
  console.error('Render error:', e)
  const el = document.createElement('pre')
  el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;background:#fee;color:#900;margin:0;padding:12px'
  el.textContent = 'Render error: ' + (e?.message || e)
  document.body.appendChild(el)
}
