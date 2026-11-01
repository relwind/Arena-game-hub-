import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Largeur de référence 360 px (celle de l'artefact) : sur un téléphone dont l'affichage est
// agrandi (peu de pixels CSS), on réduit l'échelle pour retrouver les mêmes proportions.
function fit() {
  const el = document.documentElement as any
  el.style.zoom = '1'
  const w = el.clientWidth || window.innerWidth
  const z = w < 360 ? w / 360 : 1
  el.style.zoom = String(z)
  ;(window as any).__arenaFit = { w: Math.round(w), z: Math.round(z * 100) / 100, dpr: window.devicePixelRatio }
}
fit()
window.addEventListener('resize', fit)
window.addEventListener('orientationchange', fit)

createRoot(document.getElementById('app')!).render(<App />)
