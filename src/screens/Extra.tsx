import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, Top, Spin, ErrBox, errMsg, Av, STATUS, FORMATS, GameArt } from '../lib/ui'
import { COUNTRIES } from './Auth'

/* ---------- Mot de passe oublié (code à 6 chiffres) ---------- */
export function Forgot() {
  const { nav, toast } = useApp()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Email invalide.')
    setBusy(true)
    const { error } = await sb.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setStep(2)
  }
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!/^\d{6}$/.test(code)) return setErr('Le code contient 6 chiffres.')
    if (pw.length < 8) return setErr('Mot de passe : 8 caractères minimum.')
    if (pw !== pw2) return setErr('Les mots de passe sont différents.')
    setBusy(true)
    const v = await sb.auth.verifyOtp({ email: email.trim(), token: code, type: 'recovery' })
    if (v.error) { setBusy(false); return setErr(/expired|invalid/i.test(v.error.message) ? 'Code incorrect ou expiré.' : errMsg(v.error)) }
    const u = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (u.error) return setErr(errMsg(u.error))
    toast('Mot de passe modifié')
  }
  return (
    <section className="screen">
      <Top title="Mot de passe oublié" />
      {step === 1 ? (
        <form className="stack" onSubmit={send} noValidate>
          <p className="muted" style={{ margin: 0 }}>Entre ton email : nous t'envoyons un code à 6 chiffres.</p>
          <label className="f">Email<input className="in" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <ErrBox text={err} />
          <button className="btn" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le code'}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={reset} noValidate>
          <p className="muted" style={{ margin: 0 }}>Un code a été envoyé à {email}. Pense à regarder tes courriers indésirables.</p>
          <input className="in" inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres" autoComplete="one-time-code" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: '.4em', textAlign: 'center', fontSize: 20 }} />
          <label className="f">Nouveau mot de passe<input className="in" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label className="f">Confirmer<input className="in" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          <ErrBox text={err} />
          <button className="btn" disabled={busy}>{busy ? 'Validation…' : 'Changer le mot de passe'}</button>
          <button type="button" className="small" onClick={() => nav.back()} style={{ background: 'none', border: 0, color: 'var(--cyan)' }}>Retour à la connexion</button>
        </form>
      )}
    </section>
  )
}

