import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, fmt, Top, Spin, ErrBox, errMsg, namesOf } from '../lib/ui'

const Empty = ({ t }: { t: string }) => <div className="card small muted">{t}</div>

export function Admin() {
  const { me, toast } = useApp()
  const [tab, setTab] = useState('req')
  const [err, setErr] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [until, setUntil] = useState('')
  const [why, setWhy] = useState('')

  const { data, loading, reload } = useLoad(async () => {
    const [req, rep, codes, sus, log, bc] = await Promise.all([
      q<any[]>(sb.from('organizer_requests').select('id,user_id,message,status,created_at').eq('status', 'pending').order('created_at')),
      q<any[]>(sb.from('reports').select('id,reporter_id,reported_id,reason,context,status,created_at').eq('status', 'open').order('created_at').limit(50)),
      q<any[]>(sb.from('organizer_codes').select('code,used_by,expires_at,created_at').order('created_at', { ascending: false }).limit(15)),
      q<any[]>(sb.from('organizer_suspensions').select('user_id,until,reason').order('created_at', { ascending: false }).limit(30)),
      q<any[]>(sb.from('admin_log').select('id,admin_id,action,target,created_at').order('created_at', { ascending: false }).limit(40)),
      q<any[]>(sb.from('broadcasts').select('id,title,body,created_at').order('created_at', { ascending: false }).limit(10)),
    ])
    const names = await namesOf([...req.map((r) => r.user_id), ...rep.flatMap((r) => [r.reporter_id, r.reported_id]), ...sus.map((s) => s.user_id), ...log.map((l) => l.admin_id)])
    return { req, rep, codes, sus, log, bc, names }
  }, [me.id], 20000)

  const act = async (fn: () => Promise<any>, ok: string) => {
    setErr('')
    try { await fn(); toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
  }
  const ck = async (r: any) => { if (r.error) throw new Error(errMsg(r.error)) }
  const nm = (id: string) => data?.names[id] || '…'

  const newCode = () => act(async () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    await ck(await sb.from('organizer_codes').insert({ code, created_by: me.id, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }))
  }, 'Code créé (valable 7 jours)')

  const suspend = () => act(async () => {
    const u = await q<any[]>(sb.from('profiles').select('id').ilike('username', pseudo.trim()).limit(1))
    if (!u.length) throw new Error('Pseudo introuvable.')
    if (!until) throw new Error('Choisis une date de fin.')
    await ck(await sb.from('organizer_suspensions').upsert({ user_id: u[0].id, until: new Date(until + 'T23:59:59').toISOString(), reason: why.trim() || 'Non précisé', by_admin: me.id }))
    setPseudo(''); setWhy('')
  }, 'Organisateur suspendu')

  const post = () => act(async () => {
    if (title.trim().length < 3 || body.trim().length < 3) throw new Error('Titre et message obligatoires.')
    await ck(await sb.from('broadcasts').insert({ author_id: me.id, title: title.trim(), body: body.trim() }))
    setTitle(''); setBody('')
  }, 'Annonce publiée')

  if (!me.roles.includes('admin')) return <section className="screen"><Top title="Administration" /><Empty t="Accès réservé aux administrateurs." /></section>

  return (
    <section className="screen">
      <Top title="Panel administrateur" />
      <div className="seg wrap" style={{ marginBottom: 14 }}>
        {[['req', `Demandes${data?.req.length ? ' ' + data.req.length : ''}`], ['rep', `Signalements${data?.rep.length ? ' ' + data.rep.length : ''}`], ['org', 'Organisateurs'], ['bc', 'Annonces'], ['log', 'Journal']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <ErrBox text={err} />
      {loading && !data ? <Spin /> : !data ? null : (
        <div className="stack">
          {tab === 'req' && (!data.req.length ? <Empty t="Aucune demande d'organisateur en attente." /> : data.req.map((r) => (
            <div key={r.id} className="card stack">
              <div className="row"><b className="grow">{nm(r.user_id)}</b><span className="small muted">{fmt(r.created_at)}</span></div>
              <div className="small">{r.message || 'Sans message.'}</div>
              <div className="row">
                <button className="btn ghost" onClick={() => act(() => rpc('admin_decide_organizer_request', { _req: r.id, _approve: false }), 'Demande refusée')}>Refuser</button>
                <button className="btn" onClick={() => act(() => rpc('admin_decide_organizer_request', { _req: r.id, _approve: true }), 'Organisateur validé')}>Accepter</button>
              </div>
            </div>
          )))}

          {tab === 'rep' && (!data.rep.length ? <Empty t="Aucun signalement ouvert." /> : data.rep.map((r) => (
            <div key={r.id} className="card stack">
              <div className="small"><b>{nm(r.reported_id)}</b> signalé par {nm(r.reporter_id)} · <span className="muted">{fmt(r.created_at)}</span></div>
              <div className="small">Motif : {r.reason}</div>
              {r.context && <div className="small muted">{r.context}</div>}
              <button className="btn ghost" onClick={() => act(async () => ck(await sb.from('reports').update({ status: 'handled', handled_by: me.id }).eq('id', r.id)), 'Signalement traité')}>Marquer comme traité</button>
            </div>
          )))}

          {tab === 'org' && (
            <>
              <div className="card stack">
                <b>Code organisateur</b>
                <div className="small muted">Donne ce code à une personne vérifiée : elle le saisit dans « Devenir organisateur ». Un code ne sert qu'une fois.</div>
                <button className="btn" onClick={newCode}>Générer un code</button>
                {data.codes.map((c) => (
                  <div key={c.code} className="row small"><b className="grow" style={{ letterSpacing: '.12em' }}>{c.code}</b>
                    <span className={'badge ' + (c.used_by ? 'b-wait' : 'b-ok')}>{c.used_by ? 'Utilisé' : 'Libre'}</span></div>
                ))}
              </div>
              <div className="card stack">
                <b>Suspendre un organisateur</b>
                <input className="in" placeholder="Pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
                <input className="in" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                <input className="in" placeholder="Motif" maxLength={120} value={why} onChange={(e) => setWhy(e.target.value)} />
                <button className="btn" onClick={suspend}>Suspendre</button>
              </div>
              {data.sus.map((s) => (
                <div key={s.user_id} className="item" style={{ cursor: 'default' }}>
                  <div className="grow"><b>{nm(s.user_id)}</b><div className="small muted">Jusqu'au {fmt(s.until)} · {s.reason}</div></div>
                  <button className="badge b-ok" style={{ border: 0 }} onClick={() => act(async () => ck(await sb.from('organizer_suspensions').delete().eq('user_id', s.user_id)), 'Suspension levée')}>Lever</button>
                </div>
              ))}
            </>
          )}

          {tab === 'bc' && (
            <>
              <div className="card stack">
                <b>Nouvelle annonce</b>
                <input className="in" placeholder="Titre" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea className="in" rows={3} placeholder="Message pour tous les joueurs" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} />
                <button className="btn" onClick={post}>Publier</button>
              </div>
              {data.bc.map((b) => <div key={b.id} className="card small"><b>{b.title}</b><div>{b.body}</div><div className="muted" style={{ marginTop: 4 }}>{fmt(b.created_at)}</div></div>)}
            </>
          )}

          {tab === 'log' && (!data.log.length ? <Empty t="Aucune action enregistrée." /> : data.log.map((l) => (
            <div key={l.id} className="card small"><b>{l.action}</b> · {nm(l.admin_id)}<div className="muted">{l.target} · {fmt(l.created_at)}</div></div>
          )))}
        </div>
      )}
    </section>
  )
}
