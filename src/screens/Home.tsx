import React from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, fmt, STATUS, FORMATS, Spin, namesOf } from '../lib/ui'

export function Home() {
  const { me, nav } = useApp()
  const { data, loading } = useLoad(async () => {
    const [unread, mine, open] = await Promise.all([
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', me.id).is('read_at', null),
      q<any[]>(sb.from('registrations').select('competition_id,status').eq('user_id', me.id).in('status', ['registered', 'waitlist'])),
      q<any[]>(sb.from('competitions').select('id,name,start_at,max_players,format,status').eq('status', 'open').order('start_at').limit(5)),
    ])
    let comp: any = null, next: any = null, names: Record<string, string> = {}
    if (mine.length) {
      comp = await q(sb.from('competitions').select('id,name,start_at,status,format').eq('id', mine[0].competition_id).single())
      const ms = await q<any[]>(sb.from('matches').select('id,player_a,player_b,scheduled_at,round_index,phase').eq('competition_id', comp.id)
        .is('winner_id', null).eq('bye', false).or(`player_a.eq.${me.id},player_b.eq.${me.id}`).order('scheduled_at').limit(1))
      next = ms[0] || null
      if (next) names = await namesOf([next.player_a, next.player_b])
    }
    return { unread: unread.count || 0, comp, reg: mine[0], next, names, open }
  }, [me.id], 15000)

  const initial = (me.profile?.username || '?').slice(0, 1).toUpperCase()
  return (
    <section className="screen">
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="tile" style={{ borderRadius: '50%', background: 'linear-gradient(135deg,#2f7bff,#35d0ff)' }}>{initial}</div>
        <div className="grow">
          <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Bonjour, {me.profile?.username}</h2>
          <div className="small muted">Ton ID Arena : <span className="arena-id">{me.ident?.arena_id || '…'}</span></div>
        </div>
        <button className="ib" onClick={() => nav.go('notifs')} aria-label="Notifications">
          <svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4" /></svg>
          {!!data?.unread && <span className="cnt">{data.unread}</span>}
        </button>
      </div>

      {loading && !data ? <Spin /> : (
        <>
          {data?.comp ? (
            <div className="hero">
              <span className="badge b-gold">{data.reg.status === 'waitlist' ? "Liste d'attente" : STATUS[data.comp.status]?.[0]}</span>
              <h3 style={{ marginTop: 8 }}>{data.comp.name}</h3>
              <div className="small" style={{ opacity: .8, marginBottom: 12 }}>{FORMATS[data.comp.format]} · {fmt(data.comp.start_at)}</div>
              <button className="btn gold" style={{ width: 'auto', padding: '9px 22px' }} onClick={() => nav.go('cdetail', { id: data.comp.id })}>Voir</button>
            </div>
          ) : (
            <div className="hero">
              <h3>Aucune compétition en cours</h3>
              <div className="small" style={{ opacity: .8, marginBottom: 12 }}>Inscris-toi à une compétition pour jouer.</div>
              <button className="btn gold" style={{ width: 'auto', padding: '9px 22px' }} onClick={() => nav.tab('comps')}>Voir les compétitions</button>
            </div>
          )}

          {data?.next && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="small muted">Ton prochain match</div>
              <h3 style={{ margin: '4px 0' }}>{data.names[data.next.player_a] || 'À déterminer'} vs {data.names[data.next.player_b] || 'À déterminer'}</h3>
              <div className="small muted" style={{ marginBottom: 10 }}>{fmt(data.next.scheduled_at)}</div>
              <button className="btn" onClick={() => nav.go('match', { id: data.next.id })}>Ouvrir la salle du match</button>
            </div>
          )}

          <div className="qa">
            <button onClick={() => nav.tab('play')}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Créer une salle</button>
            <button onClick={() => nav.tab('play')}><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>Rejoindre</button>
            <button onClick={() => nav.go('mymatches')}><svg viewBox="0 0 24 24"><path d="M5 4v16M5 5h11l-2 4 2 4H5" /></svg>Mes matchs</button>
            <button onClick={() => nav.tab('live')}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5" /><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4" /></svg>Live</button>
          </div>

          <div className="sec"><h3>Inscriptions ouvertes</h3><a onClick={() => nav.tab('comps')}>Tout voir</a></div>
          <div className="stack">
            {!data?.open.length && <div className="card small muted">Aucune compétition ouverte pour le moment.</div>}
            {data?.open.map((c: any) => (
              <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
                <div className="tile" style={{ background: 'linear-gradient(135deg,#1b3d9a,#35d0ff)' }}>EF</div>
                <div className="grow"><b>{c.name}</b><div className="small muted">{FORMATS[c.format]} · {fmt(c.start_at)}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