/* ---------- Paramètres ---------- */
export function Settings() {
  const { me, nav, toast } = useApp()
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [del, setDel] = useState(false)
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, reload } = useLoad(async () => {
    const u = await sb.auth.getUser()
    const p = (await rpc('get_notif_prefs')) as any[]
    return { email: u.data.user?.email || '', p: p?.[0] || { reminders: true, messages: true, lives: false } }
  }, [me.id])
  const setPref = async (k: 'reminders' | 'messages' | 'lives', v: boolean) => {
    const n = { ...(data?.p || { reminders: true, messages: true, lives: false }), [k]: v }
    try { await rpc('save_notif_prefs', { _reminders: n.reminders, _messages: n.messages, _lives: n.lives }); await reload() } catch (e: any) { toast(errMsg(e)) }
  }
  const changePw = async () => {
    setErr('')
    if (pw.length < 8) return setErr('Mot de passe : 8 caractères minimum.')
    if (pw !== pw2) return setErr('Les mots de passe sont différents.')
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setPw(''); setPw2(''); toast('Mot de passe modifié')
  }
  const remove = async () => {
    setErr(''); setBusy(true)
    try {
      const { data: d, error } = await sb.functions.invoke('delete-account', { body: {} })
      if (error) {
        let m = error.message
        try { const j = await (error as any).context?.json?.(); if (j?.error) m = j.error } catch { /* */ }
        throw new Error(m)
      }
      if ((d as any)?.error) throw new Error((d as any).error)
      await sb.auth.signOut()
    } catch (e: any) { setErr(e.message || errMsg(e)); setBusy(false) }
  }
  const sw = (k: 'reminders' | 'messages' | 'lives', t: string) => (
    <label className="item"><span className="grow">{t}</span><input type="checkbox" className="sw" checked={!!data?.p[k]} onChange={(e) => setPref(k, e.target.checked)} /></label>
  )
  return (
    <section className="screen">
      <Top title="Paramètres" />
      <div className="stack">
        <div className="card"><div className="small muted">Compte</div><b>{me.profile?.username}</b><div className="small muted">{data?.email}</div></div>
        <div className="sec" style={{ margin: '6px 0 0' }}><h3>Notifications</h3></div>
        {sw('reminders', 'Rappels de match')}
        {sw('messages', 'Messages')}
        {sw('lives', 'Lives des joueurs que je suis')}
        <div className="sec" style={{ margin: '6px 0 0' }}><h3>Changer le mot de passe</h3></div>
        <input className="in" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="in" type="password" autoComplete="new-password" placeholder="Confirmer" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button className="btn ghost" disabled={busy || !pw} onClick={changePw}>Modifier</button>
        <div className="sec" style={{ margin: '6px 0 0' }}><h3>Aide et informations</h3></div>
        <div className="menu">
          <button onClick={() => nav.go('help')}>Aide, FAQ et support <span>›</span></button>
          <button onClick={() => nav.go('rules')}>Règles des matchs <span>›</span></button>
          <button onClick={() => nav.go('legal', { k: 'cgu' })}>Conditions d'utilisation <span>›</span></button>
          <button onClick={() => nav.go('legal', { k: 'privacy' })}>Politique de confidentialité <span>›</span></button>
        </div>
        <ErrBox text={err} />
        <button className="btn ghost" onClick={() => sb.auth.signOut()}>Se déconnecter</button>
        {!del ? (
          <button className="btn ghost" style={{ color: 'var(--live)' }} onClick={() => setDel(true)}>Supprimer mon compte</button>
        ) : (
          <div className="card stack" style={{ borderColor: 'var(--live)' }}>
            <b>Supprimer mon compte</b>
            <div className="small muted">Ton pseudo, ta photo, ton numéro, ta ville et tes réglages sont effacés. Tes anciens matchs restent dans les classements sous le nom « ancien_… ». Cette action est définitive. Tu dois d'abord te retirer de tes compétitions en cours.</div>
            <input className="in" placeholder="Écris SUPPRIMER pour confirmer" value={conf} onChange={(e) => setConf(e.target.value)} />
            <div className="row"><button className="btn ghost" onClick={() => { setDel(false); setConf('') }}>Annuler</button>
              <button className="btn" style={{ background: 'var(--live)' }} disabled={busy || conf.trim().toUpperCase() !== 'SUPPRIMER'} onClick={remove}>{busy ? '…' : 'Supprimer'}</button></div>
          </div>
        )}
        <div className="small muted" style={{ textAlign: 'center', opacity: .6 }}>Arena Game Hub · version pilote 0.2</div>
      </div>
    </section>
  )
}

/* ---------- Profil public + signalement + blocage ---------- */
const REASONS = ['Insultes ou harcèlement', 'Triche', 'Faux profil ou usurpation', 'Photo, pseudo ou bio inappropriés', 'Autre']

