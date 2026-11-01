import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, fmt, Top, Spin, ErrBox, errMsg } from '../lib/ui'
import { OrganizerHome } from './Manage'

export function Me() {
  const { me, nav, refreshMe, toast } = useApp()
  const [efb, setEfb] = useState<string | null>(null)
  const [size, setSize] = useState(() => { try { return localStorage.getItem('arena_scale') || 'g' } catch { return 'g' } })
  const { data, loading } = useLoad(async () => {
    const [st, rep, org, titles] = await Promise.all([
      rpc('player_stats', { _uid: me.id }),
      rpc('reputation_of', { _uid: me.id }),
      me.roles.includes('organizer') ? rpc('organizer_stats', { _uid: me.id }) : Promise.resolve(null),
      sb.from('competitions').select('id', { count: 'exact', head: true }).eq('champion_id', me.id),
    ])
    return { st: st?.[0] || st, rep, org: org?.[0] || org, titles: titles.count || 0 }
  }, [me.id])
  const isOrg = me.roles.includes('organizer')
  const st = data?.st

  const saveEfb = async () => {
    try {
      await q(sb.from('player_identity').update({ efootball_name: (efb || '').trim() || null }).eq('user_id', me.id))
      await refreshMe(); setEfb(null); toast('Nom eFootball enregistré')
    } catch (e: any) { toast(errMsg(e)) }
  }

  return (
    <section className="screen">
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="tile" style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,#2f7bff,#35d0ff)', fontSize: 24 }}>{(me.profile?.username || '?').slice(0, 1).toUpperCase()}</div>
        <div className="grow"><h2>{me.profile?.username}</h2><div className="small muted">{isOrg ? 'Organisateur' : 'Joueur Arena'}{me.roles.includes('admin') ? ' · Admin' : ''}</div></div>
      </div>

      <div className="card">
        <div className="small muted">Ton identifiant Arena</div>
        <div className="arena-id" style={{ fontSize: 22 }}>{me.ident?.arena_id}</div>
        <div className="small muted" style={{ marginTop: 4 }}>Tes adversaires le voient pour t'ajouter dans eFootball.</div>
        {efb === null ? (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="small grow">Nom eFootball : {me.ident?.efootball_name || 'non renseigné'}</div>
            <button className="badge b-ok" style={{ border: 0 }} onClick={() => setEfb(me.ident?.efootball_name || '')}>Modifier</button>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="in" value={efb} maxLength={40} onChange={(e) => setEfb(e.target.value)} />
            <button className="btn" style={{ width: 'auto' }} onClick={saveEfb}>OK</button>
          </div>
        )}
      </div>

      {loading && !data ? <Spin /> : (
        <>
          <div className="card mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="stat"><b>{st?.played ?? 0}</b><span className="small muted">Joué(s)</span></div>
            <div className="stat"><b>{st?.win_rate != null ? st.win_rate + ' %' : '–'}</b><span className="small muted">Taux de réussite</span></div>
            <div className="stat"><b>{data?.rep ?? 0}</b><span className="small muted">Réputation</span></div>
          </div>
          {isOrg && data?.org && (
            <>
              <div className="small muted" style={{ margin: '12px 0 6px' }}>Mes compétitions</div>
              <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
                <div className="stat"><b>{data.org.organized}</b><span className="small muted">Organisées</span></div>
                <div className="stat"><b>{data.org.finished}</b><span className="small muted">Terminées</span></div>
                <div className="stat"><b>{data.org.reliability_pct != null ? data.org.reliability_pct + ' %' : '–'}</b><span className="small muted">Fiabilité</span></div>
              </div>
            </>
          )}
          {st?.suspended_until && (
            <div className="card mt small" style={{ borderColor: '#ff8a3d', color: '#ffb86b' }}>
              Inscriptions suspendues jusqu'au {fmt(st.suspended_until)} (abandons ou absences répétés).
            </div>
          )}
        </>
      )}

      <div className="menu" style={{ marginTop: 16 }}>
        <button onClick={() => nav.go('mymatches')}>Mes matchs <span>›</span></button>
        <button onClick={() => nav.go('notifs')}>Notifications <span>›</span></button>
        <button onClick={() => nav.go('organizer')}>{isOrg ? 'Espace organisateur' : 'Devenir organisateur'} <span>›</span></button>
        {me.roles.includes('admin') && <button onClick={() => nav.go('admin')}>Panel administrateur <span>›</span></button>}
        <button onClick={() => sb.auth.signOut()}>Se déconnecter <span>›</span></button>
      </div>
      <div className="card stack" style={{ marginTop: 14 }}>
        <b>Taille du texte</b>
        <div className="seg">
          {[['p', 'Petit'], ['n', 'Normal'], ['g', 'Grand'], ['t', 'Très grand']].map(([k, l]) => (
            <button key={k} className={size === k ? 'on' : ''} onClick={() => { try { localStorage.setItem('arena_scale', k) } catch { /* */ } setSize(k); (window as any).__arenaRefit?.() }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="small muted" style={{ textAlign: 'center', marginTop: 14, opacity: .6 }}>
        {(() => { const f = (window as any).__arenaFit; return f ? `écran ${f.w}px · zoom ${Number(f.z).toFixed(2)} · dpr ${f.dpr}` : '' })()}
      </div>
    </section>
  )
}

export function Notifs() {
  const { me } = useApp()
  const { data, loading, reload } = useLoad(() => q<any[]>(sb.from('notifications').select('id,body,kind,read_at,created_at').eq('user_id', me.id).order('created_at', { ascending: false }).limit(60)), [me.id])
  const { data: bc } = useLoad(() => q<any[]>(sb.from('broadcasts').select('id,title,body,created_at').order('created_at', { ascending: false }).limit(3)), [me.id])
  const readAll = async () => { await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me.id).is('read_at', null); reload() }
  return (
    <section className="screen">
      <Top title="Notifications" right={<button className="small" style={{ background: 'none', border: 0, color: 'var(--cyan)' }} onClick={readAll}>Tout lire</button>} />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {bc?.map((b: any) => <div key={b.id} className="card small" style={{ borderColor: 'var(--gold)' }}><b>📢 {b.title}</b><div>{b.body}</div><div className="muted" style={{ marginTop: 4 }}>{fmt(b.created_at)}</div></div>)}
          {!data?.length && <div className="card small muted">Aucune notification.</div>}
          {data?.map((n: any) => (
            <div key={n.id} className="card small" style={n.read_at ? { opacity: .65 } : { borderColor: 'var(--blue)' }}>
              <div>{n.body}</div><div className="muted" style={{ marginTop: 4 }}>{fmt(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Organizer() {
  const { me, nav, refreshMe, toast } = useApp()
  const isOrg = me.roles.includes('organizer')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  const redeem = async () => {
    setErr('')
    try { await rpc('redeem_organizer_code', { _code: code }); await refreshMe(); toast('Tu es maintenant organisateur') } catch (e: any) { setErr(errMsg(e)) }
  }
  const request = async () => {
    setErr('')
    try { await q(sb.from('organizer_requests').insert({ user_id: me.id, message: msg.trim() || null })); setSent(true) } catch (e: any) { setErr(errMsg(e)) }
  }
  if (isOrg) return <OrganizerHome />
  return (
    <section className="screen">
      <Top title="Devenir organisateur" />
      <div className="stack">
        <div className="card small">Les organisateurs créent et gèrent des compétitions. Entre le code reçu de l'équipe Arena, ou envoie une demande.</div>
        <label className="f">Code organisateur<input className="in" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" /></label>
        <button className="btn" disabled={!code.trim()} onClick={redeem}>Valider le code</button>
        <div className="divider">ou</div>
        <label className="f">Message pour l'équipe (facultatif)<textarea className="in" value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        {sent ? <div className="small" style={{ color: 'var(--ok)' }}>Demande envoyée. Tu seras prévenu.</div> : <button className="btn ghost" onClick={request}>Envoyer une demande</button>}
        <ErrBox text={err} />
      </div>
    </section>
  )
}
