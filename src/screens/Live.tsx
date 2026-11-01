import React from 'react'
import { sb } from '../lib/supabase'
import { useLoad, q, Top, Spin, namesOf, fmt } from '../lib/ui'

export function Live() {
  const { data, loading } = useLoad(async () => {
    const ls = await q<any[]>(sb.from('live_sessions').select('id,match_id,competition_id,status,delay_seconds,started_at').eq('status', 'live').order('started_at', { ascending: false }).limit(30))
    const ms = ls.length ? await q<any[]>(sb.from('matches').select('id,player_a,player_b').in('id', ls.map((l) => l.match_id).filter(Boolean))) : []
    const cs = ls.length ? await q<any[]>(sb.from('competitions').select('id,name').in('id', ls.map((l) => l.competition_id).filter(Boolean))) : []
    const names = await namesOf(ms.flatMap((m) => [m.player_a, m.player_b]))
    return { ls, ms, cs, names }
  }, [], 10000)
  return (
    <section className="screen">
      <Top title="Live" back={false} />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {!data?.ls.length && <div className="card small muted">Aucun live en ce moment. Les joueurs choisissent eux-mêmes de diffuser leur écran depuis la bulle flottante.</div>}
          {data?.ls.map((l: any) => {
            const m = data.ms.find((x: any) => x.id === l.match_id)
            const c = data.cs.find((x: any) => x.id === l.competition_id)
            return (
              <div key={l.id} className="item">
                <div className="grow"><b>{m ? `${data.names[m.player_a]} vs ${data.names[m.player_b]}` : 'Match'}</b><div className="small muted">{c?.name} · depuis {fmt(l.started_at)}</div></div>
                <span className="badge b-live">LIVE</span>
              </div>
            )
          })}
          <div className="card small muted">Le visionnage vidéo sera disponible dans une prochaine version de l'application.</div>
        </div>
      )}
    </section>
  )
}
