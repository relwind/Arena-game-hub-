import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, fmt, hhmm, STATUS, FORMATS, PRESETS, Top, Spin, ErrBox, errMsg, namesOf } from '../lib/ui'

const GROUPS: Record<string, string[]> = { avenir: ['open', 'closed'], encours: ['ongoing'], termine: ['finished', 'cancelled'] }

export function Comps() {
  const { me, nav } = useApp()
  const [tab, setTab] = useState('avenir')
  const [search, setSearch] = useState('')
  const { data, loading, err } = useLoad(async () => {
    const rows = await q<any[]>(sb.from('competitions').select('id,name,status,start_at,max_players,format,organizer_id,registrations(count)').in('status', GROUPS[tab]).order('start_at', { ascending: tab === 'avenir' }).limit(60))
    const names = await namesOf(rows.map((r) => r.organizer_id))
    return rows.map((r) => ({ ...r, org: names[r.organizer_id] || 'Organisateur', n: r.registrations?.[0]?.count || 0 }))
  }, [tab], 20000)
  const list = (data || []).filter((c: any) => !search || (c.name + ' ' + c.org).toLowerCase().includes(search.toLowerCase()))
  const isOrg = me.roles.includes('organizer') || me.roles.includes('admin')

  return (
    <section className="screen">
      <Top title="Compétitions" back={false} right={isOrg ? <button className="badge b-ok" style={{ border: 0 }} onClick={() => nav.go('ccreate')}>+ Créer</button> : undefined} />
      <input className="in" placeholder="Rechercher (nom ou organisateur)" maxLength={40} style={{ marginBottom: 10 }} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="seg" style={{ marginBottom: 14 }}>
        {[['avenir', 'À venir'], ['encours', 'En cours'], ['termine', 'Terminés']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <ErrBox text={err} />
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {!list.length && <div className="card small muted">Aucune compétition ici.</div>}
          {list.map((c: any) => (
            <button key={c.id} className="item" onClick={() => nav.go('cdetail', { id: c.id })}>
              <div className="tile" style={{ background: 'linear-gradient(135deg,#1b3d9a,#35d0ff)' }}>EF</div>
              <div className="grow">
                <b>{c.name}</b>
                <div className="small muted">{c.org} · {fmt(c.start_at)}</div>
                <div className="small muted">{c.n}/{c.max_players} joueurs · {FORMATS[c.format]}</div>
              </div>
              <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
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

function Standings({ comp, group }: { comp: string; group: number | null }) {
  const { data } = useLoad(() => rpc('competition_standings', { _comp: comp, _group: group }), [comp, group], 20000)
  if (!data) return null
  return (
    <table className="tb">
      <thead><tr><th>Joueur</th><th>J</th><th>V</th><th>+/-</th></tr></thead>
      <tbody>{(data as any[]).map((r) => <tr key={r.user_id}><td>{r.username}</td><td>{r.played}</td><td>{r.wins}</td><td>{r.goal_diff}</td></tr>)}</tbody>
    </table>
  )
}

export function CompDetail({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [tab, setTab] = useState('info')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cancel, setCancel] = useState<string | null>(null)
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
  const mine = regs.find((r: any) => r.user_id === me.id && ['registered', 'waitlist'].includes(r.status))
  const active = regs.filter((r: any) => ['registered', 'waitlist'].includes(r.status) || ['eliminated', 'done'].includes(r.status))
  const nReg = regs.filter((r: any) => r.status === 'registered').length
  const isOrg = c.organizer_id === me.id || me.roles.includes('admin')
  const myNext = ms.filter((m: any) => !m.winner_id && !m.bye && (m.player_a === me.id || m.player_b === me.id)).sort((a: any, b: any) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))[0]
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr('')
    try { await fn(); toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const checkinOpen = c.status === 'open' || c.status === 'closed' ? Date.now() > new Date(c.start_at).getTime() - 3600e3 : false
  const groups = Array.from(new Set(ms.filter((m: any) => m.phase === 'groups').map((m: any) => m.group_index))).sort() as number[]

  return (
    <section className="screen">
      <Top title="Compétition" />
      <div className="card row">
        <div className="tile" style={{ background: 'linear-gradient(135deg,#1b3d9a,#35d0ff)' }}>EF</div>
        <div className="grow">
          <h3>{c.name}</h3>
          <div className="small muted">par {names[c.organizer_id] || 'Organisateur'} · {nReg}/{c.max_players} joueurs</div>
        </div>
        <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
      </div>
      {c.status === 'finished' && c.champion_id && (
        <div className="card mt" style={{ borderColor: 'var(--gold)', background: 'linear-gradient(135deg,#3a2a05,#14100a)' }}>
          <div className="small muted">Vainqueur</div><h3 style={{ color: 'var(--gold)' }}>🏆 {names[c.champion_id]}</h3>
        </div>
      )}
      {c.status === 'cancelled' && <div className="card mt small">Annulée : {c.cancel_reason}</div>}
      <div className="card small mt">Début : <b>{fmt(c.start_at)}</b></div>

      {myNext && (
        <button className="btn mt" onClick={() => nav.go('match', { id: myNext.id })}>Ouvrir mon match ({names[myNext.player_a === me.id ? myNext.player_b : myNext.player_a] || 'adversaire à venir'})</button>
      )}

      <div className="stack mt">
        {c.status === 'open' && !mine && c.organizer_id !== me.id && !data.staff && (
          <button className="btn" disabled={busy} onClick={() => act(async () => { const r = await rpc('register_competition', { _comp: id }); if (r === 'waitlist') toast("Tu es sur la liste d'attente") }, 'Inscription enregistrée')}>S'inscrire</button>
        )}
        {mine && ['open', 'closed'].includes(c.status) && (
          <>
            {checkinOpen && !mine.checked_in_at && mine.status === 'registered' && <button className="btn gold" disabled={busy} onClick={() => act(() => rpc('check_in', { _comp: id }), 'Check-in fait')}>Faire mon check-in</button>}
            {mine.checked_in_at && <div className="small" style={{ color: 'var(--ok)' }}>Check-in effectué</div>}
            <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('withdraw_competition', { _comp: id }), 'Retrait enregistré')}>Me retirer</button>
          </>
        )}
        <ErrBox text={err} />
      </div>

      {isOrg && ['open', 'closed', 'ongoing'].includes(c.status) && (
        <div className="card stack mt" style={{ borderColor: 'var(--gold)' }}>
          <b>Espace organisateur</b>
          {['open', 'closed'].includes(c.status) && (
            <>
              <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('set_registration_open', { _comp: id, _open: c.status !== 'open' }), c.status === 'open' ? 'Inscriptions fermées' : 'Inscriptions rouvertes')}>
                {c.status === 'open' ? 'Fermer les inscriptions' : 'Rouvrir les inscriptions'}
              </button>
              <button className="btn" disabled={busy || nReg < 2} onClick={() => act(() => rpc('generate_draw', { _comp: id }), 'Tirage effectué')}>Lancer le tirage ({nReg} joueurs)</button>
            </>
          )}
          {cancel === null ? (
            <button className="btn ghost" onClick={() => setCancel('')}>Annuler la compétition</button>
          ) : (
            <>
              <input className="in" placeholder="Motif de l'annulation (obligatoire)" value={cancel} onChange={(e) => setCancel(e.target.value)} />
              <div className="row">
                <button className="btn ghost" onClick={() => setCancel(null)}>Retour</button>
                <button className="btn" disabled={busy || !cancel.trim()} onClick={() => act(() => rpc('cancel_competition', { _comp: id, _reason: cancel }), 'Compétition annulée')}>Confirmer</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="seg" style={{ margin: '14px 0' }}>
        {[['info', 'Info'], ['part', 'Joueurs'], ['bracket', c.format === 'elim' ? 'Tableau' : 'Matchs'], ['rule', 'Règlement']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="card" style={{ minHeight: 120 }}>
        {tab === 'info' && (
          <div className="stack small">
            <div>Jeu : eFootball · 1v1</div>
            <div>Format : {FORMATS[c.format]}</div>
            <div>Durée des matchs : {PRESETS[c.match_preset]}</div>
            {c.prize && <div>Récompense : {c.prize}</div>}
            {c.mandatory_live && <div>Live obligatoire pour les demi-finales et finales.</div>}
          </div>
        )}
        {tab === 'part' && (
          <div className="stack small">
            {!active.length && <div className="muted">Aucun inscrit pour le moment.</div>}
            {active.map((r: any) => (
              <div key={r.user_id} className="row"><span className="grow">{names[r.user_id]}</span>
                {r.status === 'waitlist' && <span className="badge b-wait">Attente</span>}
                {r.status === 'eliminated' && <span className="badge b-wait">Éliminé</span>}
                {r.checked_in_at && <span className="badge b-ok">Check-in</span>}
              </div>
            ))}
          </div>
        )}
        {tab === 'bracket' && (
          ms.length ? (
            <div className="stack">
              {(c.phase === 'rr') && <Standings comp={id} group={null} />}
              {groups.map((g) => <div key={g}><div className="small muted" style={{ marginBottom: 4 }}>Poule {String.fromCharCode(65 + g)}</div><Standings comp={id} group={g} /></div>)}
              <Bracket matches={ms} names={names} meId={me.id} onOpen={(mid) => nav.go('match', { id: mid })} />
            </div>
          ) : <div className="small muted">Le tirage n'a pas encore eu lieu.</div>
        )}
        {tab === 'rule' && <div className="small pre">{c.rules || "L'organisateur n'a pas ajouté de règlement. Les règles générales d'Arena s'appliquent : forfait 10 minutes après l'heure, retour 5 minutes après une déconnexion, contestation possible après validation."}</div>}
      </div>
    </section>
  )
}

export function CompCreate() {
  const { nav, toast, me } = useApp()
  const soon = new Date(Date.now() + 86400e3 - (new Date().getTimezoneOffset() * 60e3))
  const [f, setF] = useState<any>({ name: '', rules: '', start: soon.toISOString().slice(0, 16), max: 16, format: 'elim', preset: 's', live: false, prize: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const n = Number(f.max)
    if (f.name.trim().length < 3) return setErr('Le nom doit faire 3 caractères minimum.')
    if (!(n >= 2 && n <= 128)) return setErr('Nombre de joueurs : entre 2 et 128.')
    const start = new Date(f.start)
    if (isNaN(start.getTime()) || start.getTime() < Date.now()) return setErr('Choisis une date de début dans le futur.')
    setBusy(true)
    try {
      const row = await q<any>(sb.from('competitions').insert({
        game_id: 'efb', organizer_id: me.id, name: f.name.trim(), rules: f.rules.trim() || null, start_at: start.toISOString(),
        max_players: n, format: f.format, match_preset: f.preset, mandatory_live: f.live, prize: f.prize.trim() || null,
      }).select('id').single())
      toast('Compétition créée')
      nav.replace('cdetail', { id: row.id })
    } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  return (
    <section className="screen">
      <Top title="Créer une compétition" />
      <form className="stack" onSubmit={submit} noValidate>
        <label className="f">Nom<input className="in" value={f.name} onChange={set('name')} maxLength={80} /></label>
        <label className="f">Début<input className="in" type="datetime-local" value={f.start} onChange={set('start')} /></label>
        <label className="f">Nombre de joueurs max<input className="in" type="number" inputMode="numeric" value={f.max} onChange={set('max')} /></label>
        <label className="f">Format
          <select className="in" value={f.format} onChange={set('format')}>{Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="f">Durée des matchs
          <select className="in" value={f.preset} onChange={set('preset')}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="f">Récompense (facultatif)<input className="in" value={f.prize} onChange={set('prize')} /></label>
        <label className="f">Règlement (facultatif)<textarea className="in" value={f.rules} onChange={set('rules')} /></label>
        <label className="row small muted" style={{ gap: 8 }}><input type="checkbox" checked={f.live} onChange={set('live')} /> Live obligatoire en demi-finales et finales</label>
        <ErrBox text={err} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer la compétition'}</button>
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
