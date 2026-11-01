import React, { useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, fmt, STATUS, PRESETS, Top, Spin, ErrBox, errMsg, namesOf, GameArt } from '../lib/ui'
import { timeOptions, toLocalDate } from './Comps'

const ck = (r: any) => { if (r.error) throw new Error(errMsg(r.error)) }

export function OrganizerHome() {
  const { me, nav, toast } = useApp()
  const { data, loading, reload } = useLoad(async () => {
    const [mine, inv] = await Promise.all([
      q<any[]>(sb.from('competitions').select('id,name,status,start_at,max_players,registrations(count)').eq('organizer_id', me.id).order('created_at', { ascending: false }).limit(30)),
      q<any[]>(sb.from('competition_staff').select('competition_id,invited_by,competitions(name)').eq('user_id', me.id).eq('status', 'pending')),
    ])
    const ids = mine.filter((c) => ['open', 'closed', 'ongoing'].includes(c.status)).map((c) => c.id)
    const ms = ids.length ? await q<any[]>(sb.from('matches').select('id,competition_id').in('competition_id', ids)) : []
    const mids = ms.map((m) => m.id)
    const dis = mids.length ? await q<any[]>(sb.from('disputes').select('id,match_id').eq('status', 'open').in('match_id', mids)) : []
    const names = await namesOf(inv.map((i) => i.invited_by))
    const todo: string[] = []
    mine.filter((c) => ['open', 'closed'].includes(c.status)).forEach((c) => {
      const n = c.registrations?.[0]?.count || 0
      if (!ms.some((m) => m.competition_id === c.id) && new Date(c.start_at).getTime() < Date.now() + 3600e3 && n >= 2) todo.push(`« ${c.name} » : lancer le tirage (${n} inscrits)`)
    })
    if (dis.length) todo.push(`${dis.length} litige${dis.length > 1 ? 's' : ''} à traiter`)
    return { mine, inv, names, todo }
  }, [me.id], 20000)
  const respond = async (id: string, accept: boolean) => {
    try { await rpc('respond_staff_invite', { _comp: id, _accept: accept }); toast(accept ? 'Invitation acceptée' : 'Invitation refusée'); await reload() } catch (e: any) { toast(errMsg(e)) }
  }
  return (
    <section className="screen">
      <Top title="Mon espace organisateur" />
      <div className="stack">
        <button className="btn" onClick={() => nav.go('ccreate')}>Créer une compétition</button>
        {loading && !data ? <Spin /> : (
          <>
            {!!data?.inv.length && (
              <div className="card stack">
                <b>Équipes où l'on t'a invité</b>
                {data.inv.map((i: any) => (
                  <div key={i.competition_id} className="item" style={{ cursor: 'default' }}>
                    <div className="grow"><b>{i.competitions?.name}</b><div className="small muted">{data.names[i.invited_by] || 'Organisateur'} · invitation de délégué</div></div>
                    <button className="badge b-ok" style={{ border: 0 }} onClick={() => respond(i.competition_id, true)}>Accepter</button>
                    <button className="badge b-wait" style={{ border: 0 }} onClick={() => respond(i.competition_id, false)}>Refuser</button>
                  </div>
                ))}
              </div>
            )}
            <div className="card stack"><b>À faire</b>
              {!data?.todo.length ? <div className="small muted">Rien à faire pour le moment.</div> : data.todo.map((t, i) => <div key={i} className="small">• {t}</div>)}
            </div>
            <div className="sec" style={{ margin: '6px 0 0' }}><h3>Mes compétitions</h3></div>
            {!data?.mine.length && <div className="card small muted">Tu n'as pas encore organisé de compétition.</div>}
            {data?.mine.map((c: any) => (
              <button key={c.id} className="item" onClick={() => nav.go('cmanage', { id: c.id })}>
                <div className="grow"><b>{c.name}</b><div className="small muted">{fmt(c.start_at)} · {c.registrations?.[0]?.count || 0}/{c.max_players} inscrits</div></div>
                <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

const TABS: [string, string][] = [['ap', 'Aperçu'], ['in', 'Inscrits'], ['ma', 'Matchs'], ['li', 'Litiges'], ['an', 'Annonces'], ['eq', 'Équipe'], ['re', 'Réglages']]

export function CompManage({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [tab, setTab] = useState('ap')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancel, setCancel] = useState<string | null>(null)
  const [ann, setAnn] = useState('')
  const [dg, setDg] = useState('')
  const [sc, setSc] = useState<Record<string, [string, string]>>({})
  const [rs, setRs] = useState<any>(null)

  const { data, loading, reload } = useLoad(async () => {
    const c = await q<any>(sb.from('competitions').select('*').eq('id', id).single())
    const [regs, ms, staff, an] = await Promise.all([
      q<any[]>(sb.from('registrations').select('user_id,status,checked_in_at').eq('competition_id', id)),
      q<any[]>(sb.from('matches').select('id,phase,round_index,match_index,player_a,player_b,winner_id,score_a,score_b,bye,scheduled_at').eq('competition_id', id).order('round_index').order('match_index')),
      q<any[]>(sb.from('competition_staff').select('user_id,status').eq('competition_id', id)),
      q<any[]>(sb.from('announcements').select('id,body,created_at').eq('competition_id', id).order('created_at', { ascending: false }).limit(20)),
    ])
    const mids = ms.map((m) => m.id)
    const dis = mids.length ? await q<any[]>(sb.from('disputes').select('id,match_id,reason,status,created_at').in('match_id', mids).order('created_at', { ascending: false })) : []
    const names = await namesOf([...regs.map((r) => r.user_id), ...ms.flatMap((m) => [m.player_a, m.player_b]), ...staff.map((s) => s.user_id)])
    return { c, regs, ms, staff, an, dis, names }
  }, [id], 10000)

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr('')
    try { await fn(); toast(ok); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  if (loading && !data) return <section className="screen"><Top title="Gérer" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Gérer" /><ErrBox text="Compétition introuvable." /></section>
  const { c, regs, ms, staff, an, dis, names } = data
  const isOrg = c.organizer_id === me.id || me.roles.includes('admin')
  const nm = (u: string | null) => (u ? names[u] || '…' : 'À définir')
  const nReg = regs.filter((r: any) => r.status === 'registered').length
  const real = ms.filter((m: any) => !m.bye)
  const played = real.filter((m: any) => m.winner_id).length
  const openDis = dis.filter((d: any) => d.status === 'open')
  const stage = c.status === 'finished' || c.status === 'cancelled' ? 3 : c.status === 'ongoing' ? 2 : ms.length ? 2 : c.status === 'closed' ? 1 : 0
  const stageName = ['Inscriptions', 'Tirage', 'En cours', c.status === 'cancelled' ? 'Annulée' : 'Terminée'][stage]
  const tabs = TABS.filter(([k]) => k !== 're' || isOrg)

  const delay = () => act(async () => {
    ck(await sb.from('competitions').update({ start_at: new Date(new Date(c.start_at).getTime() + 15 * 60e3).toISOString() }).eq('id', id))
    ck(await sb.from('announcements').insert({ competition_id: id, author_id: me.id, body: 'Retard de 15 minutes : le début est repoussé.' }))
  }, 'Retard annoncé')
  const postAnn = () => act(async () => {
    if (ann.trim().length < 3) throw new Error('Écris ton annonce.')
    ck(await sb.from('announcements').insert({ competition_id: id, author_id: me.id, body: ann.trim() })); setAnn('')
  }, 'Annonce publiée')
  const invite = () => act(async () => {
    const u = await q<any[]>(sb.from('profiles').select('id').ilike('username', dg.trim()).limit(1))
    if (!u.length) throw new Error('Joueur introuvable.')
    await rpc('invite_delegate', { _comp: id, _user: u[0].id }); setDg('')
  }, 'Invitation envoyée')
  const startEdit = () => { const d = new Date(c.start_at); setRs({ name: c.name, date: toLocalDate(d), time: d.toTimeString().slice(0, 5).replace(/:(?!00|30)\d\d/, (m: string) => (Number(m.slice(1)) < 30 ? ':00' : ':30')), max: c.max_players, rules: c.rules || '', preset: c.match_preset, live: c.mandatory_live }) }
  if (tab === 're' && !rs) startEdit()
  const save = () => act(async () => {
    const start = new Date(rs.date + 'T' + rs.time + ':00')
    if (rs.name.trim().length < 3) throw new Error('Nom trop court.')
    if (isNaN(start.getTime())) throw new Error('Date invalide.')
    ck(await sb.from('competitions').update({ name: rs.name.trim(), start_at: start.toISOString(), max_players: Number(rs.max), rules: rs.rules.trim() || null, match_preset: rs.preset, mandatory_live: rs.live }).eq('id', id))
  }, 'Modifications enregistrées')

  return (
    <section className="screen">
      <Top title="Gérer la compétition" />
      <div className="card row"><GameArt size={54} /><div className="grow"><h3>{c.name}</h3><div className="small muted">{fmt(c.start_at)} · {nReg}/{c.max_players} inscrits</div></div>
        <span className={'badge ' + STATUS[c.status][1]}>{STATUS[c.status][0]}</span></div>
      <div className="seg wrap" style={{ margin: '12px 0' }}>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'li' && openDis.length ? ' ' + openDis.length : ''}</button>)}</div>
      <ErrBox text={err} />

      {tab === 'ap' && (
        <div className="stack">
          <div className="steps">{[0, 1, 2, 3].map((i) => <i key={i} className={i <= stage ? 'on' : ''} />)}</div>
          <div className="small muted">Étape actuelle : {stageName}</div>
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="stat"><b>{nReg}/{c.max_players}</b><span className="small muted">Inscrits</span></div>
            <div className="stat"><b>{played}/{real.length}</b><span className="small muted">Matchs joués</span></div>
            <div className="stat"><b>{openDis.length}</b><span className="small muted">Décisions</span></div>
          </div>
          {['open', 'closed'].includes(c.status) && !ms.length && (
            <>
              <button className="btn" disabled={busy} onClick={() => act(() => rpc('set_registration_open', { _comp: id, _open: c.status !== 'open' }), c.status === 'open' ? 'Inscriptions fermées' : 'Inscriptions rouvertes')}>{c.status === 'open' ? 'Fermer les inscriptions' : 'Rouvrir les inscriptions'}</button>
              <button className="btn ghost" disabled={busy || nReg < 2} onClick={() => act(() => rpc('generate_draw', { _comp: id }), 'Tirage effectué')}>Lancer le tirage ({nReg} joueurs)</button>
              <div className="small muted">Le pointage des présences s'ouvre automatiquement 1 h avant le début. Les joueurs confirment depuis la fiche.</div>
            </>
          )}
          {isOrg && ['open', 'closed'].includes(c.status) && <button className="btn ghost" disabled={busy} onClick={delay}>Annoncer un retard de 15 minutes</button>}
          {isOrg && ['open', 'closed', 'ongoing'].includes(c.status) && (cancel === null ? (
            <button className="btn ghost" style={{ color: 'var(--live)' }} onClick={() => setCancel('')}>Annuler la compétition</button>
          ) : (
            <div className="card stack">
              <input className="in" placeholder="Motif de l'annulation (obligatoire)" value={cancel} onChange={(e) => setCancel(e.target.value)} />
              <div className="row"><button className="btn ghost" onClick={() => setCancel(null)}>Retour</button>
                <button className="btn" disabled={busy || !cancel.trim()} onClick={() => act(() => rpc('cancel_competition', { _comp: id, _reason: cancel }), 'Compétition annulée')}>Confirmer</button></div>
            </div>
          ))}
        </div>
      )}

      {tab === 'in' && (
        <div className="stack">
          {!regs.length && <div className="card small muted">Aucun inscrit.</div>}
          {regs.map((r: any) => (
            <div key={r.user_id} className="item" style={{ cursor: 'default' }}><div className="grow"><b>{nm(r.user_id)}</b></div>
              {r.status === 'waitlist' && <span className="badge b-wait">Attente</span>}
              {r.checked_in_at ? <span className="badge b-ok">Présent</span> : <span className="badge b-wait">Non pointé</span>}</div>
          ))}
        </div>
      )}

      {tab === 'ma' && (
        <div className="stack">
          {!ms.length && <div className="card small muted">Le tirage n'a pas encore eu lieu.</div>}
          {ms.filter((m: any) => !m.bye).map((m: any) => (
            <div key={m.id} className="card stack">
              <div className="row small"><span className="muted grow">{m.phase === 'groups' ? 'Poule' : m.phase === 'rr' ? 'Championnat' : `Tour ${m.round_index + 1}`} · {fmt(m.scheduled_at)}</span></div>
              <div className="row"><b className="grow">{nm(m.player_a)} – {nm(m.player_b)}</b>{m.winner_id && <span className="badge b-ok">{m.score_a}–{m.score_b}</span>}</div>
              {!m.winner_id && m.player_a && m.player_b && (
                <div className="row">
                  <input className="in" inputMode="numeric" placeholder="A" style={{ width: 64 }} value={sc[m.id]?.[0] ?? ''} onChange={(e) => setSc({ ...sc, [m.id]: [e.target.value, sc[m.id]?.[1] ?? ''] })} />
                  <input className="in" inputMode="numeric" placeholder="B" style={{ width: 64 }} value={sc[m.id]?.[1] ?? ''} onChange={(e) => setSc({ ...sc, [m.id]: [sc[m.id]?.[0] ?? '', e.target.value] })} />
                  <button className="btn" disabled={busy} onClick={() => act(async () => { const [a, b] = sc[m.id] || []; if (a === '' || b === '' || a == null || b == null) throw new Error('Entre les deux scores.'); await rpc('staff_set_result', { _match: m.id, _sa: Number(a), _sb: Number(b) }) }, 'Résultat enregistré')}>Valider</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'li' && (
        <div className="stack">
          {!dis.length && <div className="card small muted">Aucun litige.</div>}
          {dis.map((d: any) => {
            const m = ms.find((x: any) => x.id === d.match_id)
            const v = sc['d' + d.id] || ['', '']
            return (
              <div key={d.id} className="card stack">
                <div className="row"><b className="grow">{m ? `${nm(m.player_a)} – ${nm(m.player_b)}` : 'Match'}</b><span className={'badge ' + (d.status === 'open' ? 'b-gold' : 'b-wait')}>{d.status === 'open' ? 'À traiter' : 'Réglé'}</span></div>
                <div className="small">{d.reason}</div>
                {d.status === 'open' && (
                  <>
                    <div className="row"><input className="in" inputMode="numeric" placeholder="Score A" value={v[0]} onChange={(e) => setSc({ ...sc, ['d' + d.id]: [e.target.value, v[1]] })} />
                      <input className="in" inputMode="numeric" placeholder="Score B" value={v[1]} onChange={(e) => setSc({ ...sc, ['d' + d.id]: [v[0], e.target.value] })} /></div>
                    <div className="row">
                      <button className="btn ghost" disabled={busy} onClick={() => act(() => rpc('resolve_dispute', { _dispute: d.id, _accept: false }), 'Contestation rejetée')}>Rejeter</button>
                      <button className="btn" disabled={busy} onClick={() => act(async () => { if (v[0] === '' || v[1] === '') throw new Error('Entre le score retenu.'); await rpc('resolve_dispute', { _dispute: d.id, _accept: true, _sa: Number(v[0]), _sb: Number(v[1]) }) }, 'Litige réglé')}>Appliquer ce score</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'an' && (
        <div className="stack">
          <div className="card stack"><textarea className="in" rows={3} maxLength={300} placeholder="Message pour tous les inscrits" value={ann} onChange={(e) => setAnn(e.target.value)} />
            <button className="btn" disabled={busy} onClick={postAnn}>Publier l'annonce</button></div>
          {an.map((a: any) => <div key={a.id} className="card small"><div>{a.body}</div><div className="muted" style={{ marginTop: 4 }}>{fmt(a.created_at)}</div></div>)}
        </div>
      )}

      {tab === 'eq' && (
        <div className="stack">
          <div className="card small muted">Un délégué t'aide à gérer cette compétition : horaires des tours, résultats, litiges et annonces. Il ne peut ni annuler la compétition, ni changer les réglages, ni inviter d'autres personnes. Les délégués sont retirés automatiquement à la fin de la compétition.</div>
          <b>Équipe ({staff.length}/3)</b>
          {!staff.length && <div className="small muted">Personne pour le moment.</div>}
          {staff.map((s: any) => (
            <div key={s.user_id} className="item" style={{ cursor: 'default' }}><div className="grow"><b>{nm(s.user_id)}</b></div>
              <span className={'badge ' + (s.status === 'active' ? 'b-ok' : 'b-wait')}>{s.status === 'active' ? 'Actif' : 'Invité'}</span>
              {isOrg && <button className="badge b-wait" style={{ border: 0 }} onClick={() => act(() => rpc('remove_delegate', { _comp: id, _user: s.user_id }), 'Délégué retiré')}>Retirer</button>}</div>
          ))}
          {isOrg && (
            <>
              <label className="f">Inviter un joueur<input className="in" placeholder="Nom du joueur" value={dg} onChange={(e) => setDg(e.target.value)} /></label>
              <button className="btn" disabled={busy || !dg.trim()} onClick={invite}>Inviter comme délégué</button>
            </>
          )}
        </div>
      )}

      {tab === 're' && rs && (
        <div className="stack">
          <label className="f">Nom<input className="in" value={rs.name} onChange={(e) => setRs({ ...rs, name: e.target.value })} maxLength={80} /></label>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="f grow">Date de début<input className="in" type="date" value={rs.date} onChange={(e) => setRs({ ...rs, date: e.target.value })} /></label>
            <label className="f grow">Heure<select className="in" value={rs.time} onChange={(e) => setRs({ ...rs, time: e.target.value })}>{timeOptions().map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className="small muted">Si tu changes le jour ou l'heure, préviens les inscrits par une annonce.</div>
          <label className="f">Nombre de places<input className="in" type="number" inputMode="numeric" value={rs.max} onChange={(e) => setRs({ ...rs, max: e.target.value })} /></label>
          <label className="f">Règlement<textarea className="in" value={rs.rules} onChange={(e) => setRs({ ...rs, rules: e.target.value })} placeholder="Format, horaires, conditions de participation…" /></label>
          <label className="f">Réglages des matchs<select className="in" value={rs.preset} onChange={(e) => setRs({ ...rs, preset: e.target.value })}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="item"><span className="grow small">Diffusion obligatoire des demi-finales et de la finale</span><input type="checkbox" className="sw" checked={rs.live} onChange={(e) => setRs({ ...rs, live: e.target.checked })} /></label>
          <button className="btn" disabled={busy} onClick={save}>Enregistrer les modifications</button>
        </div>
      )}
    </section>
  )
}
