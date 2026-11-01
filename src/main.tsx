import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Échelle d'affichage : base = largeur de référence 360 px (celle de l'artefact), puis un
// multiplicateur choisi par l'utilisateur (Profil > Taille du texte).
export const SCALES: [string, string, number][] = [['p', 'Petit', 0.92], ['n', 'Normal', 1], ['g', 'Grand', 1.12], ['t', 'Très grand', 1.25]]
function userMult() {
  try { const k = localStorage.getItem('arena_scale') || 'g'; return (SCALES.find((s) => s[0] === k) || SCALES[2])[2] } catch { return 1.12 }
}
function fit() {
  const el = document.documentElement as any
  el.style.zoom = '1'
  const w = el.clientWidth || window.innerWidth
  const base = w < 360 ? w / 360 : 1
  const z = Math.round(base * userMult() * 1000) / 1000
  el.style.zoom = String(z)
  ;(window as any).__arenaFit = { w: Math.round(w), z, dpr: window.devicePixelRatio }
}
;(window as any).__arenaRefit = fit
fit()
window.addEventListener('resize', fit)
window.addEventListener('orientationchange', fit)

createRoot(document.getElementById('app')!).render(<App />)