export function PublicProfile({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [rep, setRep] = useState(false)
  const [why, setWhy] = useState(REASONS[0])
  const [ctx, setCtx] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, loading, reload } = useLoad(async () => {
    const p = await q<any>(sb.from('profiles').select('id,username,avatar_url,bio,country,created_at').eq('id', id).single())
    const [ident, st, rp, fr, bl] = await Promise.all([
      sb.from('player_identity').select('arena_id,efootball_name').eq('user_id', id).maybeSingle(),
      rpc('player_stats', { _uid: id }).catch(() => null),
      rpc('reputation_of', { _uid: id }).catch(() => 0),
      rpc('list_friends').catch(() => []),
      sb.from('blocks').select('blocked_id').eq('blocker_id', me.id).eq('blocked_id', id).maybeSingle(),
    ])
    const f = ((fr as any[]) || []).find((x) => x.user_id === id)
    return { p, ident: ident.data, st: (st as any)?.[0] || st, rep: rp, rel: f ? (f.status === 'accepted' ? 'friend' : f.incoming ? 'incoming' : 'sent') : 'none', blocked: !!bl.data }
  }, [id])
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true)
    try { await fn(); toast(ok); await reload() } catch (e: any) { toast(e.message || errMsg(e)) }
    setBusy(false)
  }
  if (loading && !data) return <section className="screen"><Top title="Profil" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Profil" /><div className="card small">Profil introuvable.</div></section>
  const { p, st } = data
  const flag = COUNTRIES.find((c) => c.n === p.country)?.f
  const self = id === me.id
  return (
    <section className="screen">
      <Top title="Profil" />
      <div className="row" style={{ marginBottom: 14 }}>
        <Av name={p.username} size={70} url={p.avatar_url} />
        <div className="grow"><h2>{p.username}</h2><div className="small muted">{flag} {p.country || ''}</div></div>
      </div>
      {p.bio && <div className="card small" style={{ marginBottom: 10 }}>{p.bio}</div>}
      {data.ident?.arena_id && <div className="card row" style={{ marginBottom: 10 }}><span className="small muted grow">Identifiant Arena</span><b className="arena-id">{data.ident.arena_id}</b></div>}
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat"><b>{st?.played ?? 0}</b><span className="small muted">Joué(s)</span></div>
        <div className="stat"><b>{st?.win_rate != null ? st.win_rate + ' %' : '–'}</b><span className="small muted">Taux de réussite</span></div>
        <div className="stat"><b>{(data.rep as any) ?? 0}</b><span className="small muted">Réputation</span></div>
      </div>
      {!self && (
        <div className="stack" style={{ marginTop: 14 }}>
          {data.rel === 'none' && <button className="btn" disabled={busy} onClick={() => act(() => rpc('request_friend', { _other: id }), 'Demande envoyée')}>Ajouter en ami</button>}
          {data.rel === 'sent' && <div className="card small muted">Demande d'ami envoyée.</div>}
          {data.rel === 'incoming' && <button className="btn" disabled={busy} onClick={() => act(() => rpc('respond_friend', { _other: id, _accept: true }), 'Ami ajouté')}>Accepter sa demande</button>}
          {data.rel === 'friend' && <button className="btn" disabled={busy} onClick={async () => { try { const ch = await rpc('open_dm', { _other: id }); nav.go('conv', { id: ch, name: p.username }) } catch (e: any) { toast(errMsg(e)) } }}>Écrire un message</button>}
          {!rep ? <button className="btn ghost" onClick={() => setRep(true)}>Signaler</button> : (
            <div className="card stack">
              <b>Signaler {p.username}</b>
              <div className="chips">{REASONS.map((r) => <button key={r} className={'chip' + (why === r ? ' on' : '')} onClick={() => setWhy(r)}>{r}</button>)}</div>
              <textarea className="in" rows={2} maxLength={300} placeholder="Détails (facultatif)" value={ctx} onChange={(e) => setCtx(e.target.value)} />
              <div className="row"><button className="btn ghost" onClick={() => setRep(false)}>Annuler</button>
                <button className="btn" disabled={busy} onClick={() => act(async () => { await rpc('report_user', { _user: id, _reason: why, _context: ctx.trim() || null }); setRep(false); setCtx('') }, 'Signalement envoyé. Merci.')}>Envoyer</button></div>
            </div>
          )}
          {data.blocked
            ? <button className="btn ghost" disabled={busy} onClick={() => act(async () => { const r = await sb.from('blocks').delete().eq('blocker_id', me.id).eq('blocked_id', id); if (r.error) throw new Error(errMsg(r.error)) }, 'Joueur débloqué')}>Débloquer</button>
            : <button className="btn ghost" style={{ color: 'var(--live)' }} disabled={busy} onClick={() => act(async () => { const r = await sb.from('blocks').insert({ blocker_id: me.id, blocked_id: id }); if (r.error) throw new Error(errMsg(r.error)) }, 'Joueur bloqué')}>Bloquer</button>}
        </div>
      )}
    </section>
  )
}

