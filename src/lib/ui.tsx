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

const DT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('fr-FR', DT) : '–')
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
