import React, { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { Logo, Top, ErrBox, errMsg, useApp, age, rpc, Av } from '../lib/ui'

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

export const COUNTRIES: { n: string; f: string; d: string; len: number[] }[] = [
  { n: 'Burkina Faso', f: '🇧🇫', d: '226', len: [8] },
  { n: "Côte d'Ivoire", f: '🇨🇮', d: '225', len: [10] },
  { n: 'Mali', f: '🇲🇱', d: '223', len: [8] },
  { n: 'Sénégal', f: '🇸🇳', d: '221', len: [9] },
  { n: 'Niger', f: '🇳🇪', d: '227', len: [8] },
  { n: 'Togo', f: '🇹🇬', d: '228', len: [8] },
  { n: 'Bénin', f: '🇧🇯', d: '229', len: [8, 10] },
  { n: 'Guinée', f: '🇬🇳', d: '224', len: [9] },
  { n: 'Cameroun', f: '🇨🇲', d: '237', len: [9] },
  { n: 'France', f: '🇫🇷', d: '33', len: [9] },
  { n: 'Autre', f: '🌍', d: '', len: [] },
]

function Steps({ n, label }: { n: number; label: string }) {
  return (
    <>
      <div className="steps" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>
      <p className="small muted" style={{ margin: '6px 0 14px' }}>Étape {n} sur 4 · {label}</p>
    </>
  )
}

export function Signup() {
  const { nav } = useApp()
  const [f, setF] = useState({ name: '', email: '', ci: 0, tel: '', dob: '', ref: '', pw: '', pw2: '', cgu: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const c = COUNTRIES[f.ci]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const name = f.name.trim()
    if (name.length < 3 || name.length > 24) return setErr('Le pseudo doit faire 3 à 24 caractères.')
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr('Email invalide.')
    let phone = ''
    const raw = f.tel.replace(/[\s.\-()]/g, '')
    if (raw) {
      if (!/^\d+$/.test(raw.replace(/^\+/, ''))) return setErr('Numéro : chiffres uniquement.')
      if (c.d) {
        const local = raw.replace(/^\+?/, '').replace(new RegExp('^' + c.d), '').replace(/^0+(?=\d{8,})/, '')
        if (!c.len.includes(local.length)) return setErr(`Numéro ${c.n} : ${c.len.join(' ou ')} chiffres après +${c.d}.`)
        phone = '+' + c.d + local
      } else {
        if (!raw.startsWith('+')) return setErr("Pour « Autre », entre le numéro avec l'indicatif, ex : +1 555…")
        if (raw.length < 8 || raw.length > 16) return setErr('Numéro invalide.')
        phone = raw
      }
    }
    if (!f.dob) return setErr('Entre ta date de naissance.')
    if (age(f.dob) < 16) return setErr('Arena est réservé aux personnes de 16 ans et plus.')
    if (f.pw.length < 8) return setErr('Mot de passe : 8 caractères minimum.')
    if (f.pw !== f.pw2) return setErr('Les mots de passe sont différents.')
    if (!f.cgu) return setErr("Accepte les conditions d'utilisation.")
    setBusy(true)
    const { data, error } = await sb.auth.signUp({
      email: f.email.trim(),
      password: f.pw,
      options: { data: { username: name, birth_date: f.dob, country: c.n, phone, referral: f.ref.trim() } },
    })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    if (!data.session) nav.replace('verify', { email: f.email.trim() })
  }

  return (
    <section className="screen">
      <Top title="Créer un compte" />
      <Steps n={1} label="Ton compte" />
      <form className="stack" onSubmit={submit} noValidate>
        <label className="f">Pseudo<input className="in" autoComplete="username" value={f.name} onChange={set('name')} maxLength={24} /></label>
        <label className="f">Email<input className="in" type="email" autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="f">Pays
          <select className="in" value={f.ci} onChange={(e) => setF({ ...f, ci: Number(e.target.value) })}>
            {COUNTRIES.map((x, i) => <option key={x.n} value={i}>{x.f}  {x.n}{x.d ? '  (+' + x.d + ')' : ''}</option>)}
          </select>
        </label>
        <label className="f">Numéro de téléphone (facultatif)
          <div className="row" style={{ gap: 8 }}>
            <div className="in" style={{ width: 'auto', whiteSpace: 'nowrap' }}>{c.f} {c.d ? '+' + c.d : '+'}</div>
            <input className="in" inputMode="tel" autoComplete="tel" value={f.tel} onChange={set('tel')} placeholder={c.d ? `${c.len[0]} chiffres` : '+indicatif et numéro'} />
          </div>
        </label>
        <label className="f">Date de naissance (16 ans minimum)<input className="in" type="date" value={f.dob} onChange={set('dob')} /></label>
        <label className="f">Code de parrainage (optionnel)<input className="in" autoCapitalize="characters" value={f.ref} onChange={set('ref')} maxLength={20} /></label>
        <label className="f">Mot de passe<input className="in" type="password" autoComplete="new-password" value={f.pw} onChange={set('pw')} /></label>
        <label className="f">Confirmer le mot de passe<input className="in" type="password" autoComplete="new-password" value={f.pw2} onChange={set('pw2')} /></label>
        <label className="row small muted" style={{ gap: 8 }}>
          <input type="checkbox" checked={f.cgu} onChange={set('cgu')} /> J'accepte les conditions d'utilisation et la politique de confidentialité
        </label>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Création…' : "S'inscrire"}</button>
      </form>
    </section>
  )
}

export function Verify({ p }: { p: any }) {
  const { nav, toast } = useApp()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(30)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(code)) return setErr('Le code contient 6 chiffres.')
    setBusy(true)
    const { error } = await sb.auth.verifyOtp({ email: p?.email, token: code, type: 'signup' })
    setBusy(false)
    if (error) setErr(/expired|invalid/i.test(error.message) ? 'Code incorrect ou expiré. Demande un nouveau code.' : errMsg(error))
  }
  const resend = async () => {
    const { error } = await sb.auth.resend({ type: 'signup', email: p?.email })
    if (error) return setErr(errMsg(error))
    setWait(30); toast('Nouveau code envoyé')
  }
  return (
    <section className="screen">
      <Top title="Vérifie ton email" />
      <Steps n={2} label="Vérification" />
      <p className="muted">Un code à 6 chiffres a été envoyé à {p?.email}. Pense à regarder tes courriers indésirables.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <input className="in" inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres" autoComplete="one-time-code" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '.4em', textAlign: 'center', fontSize: 20 }} />
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Vérification…' : 'Valider'}</button>
        <button className="btn ghost" type="button" disabled={wait > 0} onClick={resend}>{wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code'}</button>
        <button type="button" className="small" onClick={() => nav.replace('login')} style={{ background: 'none', border: 0, color: 'var(--cyan)' }}>Retour à la connexion</button>
      </form>
    </section>
  )
}

export function OnbProfile() {
  const { me, nav } = useApp()
  const [f, setF] = useState({ efb: me.ident?.efootball_name || '', region: "Afrique de l'Ouest", city: '', plat: 'Mobile', bio: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const copy = async () => { try { await navigator.clipboard.writeText(me.ident?.arena_id || '') } catch { /* */ } }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await rpc('onboarding_save', { _efootball: f.efb, _bio: f.bio, _city: f.city, _region: f.region, _platform: f.plat, _game: 'eFootball' })
      nav.replace('onb4')
    } catch (x: any) { setErr(errMsg(x)); setBusy(false) }
  }
  return (
    <section className="screen">
      <div className="top"><h2>Complète ton profil</h2></div>
      <Steps n={3} label="Ton profil joueur" />
      <form className="stack" onSubmit={submit} noValidate>
        <div style={{ margin: '0 auto' }}><Av name={me.profile?.username} size={84} /></div>
        <div className="card stack">
          <b>Ton identifiant Arena</b>
          <div className="row"><b className="grow" style={{ fontFamily: 'var(--display)', fontSize: 20, letterSpacing: '.08em' }}>{me.ident?.arena_id}</b>
            <button type="button" className="btn ghost" style={{ width: 'auto', padding: '8px 14px' }} onClick={copy}>Copier</button></div>
          <div className="small muted">Arena te le donne, tu n'as rien à saisir. Tes adversaires et les organisateurs le voient. Pas besoin de ton ID eFootball.</div>
        </div>
        <label className="f">Pseudo eFootball (facultatif)<input className="in" value={f.efb} onChange={set('efb')} maxLength={40} placeholder="Pour qu'on te retrouve dans le jeu" /></label>
        <label className="f">Région
          <select className="in" value={f.region} onChange={set('region')}>
            {["Afrique de l'Ouest", 'Afrique centrale', 'Afrique du Nord', 'Europe', 'Amérique', 'Asie'].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="f">Ville (facultatif)<input className="in" value={f.city} onChange={set('city')} maxLength={60} placeholder="Ex : Ouagadougou" /></label>
        <div className="f">Plateforme
          <div className="seg" style={{ marginTop: 6 }}>{['Mobile', 'Console', 'PC'].map((k) => <button type="button" key={k} className={f.plat === k ? 'on' : ''} onClick={() => setF({ ...f, plat: k })}>{k}</button>)}</div>
        </div>
        <label className="f">Courte bio<textarea className="in" rows={2} maxLength={120} value={f.bio} onChange={set('bio')} placeholder="Ex : Défenseur solide, je joue le soir." /></label>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>Continuer</button>
      </form>
    </section>
  )
}

export function OnbPrefs() {
  const { me, nav, refreshMe } = useApp()
  const [p, setP] = useState({ r: true, m: true, l: false, how: 'Un ami' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await rpc('onboarding_finish', { _reminders: p.r, _messages: p.m, _lives: p.l, _how: p.how })
      await refreshMe()
      nav.replace('valid')
    } catch (x: any) { setErr(errMsg(x)); setBusy(false) }
  }
  const sw = (k: 'r' | 'm' | 'l', t: string) => (
    <label className="item"><span className="grow">{t}</span><input type="checkbox" className="sw" checked={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.checked })} /></label>
  )
  return (
    <section className="screen">
      <div className="top"><h2>Tes préférences</h2></div>
      <Steps n={4} label="Préférences" />
      <form className="stack" onSubmit={submit}>
        {sw('r', 'Rappels de match')}
        {sw('m', 'Messages')}
        {sw('l', 'Lives des joueurs que je suis')}
        <label className="f">Comment as-tu connu Arena ?
          <select className="in" value={p.how} onChange={(e) => setP({ ...p, how: e.target.value })}>{['Un ami', 'WhatsApp', 'TikTok', 'Facebook', 'Autre'].map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        {me.profile?.is_minor && <p className="small muted card" style={{ margin: 0 }}>Pas de notification entre 23 h et 6 h pour les moins de 18 ans.</p>}
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>Terminer mon inscription</button>
      </form>
    </section>
  )
}

export function Valid() {
  const { nav } = useApp()
  return (
    <section className="screen">
      <div className="splash">
        <div className="ok-ring"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <h1>Compte validé !</h1>
        <p className="muted" style={{ margin: 0 }}>Ton compte est maintenant actif.</p>
        <button className="btn" onClick={() => nav.tab('home')}>Aller sur l'accueil</button>
      </div>
    </section>
  )
}