/* ---------- Aide, FAQ, support ---------- */
const FAQ: [string, string][] = [
  ["Arena est-il payant ?", "Non. Les compétitions Arena sont gratuites et il n'y a aucun argent réel en jeu. Les lots éventuels sont offerts par les organisateurs."],
  ["Comment m'inscrire à une compétition ?", "Va dans Compétitions, ouvre une compétition et touche « S'inscrire ». Tu ne peux être inscrit qu'à une seule compétition à la fois."],
  ["C'est quoi mon identifiant Arena ?", "Un code AG-XXXXX attribué automatiquement. Tes adversaires et les organisateurs le voient pour te retrouver. Tu n'as pas besoin de donner ton ID eFootball."],
  ["Que se passe-t-il si mon adversaire ne vient pas ?", "Après le délai prévu, le match est donné par forfait. Si tu es absent toi-même trop souvent, tes inscriptions peuvent être suspendues."],
  ["Comment envoyer mon résultat ?", "Après le match, ouvre-le dans l'app et saisis le score. Si vous n'êtes pas d'accord, ouvre un litige : l'organisateur tranche."],
  ["J'ai été déconnecté pendant un match.", "Signale la déconnexion dans la salle du match et reviens dans les 5 minutes. Au-delà, le match peut être perdu."],
  ["Comment devenir organisateur ?", "Dans Profil, « Devenir organisateur » : entre le code reçu de l'équipe Arena ou envoie une demande."],
  ["Comment supprimer mon compte ?", "Paramètres, puis « Supprimer mon compte ». Retire-toi d'abord de tes compétitions en cours."],
]
export function Help() {
  const { toast } = useApp()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setErr('')
    if (subject.trim().length < 3 || body.trim().length < 5) return setErr('Écris un sujet et un message.')
    setBusy(true)
    try { await rpc('send_support', { _subject: subject, _body: body }); toast("Message envoyé. Nous te répondrons dès que possible."); setSubject(''); setBody('') } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <section className="screen">
      <Top title="Aide et support" />
      <div className="stack">
        {FAQ.map(([a, b]) => (
          <details key={a} className="card"><summary><b>{a}</b></summary><div className="small muted" style={{ marginTop: 8 }}>{b}</div></details>
        ))}
        <div className="sec" style={{ margin: '10px 0 0' }}><h3>Contacter le support</h3></div>
        <input className="in" placeholder="Sujet" maxLength={80} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="in" rows={4} maxLength={1000} placeholder="Explique ton problème" value={body} onChange={(e) => setBody(e.target.value)} />
        <ErrBox text={err} />
        <button className="btn" disabled={busy} onClick={send}>Envoyer</button>
      </div>
    </section>
  )
}

/* ---------- Textes légaux (version pilote, à faire valider par un juriste) ---------- */
const LEGAL: Record<string, [string, [string, string][]]> = {
  cgu: ["Conditions d'utilisation", [
    ['1. Objet', "Arena Game Hub est une application d'organisation de compétitions de jeux vidéo (eFootball Mobile au lancement). L'inscription et la participation sont gratuites. Aucun pari ni argent réel n'est en jeu."],
    ['2. Compte', "Tu dois avoir 16 ans ou plus. Un seul compte par personne. Tu es responsable de ton mot de passe. Les informations données à l'inscription doivent être exactes."],
    ['3. Comportement', "Pas d'insultes, de harcèlement, de triche, d'usurpation d'identité, ni de contenu choquant (pseudo, photo, messages). Les signalements sont examinés par l'équipe Arena."],
    ['4. Compétitions', "Les organisateurs fixent le règlement de leurs compétitions dans le cadre des règles générales d'Arena. Les décisions de l'organisateur et des administrateurs, notamment sur les litiges et les forfaits, s'appliquent aux participants."],
    ['5. Sanctions', "En cas de non-respect, Arena peut avertir, suspendre les inscriptions, retirer un résultat ou fermer un compte."],
    ['6. Contenus', "Les photos et textes que tu publies restent les tiens, mais tu autorises Arena à les afficher dans l'application. Tu garantis avoir le droit de les utiliser."],
    ['7. Responsabilité', "Arena est fournie en l'état pendant la phase pilote. Arena n'est affiliée ni à Konami ni à eFootball."],
    ['8. Modification', "Ces conditions peuvent évoluer. Les changements importants te sont annoncés dans l'application."],
  ]],
  privacy: ['Politique de confidentialité', [
    ['Données collectées', "Pseudo, email, date de naissance, pays, numéro de téléphone (facultatif), ville et région (facultatives), pseudo eFootball (facultatif), photo (facultative), résultats de matchs, messages et signalements."],
    ['Pourquoi', "Faire fonctionner ton compte, organiser les compétitions, protéger les mineurs (la date de naissance sert à vérifier l'âge minimum et à adapter les règles de messagerie), assurer la sécurité et la modération."],
    ['Ce que les autres voient', "Ton pseudo, ta photo, ton pays, ta bio, tes statistiques et ton identifiant Arena (AG-XXXXX) selon le contexte. Ton email, ta date de naissance et ton numéro ne sont jamais visibles par les autres joueurs."],
    ['Mineurs', "Les moins de 18 ans ne peuvent pas recevoir de messages d'adultes qu'ils ne connaissent pas, et ne reçoivent pas de notification entre 23 h et 6 h."],
    ['Conservation', "Tes données sont conservées tant que ton compte existe. À la suppression du compte, tes informations personnelles sont effacées ; tes anciens résultats restent de façon anonyme dans les classements."],
    ['Tes droits', "Tu peux modifier tes informations dans l'application et supprimer ton compte dans Paramètres. Pour toute demande, utilise « Aide et support »."],
    ['Hébergement', "Les données sont hébergées chez Supabase. Arena n'utilise pas ces données pour de la publicité."],
  ]],
}
export function Legal({ k }: { k: string }) {
  const [title, secs] = LEGAL[k] || LEGAL.cgu
  return (
    <section className="screen">
      <Top title={title} />
      <div className="stack">
        <div className="card small muted">Version pilote. Ces textes seront revus et complétés avant l'ouverture au public.</div>
        {secs.map(([h, t]) => <div key={h} className="card stack"><b>{h}</b><div className="small muted">{t}</div></div>)}
      </div>
    </section>
  )
}

