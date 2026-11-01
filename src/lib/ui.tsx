import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { sb } from './supabase'

export type Route = { name: string; p?: any }
export const Ctx = createContext<any>(null)
export const useApp = () => useContext(Ctx)

export function errMsg(e: any): string {
  const m: string = (e && (e.message || e.error_description)) || String(e || 'Erreur')
  if (/Database error saving new user/i.test(m)) return "Inscription refusée : pseudo déjà pris ou date de naissance invalide (16 ans minimum)."
  if (/Invalid login credentials/i.test(m)) return 'Email ou mot de passe incorrect.'
  if (/already registered|already been registered/i.test(m)) return 'Cet email a déjà un compte.'
  if (/Email not confirmed/i.test(m)) return "Confirme d'abord ton email (lien reçu par mail)."
  if (/Failed to fetch|NetworkError|Network request failed/i.test(m)) return 'Pas de connexion à internet.'
  if (/rate limit/i.test(m)) return 'Trop de tentatives. Réessaie dans quelques minutes.'
  return m
}

export async function rpc(name: string, args?: any) {
  const { data, error } = await sb.rpc(name, args || {})
  if (error) throw new Error(errMsg(error))
  return data
}

export async function q<T = any>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(errMsg(error))
  return data as T
}

export const fmt = (d?: string | null) => {
  if (!d) return '–'
  const x = new Date(d)
  const day = x.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return day + ' à ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
export function inTxt(d?: string | null) {
  if (!d) return ''
  const ms = new Date(d).getTime() - Date.now()
  if (ms < 0) return 'En cours'
  const m = Math.round(ms / 60000)
  if (m < 60) return 'Dans ' + Math.max(1, m) + ' min'
  const h = Math.round(m / 60)
  if (h < 24) return 'Dans ' + h + ' h'
  return 'Dans ' + Math.round(h / 24) + ' j'
}
export function leftTxt(d?: string | null) {
  const ms = new Date(d || 0).getTime() - Date.now()
  if (ms <= 0) return ''
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60)
  return 'dans ' + (h ? h + ' h ' : '') + (m % 60) + ' min'
}
export const hhmm = (d?: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–')

export const FORMATS: Record<string, string> = { elim: 'Élimination directe', rr: 'Championnat', poules: 'Poules + élimination' }
export const PRESETS: Record<string, string> = { c: 'Court · 6 min', s: 'Standard · 10 min', l: 'Long · 15 min' }
export const STATUS: Record<string, [string, string]> = {
  open: ['Inscriptions ouvertes', 'b-ok'],
  closed: ['Inscriptions fermées', 'b-wait'],
  ongoing: ['En cours', 'b-gold'],
  finished: ['Terminé', 'b-wait'],
  cancelled: ['Annulé', 'b-wait'],
}

export function useLoad<T>(fn: () => Promise<T>, deps: any[], pollMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const run = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const r = await fn()
      if (alive.current) { setData(r); setErr('') }
    } catch (e: any) {
      if (alive.current) setErr(errMsg(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }
  useEffect(() => {
    alive.current = true
    run()
    const t = pollMs ? setInterval(() => run(true), pollMs) : null
    return () => { alive.current = false; if (t) clearInterval(t) }
    // eslint-disable-next-line
  }, deps)
  return { data, err, loading, reload: () => run(true) }
}

export function Top({ title, back = true, right }: { title: string; back?: boolean; right?: React.ReactNode }) {
  const { nav } = useApp()
  return (
    <div className="top">
      {back && <button className="back" onClick={() => nav.back()} aria-label="Retour">‹</button>}
      <h2>{title}</h2>
      {right}
    </div>
  )
}

export const Spin = ({ text = 'Chargement…' }: { text?: string }) => <div className="spin">{text}</div>
export const ErrBox = ({ text }: { text: string }) => (text ? <div className="err">{text}</div> : null)

export function Logo({ size = 92 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 90" width={size} height={size * 0.91} aria-hidden="true" style={{ margin: '0 auto', display: 'block' }}>
      <path d="M50 4 94 84H72L50 40 28 84H6Z" fill="none" stroke="#35D0FF" strokeWidth="7" strokeLinejoin="round" />
      <path d="M36 66h28" stroke="#2F7BFF" strokeWidth="7" strokeLinecap="round" />
    </svg>
  )
}

export function age(dob: string) {
  const d = new Date(dob), n = new Date()
  let a = n.getFullYear() - d.getFullYear()
  const m = n.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--
  return a
}

export async function namesOf(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const u = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!u.length) return {}
  const rows = await q<any[]>(sb.from('profiles').select('id,username').in('id', u))
  const o: Record<string, string> = {}
  rows.forEach((r) => (o[r.id] = r.username))
  return o
}

export function GameArt({ size = 54 }: { size?: number }) {
  return (
    <svg viewBox="0 0 54 54" width={size} height={size} style={{ flex: 'none', borderRadius: 12 }} aria-hidden="true">
      <rect width="54" height="54" rx="12" fill="#1c7a3f" />
      <path d="M2 27h50M27 2v50" stroke="#ffffff33" strokeWidth="1" />
      <rect x="6" y="6" width="42" height="42" rx="11" fill="#241157" />
      <circle cx="19" cy="17" r="3" fill="#35D0FF" /><circle cx="14" cy="40" r="5" fill="#d946ef" /><circle cx="40" cy="14" r="2.5" fill="#35D0FF" />
      <circle cx="27" cy="27" r="13" fill="#fff" />
      <path d="M27 21l5 3.6-1.9 5.8h-6.2L22 24.6z" fill="#241157" />
      <path d="M27 21v-6M32 24.6l5.6-1.8M30.1 30.4l3.4 4.8M23.9 30.4l-3.4 4.8M22 24.6l-5.6-1.8" stroke="#241157" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Av({ name, size = 40, url }: { name?: string; size?: number; url?: string | null }) {
  const h = Array.from(name || '?').reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <div className="tile" style={{ width: size, height: size, borderRadius: '50%', fontSize: size * 0.4, background: url ? `center/cover url(${url})` : `linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 40) % 360} 75% 45%))` }}>
      {url ? '' : (name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

export async function openEfootball(toast: (t: string) => void) {
  try {
    const { AppLauncher } = await import('@capacitor/app-launcher')
    await AppLauncher.openUrl({ url: 'jp.konami.pesam' })
  } catch {
    toast("Impossible d'ouvrir eFootball : vérifie qu'il est installé.")
  }
}
