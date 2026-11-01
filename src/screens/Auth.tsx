import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { Logo, Top, ErrBox, errMsg, useApp, age } from '../lib/ui'

export function Splash() {
  const { nav } = useApp()
  return (
    <section className="screen">
      <div className="splash">
        <Logo />
        <div className="logo">ARENA<small>GAME HUB</small></div>
        <p className="muted" style={{ margin: 0 }}>Joue. Affronte. Compétis.</p>
        <button className="btn" onClick={() => nav.go('login')}>Commencer</button>
      </div>
    </section>
  )
}

export function Login() {
  const { nav } = useApp()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email.trim() || !pw) return setErr('Entre ton email et ton mot de passe.')
    setBusy(true)
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw })
    setBusy(false)
    if (error) setErr(errMsg(error))
  }
  const forgot = async () => {
    if (!email.trim()) return setErr("Entre d'abord ton email.")
    const { error } = await sb.auth.resetPasswordForEmail(email.trim())
    setErr(error ? errMsg(error) : 'Un email de réinitialisation vient de partir.')
  }

  return (
    <section className="screen">
      <div className="top"><h2>Bienvenue sur Arena !</h2></div>
      <p className="muted" style={{ marginTop: -8 }}>Connecte-toi ou crée ton compte pour continuer.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <label className="f">Email<input className="in" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="f">Mot de passe<input className="in" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Connexion'}</button>
        <button className="btn ghost" type="button" onClick={() => nav.go('signup')}>Créer un compte</button>
        <button type="button" className="small" onClick={forgot} style={{ background: 'none', border: 0, color: 'var(--cyan)' }}>Mot de passe oublié ?</button>
      </form>
    </section>
  )
}

const COUNTRIES = ['Burkina Faso', "Côte d'Ivoire", 'Mali', 'Sénégal', 'Autre']

export function Signup() {
  const { nav } = useApp()
  const [f, setF] = useState({ name: '', email: '', dob: '', country: COUNTRIES[0], efb: '', pw: '', pw2: '', cgu: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const name = f.name.trim()
    if (name.length < 3 || name.length > 24) return setErr('Le pseudo doit faire 3 à 24 caractères.')
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr('Email invalide.')
    if (!f.dob) return setErr('Entre ta date de naissance.')
    if (age(f.dob) < 16) return setErr('Arena est réservé aux personnes de 16 ans et plus.')
    if (f.pw.length < 8) return setErr('Mot de passe : 8 caractères minimum.')
    if (f.pw !== f.pw2) return setErr('Les mots de passe sont différents.')
    if (!f.cgu) return setErr("Accepte les conditions d'utilisation.")
    setBusy(true)
    localStorage.setItem('arena_country', f.country)
    const { data, error } = await sb.auth.signUp({
      email: f.email.trim(),
      password: f.pw,
      options: { data: { username: name, birth_date: f.dob, efootball_name: f.efb.trim() } },
    })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    if (!data.session) nav.replace('verify', { email: f.email.trim() })
  }

  return (
    <section className="screen">
      <Top title="Créer un compte" />
      <form className="stack" onSubmit={submit} noValidate>
        <label className="f">Pseudo<input className="in" autoComplete="username" value={f.name} onChange={set('name')} maxLength={24} /></label>
        <label className="f">Email<input className="in" type="email" autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="f">Date de naissance (16 ans minimum)<input className="in" type="date" value={f.dob} onChange={set('dob')} /></label>
        <label className="f">Pays
          <select className="in" value={f.country} onChange={set('country')}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="f">Nom dans eFootball (facultatif)<input className="in" value={f.efb} onChange={set('efb')} maxLength={40} /></label>
        <label className="f">Mot de passe<input className="in" type="password" autoComplete="new-password" value={f.pw} onChange={set('pw')} /></label>
        <label className="f">Confirmer le mot de passe<input className="in" type="password" autoComplete="new-password" value={f.pw2} onChange={set('pw2')} /></label>
        <label className="row small muted" style={{ gap: 8 }}>
          <input type="checkbox" checked={f.cgu} onChange={set('cgu')} /> J'accepte les conditions d'utilisation et la politique de confidentialité
        </label>
        <p className="small muted" style={{ margin: 0 }}>Arena te donne un identifiant personnel (AG-XXXXX) à la création du compte.</p>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Création…' : "S'inscrire"}</button>
      </form>
    </section>
  )
}

export function Verify({ p }: { p: any }) {
  const { nav } = useApp()
  return (
    <section className="screen">
      <div className="splash">
        <div className="ok-ring"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" strokeWidth="2.2" strokeLinecap="round"><path d="M4 12l5 5L20 6" /></svg></div>
        <h2>Compte créé</h2>
        <p className="muted" style={{ margin: 0 }}>Un email de confirmation a été envoyé à {p?.email}. Ouvre le lien, puis reviens te connecter.</p>
        <button className="btn" onClick={() => nav.replace('login')}>Aller à la connexion</button>
      </div>
    </section>
  )
}