/* ---------- Page publique d'un organisateur ---------- */
export function OrgPage({ id }: { id: string }) {
  const { me, nav } = useApp()
  const { data, loading } = useLoad(async () => {
    const p = await q<any>(sb.from('profiles').select('id,username,avatar_url,bio,country,created_at').eq('id', id).single())
    const [org, comps] = await Promise.all([
      rpc('organizer_stats', { _uid: id }).catch(() => null),
      q<any[]>(sb.from('competitions').select('id,name,status,start_at,max_players,format,image_url,registrations(count)').eq('organizer_id', id).order('start_at', { ascending: false }).limit(30)),
    ])
    return { p, org: (org as any)?.[0] || org, comps }
  }, [id])
  if (loading && !data) return <section className="screen"><Top title="Organisateur" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Organisateur" /><div className="card small">Profil introuvable.</div></section>
  const { p, org, comps } = data
  const flag = COUNTRIES.find((c) => c.n === p.country)?.f
  const upcoming = comps.filter((c: any) => ['open', 'closed', 'ongoing'].includes(c.status))
  const past = comps.filter((c: any) => ['finished', 'cancelled'].includes(c.status))
  return (
    <section className="screen">
      <Top title="Organisateur" />
      <div className="row" style={{ marginBottom: 14 }}>
        <Av name={p.username} size={70} url={p.avatar_url} />
        <div className="grow"><h2>{p.username}</h2><div className="small muted">{flag} {p.country || ''} · Organisateur Arena</div></div>
      </div>
      {p.bio && <div className="card small" style={{ marginBottom: 10 }}>{p.bio}</div>}
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat"><b>{org?.organized ?? 0}</b><span className="small muted">Organisées</span></div>
        <div className="stat"><b>{org?.finished ?? 0}</b><span className="small muted">Terminées</span></div>
        <div className="stat"><b>{org?.reliability_pct != null ? org.reliability_pct + ' %' : '–'}</b><span className="small muted">Fiabilité</span></div>
      </div>
      {!!upcoming.length && (
        <>
          <div className="sec" style={{ margin: '14px 0 8px' }}><h3>À venir et en cours</h3></div>
          <div className="stack">
            {upcoming.map((c: any) => (
              <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
                {c.image_url ? <div style={{ width: 48, height: 48, borderRadius: 10, background: `center/cover url(${c.image_url})`, flex: 'none' }} /> : <GameArt size={48} />}
                <div className="grow"><b>{c.name}</b><div className="small muted">{FORMATS[c.format]} · {c.registrations?.[0]?.count || 0}/{c.max_players} inscrits</div></div>
                <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!!past.length && (
        <>
          <div className="sec" style={{ margin: '14px 0 8px' }}><h3>Historique</h3></div>
          <div className="stack">
            {past.map((c: any) => (
              <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
                {c.image_url ? <div style={{ width: 48, height: 48, borderRadius: 10, background: `center/cover url(${c.image_url})`, flex: 'none' }} /> : <GameArt size={48} />}
                <div className="grow"><b>{c.name}</b></div>
                <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!upcoming.length && !past.length && <div className="card small muted">Aucune compétition organisée pour le moment.</div>}
    </section>
  )
}
