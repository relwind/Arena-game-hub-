import React, { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, fmt, hhmm, Top, Spin, ErrBox, errMsg, namesOf } from '../lib/ui'

export function MatchRoom({ id }: { id: string }) {
  const { me, toast } = useApp()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sa, setSa] = useState('')
  const [sb_, setSb] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [dispute, setDispute] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  const { data, loading, reload } = useLoad(async () => {
    const m = await q<any>(sb.from('matches').select('*').eq('id', id).single())
    const [comp, results, msgs, room, disp, ident] = await Promise.all([
      q<any>(sb.from('competitions').select('id,name,match_preset,organizer_id,status').eq('id', m.competition_id).single()),
      q<any[]>(sb.from('match_results').select('user_id,score_a,score_b').eq('match_id', id)),
      q<any[]>(sb.from('match_messages').select('id,user_id,kind,body,created_at').eq('match_id', id).order('created_at').limit(200)),
      q<any>(sb.from('match_room').select('room_code').eq('match_id', id).maybeSingle()),
      q<any[]>(sb.from('disputes').select('id,status,reason,opened_by').eq('match_id', id)),
      q<any[]>(sb.from('player_identity').select('user_id,arena_id,efootball_name').in('user_id', [m.player_a, m.player_b].filter(Boolean))),
    ])
    const names = await namesOf([m.player_a, m.player_b, ...msgs.map((x) => x.user_id)])
    const staff = await q<any[]>(sb.from('competition_staff').select('status').eq('competition_id', m.competition_id).eq('user_id', me.id))
    return { m, comp, results, msgs, room, disp, ident, names, isStaff: comp.organizer_id === me.id || staff.some((s) => s.status === 'active') || me.roles.includes('admin') }
  }, [id], 4000)

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }) }, [data?.msgs.length])

  if (loading && !data) return <section className="screen"><Top title="Match" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Match" /><div className="card">Match introuvable.</div></section>
  const { m, comp, results, msgs, room, disp, ident, names, isStaff } = data as any
  const iA = m.player_a === me.id, iB = m.player_b === me.id, player = iA || iB
  const oppId = iA ? m.player_b : m.player_a
  const oppIdent = ident.find((x: any) => x.user_id === oppId)
  const myReady = iA ? m.ready_a_at : m.ready_b_at
  const oppReady = iA ? m.ready_b_at : m.ready_a_at
  const myResult = results.find((r: any) => r.user_id === me.id)
  const oppResult = results.find((r: any) => r.user_id !== me.id)
  const openDispute = disp.find((d: any) => d.status === 'open')
  const decided = !!m.winner_id
  const checkinAt = m.scheduled_at ? new Date(m.scheduled_at).getTime() - 3600e3 : 0
  const preMatch = !decided && Date.now() < checkinAt
  const A = names[m.player_a] || '?', B = names[m.player_b] || '?'

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setErr('')
    try { await fn(); if (ok) toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const send = async () => {
    const t = msg.trim(); if (!t) return
    setMsg('')
    await act(async () => { await q(sb.from('match_messages').insert({ match_id: id, user_id: me.id, body: t })) })
  }
  const submitScore = () => {
    const a = Number(sa), b = Number(sb_)
    if (sa === '' || sb_ === '' || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return setErr('Entre les deux scores.')
    if (a === b) return setErr("Égalité impossible : indique le score final (prolongation ou tirs au but).")
    act(() => rpc('submit_result', { _match: id, _sa: a, _sb: b }), 'Score envoyé')
  }

  return (
    <section className="screen">
      <Top title="Salle du match" />
      <div className="card center">
        <div className="small muted">{comp.name}</div>
        <div className="row" style={{ justifyContent: 'center', margin: '10px 0' }}>
          <h3 className="grow" style={{ textAlign: 'right' }}>{A}</h3>
          <div style={{ fontFamily: 'var(--display)', fontSize: 24 }}>{decided && !m.forfeit ? `${m.score_a} – ${m.score_b}` : 'VS'}</div>
          <h3 className="grow" style={{ textAlign: 'left' }}>{B}</h3>
        </div>
        <div className="small muted">{fmt(m.scheduled_at)}</div>
        {player && oppIdent && (
          <div className="small" style={{ marginTop: 8 }}>
            ID Arena de ton adversaire : <span className="arena-id">{oppIdent.arena_id}</span>
            {oppIdent.efootball_name ? <div className="muted">Nom eFootball : {oppIdent.efootball_name}</div> : null}
          </div>
        )}
      </div>

      {decided && (
        <div className="card mt" style={{ borderColor: 'var(--ok)' }}>
          <b>{m.forfeit ? (m.no_show ? 'Forfait (absence)' : 'Forfait (abandon)') : 'Résultat validé'}</b>
          <div className="small">Vainqueur : {names[m.winner_id] || '…'}{m.auto_validated ? ' (validé automatiquement)' : ''}</div>
          {player && !m.forfeit && !openDispute && (
            dispute === null ? <button className="btn ghost mt" onClick={() => setDispute('')}>Contester le résultat</button> : (
              <div className="stack mt">
                <textarea className="in" placeholder="Explique le problème" value={dispute} onChange={(e) => setDispute(e.target.value)} />
                <div className="row">
                  <button className="btn ghost" onClick={() => setDispute(null)}>Retour</button>
                  <button className="btn" disabled={busy || dispute.trim().length < 3} onClick={() => act(async () => { await rpc('open_dispute', { _match: id, _reason: dispute }); setDispute(null) }, 'Contestation envoyée')}>Envoyer</button>
                </div>
              </div>
            )
          )}
        </div>
      )}
      {openDispute && <div className="card mt small" style={{ borderColor: 'var(--live)' }}><b>Contestation en cours</b><div>{openDispute.reason}</div><div className="muted">L'organisateur va examiner le dossier.</div></div>}

      {player && !decided && m.player_a && m.player_b && (
        <div className="card stack mt">
          {preMatch ? (
            <div className="small">Le check-in ouvre à <b>{hhmm(new Date(checkinAt).toISOString())}</b> (1 h avant le match).</div>
          ) : (
            <>
              <div className="row small">
                <span className={'badge ' + (myReady ? 'b-ok' : 'b-wait')}>Toi : {myReady ? 'prêt' : 'pas prêt'}</span>
                <span className={'badge ' + (oppReady ? 'b-ok' : 'b-wait')}>Adversaire : {oppReady ? 'prêt' : 'pas prêt'}</span>
              </div>
              {!myReady && <button className="btn" disabled={busy} onClick={() => act(() => rpc('set_ready', { _match: id }), 'Tu es prêt')}>Je suis prêt</button>}
              {m.ready_both_at && !m.host_id && (
                <>
                  <div className="small">Qui crée la salle dans eFootball ? (sinon, {A} sera hôte dans 2 minutes)</div>
                  <div className="row">
                    <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('choose_host', { _match: id, _host: me.id }))}>Moi</button>
                    <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('choose_host', { _match: id, _host: oppId }))}>Mon adversaire</button>
                  </div>
                </>
              )}
              {m.host_id && (
                <>
                  <div className="small">Hôte : <b>{m.host_id === me.id ? 'toi' : names[m.host_id]}</b></div>
                  {room?.room_code && <div className="card small" style={{ borderColor: 'var(--gold)' }}>Code de la salle eFootball : <b className="arena-id">{room.room_code}</b></div>}
                  {m.host_id === me.id && !room?.room_code && (
                    <div className="row">
                      <input className="in" placeholder="Code de ta salle eFootball" value={code} onChange={(e) => setCode(e.target.value)} />
                      <button className="btn" style={{ width: 'auto' }} disabled={busy || !code.trim()} onClick={() => act(async () => { await rpc('post_room_code', { _match: id, _code: code }); setCode('') }, 'Code envoyé')}>Envoyer</button>
                    </div>
                  )}
                  {room?.room_code && !m.kicked_at && <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('mark_kicked', { _match: id }), 'Bon match !')}>La partie est lancée</button>}
                </>
              )}
              {m.over && <div className="small" style={{ color: 'var(--live)' }}>Durée maximale dépassée : envoyez le score maintenant.</div>}
            </>
          )}
        </div>
      )}

      {player && !decided && m.player_a && m.player_b && !preMatch && (
        <div className="card stack mt">
          <b>Score final</b>
          {myResult ? (
            <div className="small">Ton score envoyé : {A} {myResult.score_a} – {myResult.score_b} {B}.{' '}
              {oppResult ? "Les scores ne correspondent pas : l'organisateur va trancher." : "En attente de l'adversaire (validation automatique après 15 minutes)."}</div>
          ) : (
            <>
              <div className="row">
                <label className="f grow">{A}<input className="in" type="number" inputMode="numeric" min={0} value={sa} onChange={(e) => setSa(e.target.value)} /></label>
                <label className="f grow">{B}<input className="in" type="number" inputMode="numeric" min={0} value={sb_} onChange={(e) => setSb(e.target.value)} /></label>
              </div>
              <button className="btn" disabled={busy} onClick={submitScore}>Envoyer le score</button>
            </>
          )}
          <div className="row">
            <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('report_disconnect', { _match: id }), 'Déconnexion signalée : 5 minutes pour revenir')}>J'ai perdu la connexion</button>
            <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('report_return', { _match: id }), 'Content de te revoir')}>Je suis revenu</button>
          </div>
        </div>
      )}

      {isStaff && !player && !decided && m.player_a && m.player_b && (
        <div className="card stack mt" style={{ borderColor: 'var(--gold)' }}>
          <b>Organisation</b>
          {results.map((r: any) => <div key={r.user_id} className="small">Score de {names[r.user_id] || 'joueur'} : {r.score_a} – {r.score_b}</div>)}
          <div className="row">
            <label className="f grow">{A}<input className="in" type="number" inputMode="numeric" value={sa} onChange={(e) => setSa(e.target.value)} /></label>
            <label className="f grow">{B}<input className="in" type="number" inputMode="numeric" value={sb_} onChange={(e) => setSb(e.target.value)} /></label>
          </div>
          <button className="btn" disabled={busy} onClick={() => act(() => rpc('staff_set_result', { _match: id, _sa: Number(sa), _sb: Number(sb_) }), 'Résultat fixé')}>Fixer le résultat</button>
        </div>
      )}

      {isStaff && openDispute && (
        <div className="card stack mt" style={{ borderColor: 'var(--gold)' }}>
          <b>Contestation</b>
          <div className="row">
            <label className="f grow">{A}<input className="in" type="number" inputMode="numeric" value={sa} onChange={(e) => setSa(e.target.value)} /></label>
            <label className="f grow">{B}<input className="in" type="number" inputMode="numeric" value={sb_} onChange={(e) => setSb(e.target.value)} /></label>
          </div>
          <button className="btn" disabled={busy} onClick={() => act(() => rpc('resolve_dispute', { _dispute: openDispute.id, _accept: true, _sa: Number(sa), _sb: Number(sb_) }), 'Résultat corrigé')}>Accepter et corriger le score</button>
          <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('resolve_dispute', { _dispute: openDispute.id, _accept: false }), 'Contestation rejetée')}>Rejeter la contestation</button>
        </div>
      )}

      <ErrBox text={err} />

      {(player || isStaff) && (
        <div className="card mt">
          <b>Messages</b>
          <div className="stack" style={{ margin: '10px 0', maxHeight: 260, overflowY: 'auto' }}>
            {!msgs.length && <div className="small muted">Échangez ici votre code eFootball et vos messages.</div>}
            {msgs.map((x: any) => (
              <div key={x.id} className={'bubble' + (x.user_id === me.id ? ' me' : '') + (x.kind === 'code' ? ' code' : '')}>
                <small>{x.user_id === me.id ? 'Toi' : names[x.user_id]}{x.kind === 'code' ? ' · code de salle' : ''}</small>{x.body}
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          {player && (
            <div className="row">
              <input className="in" placeholder="Écrire un message" value={msg} maxLength={500} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button className="btn" style={{ width: 'auto' }} onClick={send}>Envoyer</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function MyMatches() {
  const { me, nav } = useApp()
  const { data, loading } = useLoad(async () => {
    const ms = await q<any[]>(sb.from('matches').select('id,player_a,player_b,winner_id,score_a,score_b,scheduled_at,forfeit,competition_id').eq('bye', false)
      .or(`player_a.eq.${me.id},player_b.eq.${me.id}`).order('scheduled_at', { ascending: false }).limit(50))
    const names = await namesOf(ms.flatMap((m) => [m.player_a, m.player_b]))
    return { ms, names }
  }, [me.id])
  return (
    <section className="screen">
      <Top title="Mes matchs" />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {!data?.ms.length && <div className="card small muted">Aucun match pour le moment.</div>}
          {data?.ms.map((m: any) => {
            const opp = m.player_a === me.id ? m.player_b : m.player_a
            return (
              <button key={m.id} className="item" onClick={() => nav.go('match', { id: m.id })}>
                <div className="grow"><b>vs {data.names[opp] || 'à déterminer'}</b><div className="small muted">{fmt(m.scheduled_at)}</div></div>
                {m.winner_id ? <span className={'badge ' + (m.winner_id === me.id ? 'b-ok' : 'b-wait')}>{m.winner_id === me.id ? 'Victoire' : 'Défaite'}{!m.forfeit ? ` ${m.score_a}-${m.score_b}` : ''}</span> : <span className="badge b-gold">À jouer</span>}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
