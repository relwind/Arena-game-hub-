import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, Top, Spin, ErrBox, errMsg, namesOf } from '../lib/ui'

export function Play() {
  const { me, toast } = useApp()
  const [mode, setMode] = useState('1v1')
  const [aud, setAud] = useState('public')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, loading, reload } = useLoad(async () => {
    const mine = await q<any[]>(sb.from('room_players').select('room_id').eq('user_id', me.id))
    let room: any = null, players: any[] = [], names: Record<string, string> = {}
    if (mine.length) {
      room = await q(sb.from('rooms').select('id,code,mode,audience,capacity,host_id,status').eq('id', mine[0].room_id).single())
      players = await q<any[]>(sb.from('room_players').select('user_id').eq('room_id', room.id))
      names = await namesOf(players.map((p) => p.user_id))
    }
    const open = room ? [] : await q<any[]>(sb.from('rooms').select('id,code,mode,host_id').eq('status', 'open').eq('audience', 'public').order('created_at', { ascending: false }).limit(15))
    const hn = await namesOf(open.map((r) => r.host_id))
    return { room, players, names, open, hn }
  }, [me.id], 5000)

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setErr('')
    try { await fn(); if (ok) toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const rate = (rated: string, rating: string) => act(() => rpc('rate_friendly', { _room: data!.room.id, _rated: rated, _rating: rating }), 'Merci pour ton évaluation')

  return (
    <section className="screen">
      <Top title="Jouer" back={false} />
      {loading && !data ? <Spin /> : data?.room ? (
        <div className="stack">
          <div className="card center">
            <div className="small muted">Code de ta salle</div>
            <div className="arena-id" style={{ fontSize: 30 }}>{data.room.code}</div>
            <div className="small muted">{data.room.mode} · {data.players.length}/{data.room.capacity} joueurs</div>
          </div>
          <div className="card stack">
            <b>Joueurs</b>
            {data.players.map((p: any) => (
              <div key={p.user_id} className="row small">
                <span className="grow">{data.names[p.user_id]}{p.user_id === data.room.host_id ? ' · hôte' : ''}{p.user_id === me.id ? ' (toi)' : ''}</span>
                {p.user_id !== me.id && (
                  <div className="chips">
                    <button className="chip" onClick={() => rate(p.user_id, 'fair')}>Fair-play</button>
                    <button className="chip" onClick={() => rate(p.user_id, 'ok')}>Correct</button>
                    <button className="chip" onClick={() => rate(p.user_id, 'problem')}>Problème</button>
                  </div>
                )}
              </div>
            ))}
            <div className="small muted">Partage le code à ton ami, puis lancez la partie dans eFootball.</div>
          </div>
          <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('leave_room', { _room: data.room.id }), 'Salle quittée')}>Quitter la salle</button>
        </div>
      ) : (
        <div className="stack">
          <div className="card stack">
            <b>Créer une salle</b>
            <div className="seg">{['1v1', '2v2'].map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m}</button>)}</div>
            <div className="seg">{[['public', 'Publique'], ['friends', 'Amis'], ['invite', 'Sur invitation']].map(([k, l]) => <button key={k} className={aud === k ? 'on' : ''} onClick={() => setAud(k)}>{l}</button>)}</div>
            <button className="btn" disabled={busy} onClick={() => act(() => rpc('create_room', { _mode: mode, _audience: aud, _live: false }), 'Salle créée')}>Créer la salle</button>
          </div>
          <div className="card stack">
            <b>Rejoindre avec un code</b>
            <input className="in" placeholder="ARN-xxxx" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" />
            <button className="btn ghost" disabled={busy || !code.trim()} onClick={() => act(() => rpc('join_room', { _code: code }), 'Salle rejointe')}>Rejoindre</button>
          </div>
          <div className="sec"><h3>Salles publiques</h3></div>
          {!data?.open.length && <div className="card small muted">Aucune salle ouverte.</div>}
          {data?.open.map((r: any) => (
            <button key={r.id} className="item" onClick={() => act(() => rpc('join_room', { _code: r.code }), 'Salle rejointe')}>
              <div className="grow"><b>{data.hn[r.host_id] || 'Joueur'}</b><div className="small muted">{r.mode} · {r.code}</div></div>
              <span className="badge b-ok">Rejoindre</span>
            </button>
          ))}
        </div>
      )}
      <ErrBox text={err} />
    </section>
  )
}
