import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, fmt, hhmm, inTxt, leftTxt, STATUS, FORMATS, Spin, namesOf, GameArt, Av } from '../lib/ui'

const ICON = {
  plus: 'M12 5v14M5 12h14',
  lock: 'M4 10h16v10H4zM8 10V7a4 4 0 018 0v3',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  search: 'M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4.5-4.5',
}

function Card({ c, onOpen }: { c: any; onOpen: () => void }) {
  const full = c.status === 'open' && c.n >= c.max_players
  return (
    <button className="card stack" onClick={onOpen} style={{ minWidth: 190, maxWidth: 190, textAlign: 'left', flex: 'none', color: 'var(--text)' }}>
      <div className="row"><GameArt size={40} /><div className="grow small muted">{c.status === 'open' ? inTxt(c.start_at) : STATUS[c.status][0]}</div></div>
      <b style={{ fontSize: 14 }}>{c.name}</b>
      <div className="small muted">{full ? 'Complet' : `${c.n}/${c.max_players} inscrits`}</div>
    </button>
  )
}

export function Home() {
  const { me, nav } = useApp()
  const [hideStart, setHideStart] = useState(() => { try { return localStorage.getItem('arena_start_hidden') === '1' } catch { return false } })
  const { data, loading } = useLoad(async () => {
    const [unread, mine, comps, mymatches, anyReg] = await Promise.all([
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', me.id).is('read_at', null),
      q<any[]>(sb.from('registrations').select('competition_id,status').eq('user_id', me.id).in('status', ['registered', 'waitlist'])),
      q<any[]>(sb.from('competitions').select('id,name,start_at,max_players,format,status,registrations(count)').in('status', ['open', 'closed', 'ongoing']).order('start_at').limit(40)),
      q<any[]>(sb.from('matches').select('id,competition_id,player_a,player_b,scheduled_at,round_index,phase').is('winner_id', null).eq('bye', false).not('player_a', 'is', null).not('player_b', 'is', null)
        .or(`player_a.eq.${me.id},player_b.eq.${me.id}`).order('scheduled_at').limit(3)),
      sb.from('registrations').select('competition_id', { count: 'exact', head: true }).eq('user_id', me.id),
    ])
    const list = comps.map((c) => ({ ...c, n: c.registrations?.[0]?.count || 0 }))
    const myIds = mine.map((m) => m.competition_id)
    const hero = list.find((c) => myIds.includes(c.id)) || list.find((c) => c.status === 'ongoing') || list.find((c) => c.status === 'open') || null
    const open = list.filter((c) => c.status === 'open' && !myIds.includes(c.id) && c.n < c.max_players).slice(0, 6)
    const pop = [...list].sort((a, b) => b.n - a.n).slice(0, 6)
    const names = await namesOf(mymatches.flatMap((m) => [m.player_a, m.player_b]))
    const compName: Record<string, string> = {}
    list.forEach((c) => (compName[c.id] = c.name))
    return { unread: unread.count || 0, hero, heroMine: hero && myIds.includes(hero.id), open, pop, up: mymatches, names, compName, hasReg: (anyReg.count || 0) > 0 }
  }, [me.id], 20000)

  const steps = [
    { t: 'Renseigne ton nom eFootball', done: !!me.ident?.efootball_name, go: () => nav.tab('me') },
    { t: 'Inscris-toi à une compétition', done: !!data?.hasReg, go: () => nav.tab('comps') },
    { t: 'Lis les règles des matchs', done: (() => { try { return localStorage.getItem('arena_rules_read') === '1' } catch { return false } })(), go: () => nav.go('rules') },
  ]
  const nDone = steps.filter((s) => s.done).length
  const hide = () => { try { localStorage.setItem('arena_start_hidden', '1') } catch { /* */ } setHideStart(true) }
  const ico = (d: string) => <svg viewBox="0 0 24 24"><path d={d} /></svg>

  return (
    <section className="screen">
      <div className="row" style={{ marginBottom: 16 }}>
        <Av name={me.profile?.username} size={54} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Bonjour, {me.profile?.username}</h2>
          <div className="small muted">Prêt à jouer ?</div>
        </div>
        <button className="ib" onClick={() => nav.go('search')} aria-label="Amis"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg></button>
        <button className="ib" onClick={() => nav.go('notifs')} aria-label="Notifications">
          <svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4" /></svg>
          {!!data?.unread && <span className="cnt">{data.unread}</span>}
        </button>
      </div>

      {loading && !data ? <Spin /> : (
        <>
          <div className="hero">
            <svg className="floaty" style={{ position: 'absolute', right: 16, top: 14, width: 74, opacity: .9 }} viewBox="0 0 24 24" fill="none" stroke="#F5B83D" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8" /></svg>
            {data?.hero ? (
              <>
                <span className="badge b-gold">{data.heroMine ? 'Ta compétition' : STATUS[data.hero.status][0]}</span>
                <h3 style={{ marginTop: 8 }}>{data.hero.name}</h3>
                <div className="small" style={{ opacity: .8, marginBottom: 12 }}>{FORMATS[data.hero.format]} · {fmt(data.hero.start_at)}</div>
                <button className="btn gold" style={{ width: 'auto', padding: '9px 22px' }} onClick={() => nav.go('cdetail', { id: data.hero.id })}>Voir</button>
              </>
            ) : (
              <>
                <h3>Aucune compétition pour le moment</h3>
                <div className="small" style={{ opacity: .8, marginBottom: 12 }}>Crée une salle pour jouer avec un ami.</div>
                <button className="btn gold" style={{ width: 'auto', padding: '9px 22px' }} onClick={() => nav.go('rcreate')}>Créer une salle</button>
              </>
            )}
          </div>

          <div className="qa">
            <button onClick={() => nav.go('rcreate')}>{ico(ICON.plus)}Créer une salle</button>
            <button onClick={() => nav.go('rjoin')}>{ico(ICON.lock)}Rejoindre</button>
            <button onClick={() => nav.go('mymatches')}>{ico(ICON.clock)}Mon planning</button>
            <button onClick={() => nav.go('search')}>{ico(ICON.search)}Recherche</button>
          </div>

          {!hideStart && nDone < 3 && (
            <div className="card stack" style={{ marginTop: 14 }}>
              <div className="row"><b className="grow">Pour commencer ({nDone}/3)</b><button className="small muted" style={{ background: 'none', border: 0 }} onClick={hide}>Masquer</button></div>
              {steps.map((s) => (
                <button key={s.t} className="item" onClick={s.go}>
                  <div className="tile" style={{ width: 28, height: 28, fontSize: 13, background: s.done ? 'var(--ok)' : 'var(--panel2)' }}>{s.done ? '✓' : '·'}</div>
                  <div className="grow" style={s.done ? { opacity: .6, textDecoration: 'line-through' } : undefined}>{s.t}</div><span className="muted">›</span>
                </button>
              ))}
            </div>
          )}

          <div className="sec"><h3>À rejoindre</h3><a onClick={() => nav.tab('comps')}>Tout voir</a></div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {data?.open.length ? data.open.map((c: any) => <Card key={c.id} c={c} onOpen={() => nav.go('cdetail', { id: c.id })} />)
              : <div className="card small muted" style={{ width: '100%' }}>Aucune compétition ouverte pour le moment.</div>}
          </div>

          <div className="sec"><h3>Populaires</h3></div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {data?.pop.length ? data.pop.map((c: any) => <Card key={c.id} c={c} onOpen={() => nav.go('cdetail', { id: c.id })} />)
              : <div className="card small muted" style={{ width: '100%' }}>Rien pour le moment.</div>}
          </div>

          <div className="sec"><h3>À venir</h3><a onClick={() => nav.go('mymatches')}>Mon planning</a></div>
          <div className="stack">
            {!data?.up.length && <div className="card small muted">Aucun match prévu. Inscris-toi à une compétition.</div>}
            {data?.up.map((m: any) => {
              const opp = m.player_a === me.id ? m.player_b : m.player_a
              return (
                <button key={m.id} className="item" onClick={() => nav.go('match', { id: m.id })}>
                  <div className="tile" style={{ width: 54, height: 54, fontSize: 14, background: 'var(--panel2)' }}>{hhmm(m.scheduled_at)}</div>
                  <div className="grow"><b>{data.compName[m.competition_id] || 'Compétition'} · vs {data.names[opp] || '…'}</b>
                    <div className="small muted">{fmt(m.scheduled_at)} · {leftTxt(m.scheduled_at)}</div></div><span className="muted">›</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
