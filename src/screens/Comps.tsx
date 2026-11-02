import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { CoverPicker } from '../lib/img'
import { useApp, useLoad, q, rpc, fmt, hhmm, STATUS, FORMATS, PRESETS, Top, Spin, ErrBox, errMsg, namesOf, GameArt, Av } from '../lib/ui'

const GROUPS: Record<string, string[]> = { avenir: ['open', 'closed'], encours: ['ongoing'], termine: ['finished', 'cancelled'] }

const DAYS = Array.from({ length: 14 }, (_, i) => i)
const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

export function Comps() {
  const { me, nav } = useApp()
  const [tab, setTab] = useState('avenir')
  const [scope, setScope] = useState('Toutes')
  const [day, setDay] = useState(-1)
  const [search, setSearch] = useState('')
  const { data, loading, err } = useLoad(async () => {
    const [rows, mine] = await Promise.all([
      q<any[]>(sb.from('competitions').select('id,name,status,start_at,max_players,format,organizer_id,prize,image_url,registrations(count)').in('status', GROUPS[tab]).order('start_at', { ascending: tab === 'avenir' }).limit(80)),
      q<any[]>(sb.from('registrations').select('competition_id').eq('user_id', me.id).in('status', ['registered', 'waitlist', 'eliminated', 'done'])),
    ])
    const names = await namesOf(rows.map((r) => r.organizer_id))
    const mySet = new Set(mine.map((m) => m.competition_id))
    return rows.map((r) => ({ ...r, org: names[r.organizer_id] || 'Organisateur', n: r.registrations?.[0]?.count || 0, joined: mySet.has(r.id) }))
  }, [tab], 20000)

  const showDays = tab === 'avenir' && !search.trim()
  const days = DAYS.map((i) => {
    const d = new Date(); d.setDate(d.getDate() + i)
    const n = (data || []).filter((c: any) => dayKey(new Date(c.start_at)) === dayKey(d)).length
    return { i, wd: i === 0 ? 'auj.' : d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''), num: d.getDate(), n, key: dayKey(d) }
  })
  const list = (data || []).filter((c: any) => {
    const t = search.trim().toLowerCase()
    if (t && !(c.name + ' ' + c.org).toLowerCase().includes(t)) return false
    if (scope !== 'Toutes' && !c.joined) return false
    if (showDays && day >= 0 && dayKey(new Date(c.start_at)) !== days[day].key) return false
    return true
  })
  const isOrg = me.roles.includes('organizer') || me.roles.includes('admin')

  return (
    <section className="screen">
      <div className="top"><h2>Compétitions</h2>{isOrg && <button className="badge b-ok" style={{ border: 0 }} onClick={() => nav.go('ccreate')}>+ Créer</button>}</div>
      <input className="in" placeholder="Rechercher (nom ou organisateur)" maxLength={40} style={{ marginBottom: 10 }} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="seg" style={{ marginBottom: 10 }}>
        {['Toutes', 'Mes inscriptions'].map((k) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{k}</button>)}
      </div>
      <div className="seg" style={{ marginBottom: 14 }}>
        {[['avenir', 'À venir'], ['encours', 'En cours'], ['termine', 'Terminés']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setDay(-1) }}>{l}</button>
        ))}
      </div>
      {showDays && (
        <div className="dstrip">
          <button type="button" className={'dcard' + (day < 0 ? ' on' : '') + ((data || []).length ? ' has' : '')} onClick={() => setDay(-1)}><small>Tous</small><b>{(data || []).length}</b><i /></button>
          {days.map((d) => (
            <button key={d.i} type="button" className={'dcard' + (day === d.i ? ' on' : '') + (d.n ? ' has' : '')} onClick={() => setDay(d.i)}><small>{d.wd}</small><b>{d.num}</b><i /></button>
          ))}
        </div>
      )}
      <ErrBox text={err} />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {!list.length && <div className="card small muted">{day >= 0 && showDays ? 'Aucune compétition ce jour-là. Choisis un autre jour.' : scope !== 'Toutes' ? "Tu n'es inscrit à aucune compétition ici. Passe sur « Toutes » pour t'inscrire." : 'Aucune compétition dans cette catégorie.'}</div>}
          {list.map((c: any) => (
            <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
              {c.image_url ? <div style={{ width: 54, height: 54, borderRadius: 12, background: `center/cover url(${c.image_url})`, flex: 'none' }} /> : <GameArt size={54} />}
              <div className="grow"><div className="row" style={{ gap: 6 }}><b>{c.name}</b><CompIcons c={c} /></div><div className="small muted">{fmt(c.start_at)} · {c.n}/{c.max_players} inscrits</div></div>
              <div style={{ textAlign: 'right' }}>
                <div className={'badge ' + (c.status === 'cancelled' ? 'b-wait' : c.joined ? 'b-ok' : 'b-gold')}>{c.status === 'cancelled' ? 'Annulé' : c.joined ? 'Inscrit' : 'Gratuit'}</div>
                {c.prize && <div className="small muted" style={{ marginTop: 4 }}>Lot : {c.prize}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function Bracket({ matches, names, meId, onOpen }: { matches: any[]; names: Record<string, string>; meId: string; onOpen: (id: string) => void }) {
  const phases: Record<string, any[]> = {}
  matches.forEach((m) => { (phases[m.phase] = phases[m.phase] || []).push(m) })
  const label: Record<string, string> = { elim: 'Tableau', ko: 'Phase à élimination', groups: 'Poules', rr: 'Championnat' }
  return (
    <div className="stack">
      {Object.keys(phases).map((ph) => {
        const rounds: Record<number, any[]> = {}
        phases[ph].forEach((m) => { (rounds[m.round_index] = rounds[m.round_index] || []).push(m) })
        const nR = Object.keys(rounds).length
        return (
          <div key={ph}>
            <div className="small muted" style={{ margin: '4px 0 6px' }}>{label[ph]}</div>
            <div className="rnd">
              {Object.keys(rounds).map((r) => (
                <div key={r} className="stack" style={{ gap: 8 }}>
                  <div className="small muted">{ph === 'elim' || ph === 'ko' ? (Number(r) === nR - 1 ? 'Finale' : Number(r) === nR - 2 && nR > 2 ? 'Demi-finales' : 'Tour ' + (Number(r) + 1)) : 'Journée ' + (Number(r) + 1)}</div>
                  {rounds[Number(r)].sort((a, b) => a.match_index - b.match_index).map((m) => {
                    const mine = m.player_a === meId || m.player_b === meId
                    const row = (p: string | null, sc: number | null) => (
                      <div className={(m.winner_id && m.winner_id === p ? 'w ' : '') + (p === meId ? 'me' : '')}>
                        <span>{p ? names[p] || '…' : m.bye ? "Qualifié d'office" : 'À déterminer'}</span><b>{m.winner_id && !m.forfeit && !m.bye && sc !== null ? sc : ''}</b>
                      </div>
                    )
                    return (
                      <button key={m.id} className="mcard" onClick={() => (m.player_a && m.player_b && !m.bye ? onOpen(m.id) : null)} style={mine ? { borderColor: 'var(--gold)' } : undefined}>
                        {row(m.player_a, m.score_a)}{row(m.player_b, m.score_b)}
                        {m.forfeit && <div className="small muted">Forfait</div>}
                        {!m.winner_id && m.scheduled_at && <div className="small muted">{hhmm(m.scheduled_at)}</div>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HeadToHead({ meId, oppId, oppName }: { meId: string; oppId: string; oppName: string }) {
  const { data } = useLoad(async () => {
    const ms = await q<any[]>(sb.from('matches').select('winner_id,score_a,score_b,player_a,player_b').eq('bye', false).not('winner_id', 'is', null)
      .or(`and(player_a.eq.${meId},player_b.eq.${oppId}),and(player_a.eq.${oppId},player_b.eq.${meId})`).order('decided_at', { ascending: false }).limit(20))
    return ms
  }, [meId, oppId], 30000)
  if (!data) return null
  if (!data.length) return <div className="small muted">Première confrontation entre vous.</div>
  const w = data.filter((m: any) => m.winner_id === meId).length
  return <div className="small muted">Face-à-face : {w} victoire{w > 1 ? 's' : ''} pour toi, {data.length - w} pour {oppName}, sur {data.length} match{data.length > 1 ? 's' : ''}.</div>
}

function Standings({ comp, group, meId }: { comp: string; group: number | null; meId?: string }) {
  const { data } = useLoad(() => rpc('competition_standings', { _comp: comp, _group: group }), [comp, group], 20000)
  if (!data) return null
  return (
    <table className="tb">
      <thead><tr><th>#</th><th>Joueur</th><th>J</th><th>V</th><th>D</th><th>BP</th><th>BC</th><th>+/-</th><th>Pts</th></tr></thead>
      <tbody>{(data as any[]).map((r, i) => (
        <tr key={r.user_id} style={r.user_id === meId ? { color: 'var(--gold)' } : undefined}>
          <td>{i + 1}</td><td>{r.username}</td><td>{r.played}</td><td>{r.wins}</td><td>{r.played - r.wins}</td>
          <td>{r.goals_for}</td><td>{r.goals_against}</td><td>{r.goal_diff > 0 ? '+' : ''}{r.goal_diff}</td><td><b>{r.wins * 3}</b></td>
        </tr>
      ))}</tbody>
    </table>
  )
}

const PRESET_TXT: Record<string, string> = {
  c: 'Match de 6 min, pas de prolongations, temps maximum 30 min.',
  s: 'Match de 10 min, prolongations puis tirs au but, temps maximum 45 min.',
  l: 'Match de 15 min, prolongations puis tirs au but, temps maximum 60 min.',
}
const countdown = (d: string) => {
  const ms = new Date(d).getTime() - Date.now()
  if (ms <= 0) return null
  const m = Math.floor(ms / 60000), j = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return j ? `${j} j ${h} h` : h ? `${h} h ${mm} min` : `${mm} min`
}
const ROUND_NAMES = (n: number, i: number) => (i === n - 1 ? 'Finale' : i === n - 2 ? 'Demi-finales' : i === n - 3 ? 'Quarts de finale' : `Tour ${i + 1}`)

const FORMAT_ICON: Record<string, string> = { elim: 'M6 4h5v4l-3 3 3 3v4H6v-4l3-3-3-3zM13 4h5v4l-3 3 3 3v4h-5v-4l3-3-3-3z', rr: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2', poules: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' }
function FormatIcon({ format, size = 15 }: { format: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none' }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={FORMAT_ICON[format] || FORMAT_ICON.elim} /></svg>
}
function CompIcons({ c }: { c: any }) {
  return (
    <span className="row" style={{ gap: 5, display: 'inline-flex', color: 'var(--muted)' }}>
      <span title={FORMATS[c.format]}><FormatIcon format={c.format} /></span>
      {c.prize && <span title={'Lot : ' + c.prize} style={{ color: 'var(--gold)' }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8" /></svg></span>}
      {c.mandatory_live && <span title="Live obligatoire" style={{ color: 'var(--live)' }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4" /></svg></span>}
    </span>
  )
}

export function CompCover({ small, img }: { small?: boolean; img?: string | null }) {
  return (
    <div style={{ height: small ? 90 : 120, borderRadius: 16, marginBottom: 10, position: 'relative', overflow: 'hidden', border: '1px solid var(--line)',
      background: img ? `center/cover url(${img})` : 'linear-gradient(#0a1233,#0d1a4a 55%,#0c4d2d 55%,#0f5a34)' }}>
      {!img && <><div style={{ position: 'absolute', left: 14, top: 14, width: 26, height: 26, borderRadius: '50%', background: '#fff', filter: 'blur(9px)', opacity: .8 }} />
      <div style={{ position: 'absolute', right: 14, top: 14, width: 26, height: 26, borderRadius: '50%', background: '#fff', filter: 'blur(9px)', opacity: .8 }} />
      <div className="row" style={{ position: 'absolute', left: 14, bottom: 12 }}><GameArt size={44} /><b style={{ fontFamily: 'var(--display)' }}>eFootball Mobile</b></div></>}
    </div>
  )
}

export function CompDetail({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [tab, setTab] = useState('info')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { data, loading, reload } = useLoad(async () => {
    const [c, regs, ms, staff] = await Promise.all([
      q<any>(sb.from('competitions').select('*').eq('id', id).single()),
      q<any[]>(sb.from('registrations').select('user_id,status,checked_in_at').eq('competition_id', id)),
      q<any[]>(sb.from('matches').select('id,phase,round_index,match_index,group_index,player_a,player_b,winner_id,score_a,score_b,forfeit,bye,scheduled_at').eq('competition_id', id)),
      q<any[]>(sb.from('competition_staff').select('user_id,status').eq('competition_id', id).eq('user_id', me.id)),
    ])
    const names = await namesOf([c.organizer_id, c.champion_id, ...regs.map((r) => r.user_id), ...ms.map((m) => m.player_a), ...ms.map((m) => m.player_b)])
    return { c, regs, ms, names, staff: staff.some((s) => s.status === 'active') }
  }, [id], 12000)

  if (loading && !data) return <section className="screen"><Top title="Compétition" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Compétition" /><div className="card">Compétition introuvable.</div></section>
  const { c, regs, ms, names } = data as any
  const mine = regs.find((r: any) => r.user_id === me.id && ['registered', 'waitlist', 'eliminated', 'done'].includes(r.status))
  const active = regs.filter((r: any) => ['registered', 'waitlist', 'eliminated', 'done'].includes(r.status))
  const nReg = regs.filter((r: any) => r.status === 'registered').length
  const isOrg = c.organizer_id === me.id || me.roles.includes('admin')
  const canManage = isOrg || data.staff
  const real = ms.filter((m: any) => !m.bye)
  const played = real.filter((m: any) => m.winner_id).length
  const myMs = real.filter((m: any) => m.player_a === me.id || m.player_b === me.id).sort((a: any, b: any) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
  const myNext = myMs.find((m: any) => !m.winner_id && m.player_a && m.player_b)
  const rounds = Math.max(0, ...ms.filter((m: any) => m.phase === 'elim' || m.phase === 'ko').map((m: any) => m.round_index + 1))
  const curRound = ms.filter((m: any) => (m.phase === 'elim' || m.phase === 'ko') && !m.winner_id && !m.bye).map((m: any) => m.round_index).sort()[0]
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr('')
    try { await fn(); toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const checkinOpen = ['open', 'closed'].includes(c.status) && Date.now() > new Date(c.start_at).getTime() - 3600e3
  const groups = Array.from(new Set(ms.filter((m: any) => m.phase === 'groups').map((m: any) => m.group_index))).sort() as number[]
  const cd = c.status === 'open' || c.status === 'closed' ? countdown(c.start_at) : null
  const oppOf = (m: any) => names[m.player_a === me.id ? m.player_b : m.player_a] || 'adversaire à venir'
  const roundLabel = (m: any) => (m.phase === 'groups' ? 'Poules' : m.phase === 'rr' ? 'Championnat' : ROUND_NAMES(rounds, m.round_index))

  return (
    <section className="screen">
      <Top title="Compétition" right={canManage && ['open', 'closed', 'ongoing'].includes(c.status) ? <button className="badge b-gold" style={{ border: 0 }} onClick={() => nav.go('cmanage', { id })}>Gérer</button> : undefined} />
      <CompCover img={c.image_url} />
      <div className="card row">
        {c.image_url ? <div style={{ width: 54, height: 54, borderRadius: 12, background: `center/cover url(${c.image_url})`, flex: 'none' }} /> : <GameArt size={54} />}
        <div className="grow">
          <div className="row" style={{ gap: 6 }}><h3>{c.name}</h3><CompIcons c={c} /></div>
          <div className="small muted">{fmt(c.start_at)} · {nReg}/{c.max_players} inscrits</div>
        </div>
        {['finished', 'cancelled'].includes(c.status) && <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>}
      </div>
      {c.status === 'finished' && c.champion_id && (
        <div className="card mt" style={{ borderColor: 'var(--gold)', background: 'linear-gradient(135deg,#3a2a05,#14100a)' }}>
          <div className="small muted">Vainqueur</div><h3 style={{ color: 'var(--gold)' }}>🏆 {names[c.champion_id]}</h3>
        </div>
      )}
      {c.status === 'cancelled' && <div className="card mt small">Annulée : {c.cancel_reason}</div>}
      {['open', 'closed'].includes(c.status) && <div className="card small mt">{cd ? `Début dans ${cd}` : 'Compétition à démarrer par l’organisateur'}</div>}
      {c.status === 'ongoing' && <div className="card small mt">Compétition commencée</div>}
      <button className="card small mt" style={{ textAlign: 'center', width: '100%' }} onClick={() => nav.go('orgpage', { id: c.organizer_id })}>Organisateur : <b>{names[c.organizer_id] || 'Organisateur'}</b> · voir sa page</button>

      <div className="seg" style={{ margin: '14px 0' }}>
        {[['info', 'Info'], ['part', 'Participants'], ['rule', 'Règlement']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="card stack">
          {ms.length > 0 && (
            <div className="card stack" style={{ background: 'var(--panel2)' }}>
              <div className="row"><b className="grow">{c.status === 'finished' ? 'Terminée' : curRound != null ? `${ROUND_NAMES(rounds, curRound)} en cours` : 'En cours'}</b><span className="small muted">{played}/{real.length} matchs</span></div>
              <div className="pbar"><i style={{ width: (real.length ? Math.round((played / real.length) * 100) : 0) + '%' }} /></div>
              <button className="btn ghost" onClick={() => setTab('bracket')}>Voir le tirage et l'avancement</button>
            </div>
          )}
          {mine && myMs.length > 0 && (
            <>
              <h3>Ma compétition</h3>
              {myMs.filter((m: any) => m.winner_id).map((m: any) => {
                const won = m.winner_id === me.id
                return (
                  <button key={m.id} className="item" onClick={() => nav.go('match', { id: m.id })}>
                    <div className="grow"><b>{roundLabel(m)}</b> <span className={'badge ' + (won ? 'b-ok' : 'b-wait')}>{won ? 'Gagné' : 'Perdu'} {m.player_a === me.id ? `${m.score_a ?? 0}–${m.score_b ?? 0}` : `${m.score_b ?? 0}–${m.score_a ?? 0}`}</span>
                      <div className="small muted">contre {oppOf(m)}</div></div>
                  </button>
                )
              })}
              {myNext && (
                <div className="card stack" style={{ borderColor: 'var(--gold)' }}>
                  <b style={{ color: 'var(--gold)' }}>Prochain match : {roundLabel(myNext)}</b>
                  <div className="small muted">Contre {oppOf(myNext)} · {fmt(myNext.scheduled_at)}</div>
                  {(() => { const o = myNext.player_a === me.id ? myNext.player_b : myNext.player_a; return o ? <HeadToHead meId={me.id} oppId={o} oppName={names[o] || 'ton adversaire'} /> : null })()}
                  <button className="btn" onClick={() => nav.go('match', { id: myNext.id })}>Entrer dans la salle du match</button>
                  <button className="btn ghost" onClick={() => nav.go('match', { id: myNext.id })}>Envoyer mon résultat</button>
                </div>
              )}
            </>
          )}
          <div className="row small"><span className="muted grow">Type</span><b>{FORMATS[c.format]}</b></div>
          <div className="row small"><span className="muted grow">Réglages des matchs</span><b>{PRESETS[c.match_preset]}</b></div>
          {c.mandatory_live && <div className="small muted">Live obligatoire pour les demi-finales et la finale.</div>}
          <h3>Récompense</h3>
          <div className="small muted">{c.prize || 'Pas de lot pour cette compétition. On joue pour la victoire.'}</div>
        </div>
      )}
      {tab === 'part' && (
        <div className="card stack small">
          {!active.length && <div className="muted">Aucun inscrit pour le moment.</div>}
          {active.map((r: any) => (
            <button key={r.user_id} className="row" style={{ background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} onClick={() => nav.go('pprof', { id: r.user_id })}><Av name={names[r.user_id]} size={32} /><span className="grow">{names[r.user_id]}{r.user_id === me.id ? ' (toi)' : ''}</span>
              {r.status === 'waitlist' && <span className="badge b-wait">Attente</span>}
              {r.status === 'eliminated' && <span className="badge b-wait">Éliminé</span>}
              {r.checked_in_at && <span className="badge b-ok">Présent</span>}
            </button>
          ))}
        </div>
      )}
      {tab === 'bracket' && (
        <div className="card">
          {ms.length ? (
            <div className="stack">
              {(c.phase === 'rr') && <Standings comp={id} group={null} meId={me.id} />}
              {groups.map((g) => <div key={g}><div className="small muted" style={{ marginBottom: 4 }}>Poule {String.fromCharCode(65 + g)}</div><Standings comp={id} group={g} meId={me.id} /></div>)}
              <Bracket matches={ms} names={names} meId={me.id} onOpen={(mid) => nav.go('match', { id: mid })} />
            </div>
          ) : <div className="small muted">Le tirage n'a pas encore eu lieu.</div>}
        </div>
      )}
      {tab === 'rule' && <div className="card small pre">{c.rules || "L'organisateur n'a pas ajouté de règlement. Les règles générales d'Arena s'appliquent : forfait 10 minutes après l'heure, retour 5 minutes après une déconnexion, contestation possible après validation."}</div>}

      <ErrBox text={err} />
      <div className="stack" style={{ marginTop: 14, position: 'sticky', bottom: 74, zIndex: 4 }}>
        {mine && ['open', 'closed'].includes(c.status) && checkinOpen && !mine.checked_in_at && mine.status === 'registered' && (
          <button className="btn gold" disabled={busy} onClick={() => act(() => rpc('check_in', { _comp: id }), 'Présence confirmée')}>Confirmer ma présence</button>
        )}
        {c.status === 'open' && !mine && c.organizer_id !== me.id && !data.staff && (
          <button className="btn" disabled={busy} onClick={() => act(async () => { const r = await rpc('register_competition', { _comp: id }); if (r === 'waitlist') toast("Tu es sur la liste d'attente") }, 'Inscription enregistrée')}>S'inscrire</button>
        )}
        {mine && ['open', 'closed'].includes(c.status) && (
          <button className="btn ghost" style={{ background: 'var(--bg)' }} disabled={busy} onClick={() => act(() => rpc('withdraw_competition', { _comp: id }), 'Retrait enregistré')}>Inscrit ✓ · Se désinscrire</button>
        )}
        {!!ms.length && tab !== 'bracket' && <button className="btn ghost" style={{ background: 'var(--bg)' }} onClick={() => setTab('bracket')}>Voir le tirage et l'avancement</button>}
      </div>
    </section>
  )
}

export const TEMPLATES: [string, string, Partial<{ format: string; max: number; preset: string }>][] = [
  ['free', 'Libre', {}],
  ['e8', 'Élimination 8', { format: 'elim', max: 8, preset: 's' }],
  ['e16', 'Élimination 16', { format: 'elim', max: 16, preset: 's' }],
  ['q4', 'Coupe rapide 4', { format: 'elim', max: 4, preset: 'c' }],
  ['r6', 'Championnat 6', { format: 'rr', max: 6, preset: 'c' }],
  ['p16', 'Poules 16', { format: 'poules', max: 16, preset: 's' }],
]
const FORMAT_HINT: Record<string, string> = {
  elim: 'Tu perds, tu sors. Le plus rapide : un seul match par tour.',
  rr: 'Tout le monde joue contre tout le monde. Le meilleur total de points gagne.',
  poules: 'Des poules d’abord, puis un tableau à élimination directe pour les meilleurs.',
}
export const timeOptions = () => Array.from({ length: 48 }, (_, i) => String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'))
export const toLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function CompCreate() {
  const { nav, toast, me } = useApp()
  const tomorrow = new Date(Date.now() + 86400e3)
  const [tpl, setTpl] = useState('free')
  const [f, setF] = useState<any>({ name: '', rules: '', date: toLocalDate(tomorrow), time: '20:00', close: '', max: 16, gap: 45, format: 'elim', preset: 's', live: true, prize: '', img: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const pick = (k: string, p: any) => { setTpl(k); setF({ ...f, ...p }) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const n = Number(f.max), gap = Number(f.gap)
    if (f.name.trim().length < 3) return setErr('Le nom doit faire 3 caractères minimum.')
    if (!(n >= 2 && n <= 128)) return setErr('Nombre de places : entre 2 et 128.')
    if (!(gap >= 5 && gap <= 480)) return setErr('Écart entre deux tours : 5 à 480 minutes.')
    if (!f.date) return setErr('Choisis la date de début.')
    const start = new Date(f.date + 'T' + f.time + ':00')
    if (isNaN(start.getTime()) || start.getTime() < Date.now()) return setErr('Choisis une date de début dans le futur.')
    let close: string | null = null
    if (f.close) {
      const cl = new Date(f.close + 'T' + f.time + ':00')
      if (cl.getTime() > start.getTime()) return setErr('La fin des inscriptions doit être avant le début.')
      close = cl.toISOString()
    }
    setBusy(true)
    try {
      const row = await q<any>(sb.from('competitions').insert({
        game_id: 'efb', organizer_id: me.id, name: f.name.trim(), rules: f.rules.trim() || null, start_at: start.toISOString(),
        registration_close_at: close, max_players: n, round_gap_minutes: gap, format: f.format, match_preset: f.preset, mandatory_live: f.live, prize: f.prize.trim() || null, image_url: f.img || null,
      }).select('id').single())
      toast('Compétition publiée')
      nav.replace('cdetail', { id: row.id })
    } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <section className="screen">
      <Top title="Créer une compétition" />
      <form className="stack" onSubmit={submit} noValidate>
        <div className="f"><span className="small muted">Modèle</span>
          <div className="seg wrap" style={{ marginTop: 6 }}>{TEMPLATES.map(([k, l, p]) => <button type="button" key={k} className={tpl === k ? 'on' : ''} onClick={() => pick(k, p)}>{l}</button>)}</div></div>
        <div className="f"><span className="small muted">Type de compétition</span>
          <div className="seg wrap" style={{ marginTop: 6 }}>{Object.entries(FORMATS).map(([k, l]) => <button type="button" key={k} className={f.format === k ? 'on' : ''} onClick={() => setF({ ...f, format: k })}>{l}</button>)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>{FORMAT_HINT[f.format]}</div></div>
        <label className="f">Nom<input className="in" value={f.name} onChange={set('name')} maxLength={80} placeholder="Ex : Coupe de Ouaga eFootball" /></label>
        <label className="f">Jeu<select className="in" disabled><option>eFootball</option></select></label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="f grow">Date de début<input className="in" type="date" value={f.date} onChange={set('date')} /></label>
          <label className="f grow">Heure de début<select className="in" value={f.time} onChange={set('time')}>{timeOptions().map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <label className="f">Fin des inscriptions (optionnel)<input className="in" type="date" value={f.close} onChange={set('close')} />
          <span className="small muted">Si tu ne choisis rien, les inscriptions ferment 1 heure avant le début. Heure d'Ouagadougou.</span></label>
        <label className="f">Nombre de places<input className="in" type="number" inputMode="numeric" value={f.max} onChange={set('max')} /></label>
        <label className="f">Écart entre deux tours (minutes)<input className="in" type="number" inputMode="numeric" value={f.gap} onChange={set('gap')} /></label>
        <div className="f"><span className="small muted">Réglages des matchs</span>
          <div className="seg" style={{ marginTop: 6 }}>{[['c', 'Court'], ['s', 'Standard'], ['l', 'Long']].map(([k, l]) => <button type="button" key={k} className={f.preset === k ? 'on' : ''} onClick={() => setF({ ...f, preset: k })}>{l}</button>)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>{PRESET_TXT[f.preset]}</div>
          <div className="small muted">Vérifie que ces réglages existent dans ta version de eFootball.</div>
          <div className="small muted">Après le tirage, Arena propose un horaire pour chaque tour, selon l'écart choisi plus haut.</div></div>
        <label className="f">Récompense du 1er (optionnelle)<input className="in" value={f.prize} onChange={set('prize')} placeholder="Ex. maillot, casque, bon d'achat" maxLength={80} /></label>
        <CoverPicker value={f.img} onChange={(u) => setF((x: any) => ({ ...x, img: u }))} title={f.name} sub={f.prize ? 'Lot : ' + f.prize : f.date.split('-').reverse().join('/') + ' · ' + f.time} />
        <label className="f">Règlement<textarea className="in" value={f.rules} onChange={set('rules')} placeholder="Format, horaires, conditions de participation…" /></label>
        <label className="item"><span className="grow small">Diffusion obligatoire des demi-finales et de la finale</span><input type="checkbox" className="sw" checked={f.live} onChange={set('live')} /></label>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Publication…' : 'Publier la compétition'}</button>
      </form>
    </section>
  )
}

export function MyComps() {
  const { me, nav } = useApp()
  const { data, loading } = useLoad(() => q<any[]>(sb.from('competitions').select('id,name,status,start_at').eq('organizer_id', me.id).order('created_at', { ascending: false })), [me.id])
  return (
    <section className="screen">
      <Top title="Mes compétitions" />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {!data?.length && <div className="card small muted">Tu n'as pas encore organisé de compétition.</div>}
          {data?.map((c: any) => (
            <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
              <div className="grow"><b>{c.name}</b><div className="small muted">{fmt(c.start_at)}</div></div>
              <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
