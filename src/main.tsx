import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Largeur de référence 360 px (celle de l'artefact) : sur un téléphone dont l'affichage est
// agrandi (peu de pixels CSS), on réduit l'échelle pour retrouver les mêmes proportions.
function fit() {
  const base = Math.min(window.screen.width || 360, window.screen.height || 360)
  ;(document.documentElement.style as any).zoom = String(base < 360 ? base / 360 : 1)
}
fit()
window.addEventListener('resize', fit)

createRoot(document.getElementById('app')!).render(<App />)
