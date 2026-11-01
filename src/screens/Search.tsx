import React, { useState } from 'react'
import { useApp, useLoad, rpc, Top, ErrBox, errMsg, Av } from '../lib/ui'

export function Search() {
  const { me, toast } = useApp()
  const [term, setTerm] = useState('')
  const [res, setRes] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  const { data: friends, reload } = useLoad(async () => (await rpc('list_friends')) as any[], [me.id], 15000)
  const find = async () => {
    setErr('')
    try { setRes((await rpc('search_players', { _q: term.trim() })) as any[]) } catch (e: any) { setErr(errMsg(e)) }
  }
  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast(ok); await reload(); if (term.trim()) await find() } catch (e: any) { toast(errMsg(e)) }
  }
  const inc = (friends || []).filter((f: any) => f.status === 'pending' && f.incoming)
  const acc = (friends || []).filter((f: any) => f.status === 'accepted')
  return (
    <section className="screen">
      <Top title="Recherche" />
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="in" placeholder="Pseudo ou identifiant AG-XXXXX" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
        <button className="btn" style={{ width: 'auto', padding: '10px 16px' }} disabled={term.trim().length < 2} onClick={find}>OK</button>
      </div>
      <ErrBox text={err} />
      {res && (
        <div className="stack" style={{ marginBottom: 14 }}>
          {!res.length && <div className="card small muted">Aucun joueur trouvé.</div>}
          {res.map((r: any) => (
            <div key={r.user_id} className="item" style={{ cursor: 'default' }}>
              <Av name={r.username} size={44} />
              <div className="grow"><b>{r.username}</b></div>
              {r.relation === 'none' && <button className="badge b-ok" style={{ border: 0 }} onClick={() => act(() => rpc('request_friend', { _other: r.user_id }), 'Demande envoyée')}>Ajouter</button>}
              {r.relation === 'sent' && <span className="badge b-wait">Envoyée</span>}
              {r.relation === 'friend' && <span className="badge b-ok">Ami</span>}
              {r.relation === 'incoming' && <button className="badge b-ok" style={{ border: 0 }} onClick={() => act(() => rpc('respond_friend', { _other: r.user_id, _accept: true }), 'Ami ajouté')}>Accepter</button>}
            </div>
          ))}
        </div>
      )}
      {!!inc.length && (
        <>
          <div className="sec"><h3>Demandes reçues</h3></div>
          <div className="stack">
            {inc.map((f: any) => (
              <div key={f.user_id} className="item" style={{ cursor: 'default' }}>
                <Av name={f.username} size={44} /><div className="grow"><b>{f.username}</b></div>
                <button className="badge b-ok" style={{ border: 0 }} onClick={() => act(() => rpc('respond_friend', { _other: f.user_id, _accept: true }), 'Ami ajouté')}>Accepter</button>
                <button className="badge b-wait" style={{ border: 0 }} onClick={() => act(() => rpc('respond_friend', { _other: f.user_id, _accept: false }), 'Refusée')}>Refuser</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sec"><h3>Mes amis</h3></div>
      <div className="stack">
        {!acc.length && <div className="card small muted">Aucun ami pour le moment.</div>}
        {acc.map((f: any) => <div key={f.user_id} className="item" style={{ cursor: 'default' }}><Av name={f.username} size={44} /><div className="grow"><b>{f.username}</b></div></div>)}
      </div>
    </section>
  )
}

export function Rules() {
  React.useEffect(() => { try { localStorage.setItem('arena_rules_read', '1') } catch { /* */ } }, [])
  const rules = [
    'Respecte ton adversaire : pas d\'insultes ni de triche.',
    'Sois présent à l\'heure : une absence prolongée donne forfait.',
    'Après le match, saisis le score honnêtement. En cas de désaccord, ouvre un litige avec preuve.',
    'Une déconnexion se signale dans l\'app : le staff décide de rejouer ou non.',
    'Un seul compte par joueur. L\'identifiant Arena est personnel.',
  ]
  return (
    <section className="screen">
      <Top title="Règles des matchs" />
      <div className="stack">{rules.map((r, i) => <div key={i} className="card row"><b style={{ color: 'var(--cyan)' }}>{i + 1}</b><div className="small grow">{r}</div></div>)}</div>
    </section>
  )
}
