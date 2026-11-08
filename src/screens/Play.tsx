import React, { useEffect, useState } from 'react'
import { sb, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { useApp, useLoad, q, rpc, Top, Spin, ErrBox, errMsg, namesOf, GameArt, Av, openEfootball } from '../lib/ui'
import { overlayAvailable, startArenaBubble, stopArenaBubble, arenaBubbleStatus, onArenaLiveStateChanged } from '../lib/overlay'

const rid = (r: any) => (typeof r === 'string' ? r : r?.id || r?.room_id || (Array.isArray(r) ? rid(r[0]) : r))

export function Play() {
  const { me, nav } = useApp()
  const { data } = useLoad(async () => {
    const mine = await q<any[]>(sb.from('room_players').select('room_id,rooms(id,code,status)').eq('user_id', me.id))
    return mine.map((m) => m.rooms).find((r: any) => r && ['open', 'started'].includes(r.status)) || null
  }, [me.id])
  return (
    <section className="screen">
      <div className="top"><h2>Jouer</h2></div>
      <div className="stack">
        {data && (
          <button className="item" onClick={() => nav.go(data.status === 'started' ? 'rplay' : 'room', { id: data.id })}>
            <div className="tile" style={{ background: 'var(--gold)', color: '#1a1200' }}>▶</div>
            <div className="grow"><b>Reprendre ma salle</b><div className="small muted">{data.code}</div></div><span className="muted">›</span>
          </button>
        )}
        <button className="item" style={{ borderColor: 'var(--blue)' }} onClick={() => nav.go('rcreate')}>
          <div className="tile" style={{ background: 'var(--blue)' }}>+</div>
          <div className="grow"><b>Créer une salle</b><div className="small muted">Joue avec un ami, en privé</div></div><span className="muted">›</span>
        </button>
        <button className="item" onClick={() => nav.go('rjoin')}>
          <div className="tile" style={{ background: 'var(--panel2)' }}>#</div>
          <div className="grow"><b>Rejoindre avec un code</b><div className="small muted">Saisis le code reçu</div></div><span className="muted">›</span>
        </button>
      </div>
      <div className="sec"><h3>Jeu</h3></div>
      <div className="item" style={{ cursor: 'default' }}>
        <GameArt size={54} />
        <div className="grow"><b>eFootball</b><div className="small muted">Mobile · 1v1</div></div>
      </div>
      <div className="card small muted" style={{ marginTop: 12 }}>
        Bientôt dans Arena : FIFA 24, Free Fire, Call of Duty Mobile, PUBG Mobile, Rocket League. Pour le lancement, Arena se concentre sur eFootball.
      </div>
    </section>
  )
}

export function RoomCreate() {
  const { me, nav, toast } = useApp()
  const [rules, setRules] = useState('')
  const [live, setLive] = useState('all')
  const [inv, setInv] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: friends } = useLoad(async () => (await rpc('list_friends')) as any[], [me.id])
  const fr = (friends || []).filter((f: any) => f.status === 'accepted')
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await rpc('create_friendly_room', { _mode: '1v1', _rules: rules.trim() || null, _live_audience: live, _invite: inv })
      toast('Salle créée')
      nav.replace('room', { id: rid(r) })
    } catch (e: any) { setErr(errMsg(e)); setBusy(false) }
  }
  const seg = (opts: [string, string][], v: string, set: (x: string) => void) => (
    <div className="seg">{opts.map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div>
  )
  return (
    <section className="screen">
      <Top title="Créer une salle" />
      <div className="stack">
        <div><div className="small muted" style={{ marginBottom: 6 }}>Jeu</div><div className="in">eFootball · 1v1</div></div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Inviter des amis</div>
          {!friends ? <div className="small muted">…</div> : !fr.length ? <div className="small muted">Aucun ami pour le moment. Ajoute-en via Recherche.</div> : (
            <div className="chips">
              {fr.map((f: any) => (
                <button key={f.user_id} className={'chip' + (inv.includes(f.user_id) ? ' on' : '')}
                  onClick={() => setInv((x) => (x.includes(f.user_id) ? x.filter((i) => i !== f.user_id) : [...x, f.user_id]))}>{f.username}</button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Règles (facultatif)</div>
          <input className="in" maxLength={120} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Ex : 10 min par mi-temps, pas de pause" />
        </div>
        <div><div className="small muted" style={{ marginBottom: 6 }}>Qui peut regarder le live</div>{seg([['all', 'Tout le monde'], ['friends', 'Amis'], ['none', 'Personne']], live, setLive)}</div>
        <div className="card small muted">La salle est privée : seuls ceux qui ont le code (ou une invitation) peuvent entrer. Le live ne démarre que si tous les joueurs l'acceptent.</div>
        <ErrBox text={err} />
        <button className="btn" disabled={busy} onClick={go}>Créer la salle</button>
      </div>
    </section>
  )
}

export function RoomJoin() {
  const { nav } = useApp()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true); setErr('')
    try { const r = await rpc('join_room', { _code: code.trim() }); nav.replace('room', { id: rid(r) }) }
    catch (e: any) { setErr(errMsg(e)); setBusy(false) }
  }
  return (
    <section className="screen">
      <Top title="Rejoindre" />
      <div className="stack">
        <div><div className="small muted" style={{ marginBottom: 6 }}>Code de la salle</div>
          <input className="in" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex : ARN-4587" maxLength={10} autoCapitalize="characters" /></div>
        <ErrBox text={err} />
        <button className="btn" disabled={busy || code.trim().length < 4} onClick={go}>Rejoindre la salle</button>
      </div>
    </section>
  )
}

async function loadRoom(id: string) {
  const room = await q<any>(sb.from('rooms').select('id,code,mode,capacity,host_id,status,rules,live_audience').eq('id', id).single())
  const pl = await q<any[]>(sb.from('room_players').select('user_id,ready,consent').eq('room_id', id))
  const names = await namesOf(pl.map((p) => p.user_id))
  return { room, pl, names }
}

export function Room({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, loading, reload, err: lerr } = useLoad(async () => {
    const d = await loadRoom(id)
    if (d.room.status === 'started') nav.replace('rplay', { id })
    else if (d.room.status === 'closed') nav.replace('rplay', { id })
    return d
  }, [id], 3000)
  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('')
    try { await fn(); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  if (loading && !data) return <section className="screen"><Top title="Salle" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Salle" /><ErrBox text={lerr || 'Salle introuvable.'} /></section>
  const { room, pl, names } = data
  const cap = room.capacity || (room.mode === '2v2' ? 4 : 2)
  const mine = pl.find((p) => p.user_id === me.id)
  const isHost = room.host_id === me.id
  const nReady = pl.filter((p) => p.ready).length
  const num = String(room.code).replace(/\D/g, '')
  const copy = async () => { try { await navigator.clipboard.writeText(room.code); toast('Code copié') } catch { toast(room.code) } }
  const share = async () => {
    const t = `Rejoins ma salle eFootball sur Arena Game Hub : ${room.code}`
    try { if ((navigator as any).share) await (navigator as any).share({ text: t }); else { await navigator.clipboard.writeText(t); toast('Message copié') } } catch { /* annulé */ }
  }
  const leave = () => act(async () => { await rpc('leave_room', { _room: id }); nav.back() })
  return (
    <section className="screen">
      <Top title={`eFootball · Salle #${num}`} />
      <div className="small muted" style={{ marginTop: -8, marginBottom: 12 }}>{pl.length}/{cap} joueurs · {nReady} prêt(s)</div>
      <div className="card row" style={{ marginBottom: 10 }}>
        <div className="grow"><div className="small muted">Code de la salle</div><b style={{ fontSize: 22, letterSpacing: 1 }}>{room.code}</b></div>
        <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px' }} onClick={copy}>Copier</button>
      </div>
      <button className="btn ghost" style={{ marginBottom: 8 }} onClick={share}>Envoyer le code à un ami</button>
      <div className="small muted" style={{ marginBottom: 12 }}>Donne ce code à ton adversaire. Quand tout le monde est prêt, l'hôte démarre la partie.</div>
      <div className="stack">
        {Array.from({ length: cap }).map((_, i) => {
          const p = pl[i]
          if (!p) return <div key={i} className="item" style={{ borderStyle: 'dashed', opacity: .7, cursor: 'default' }}><div className="tile" style={{ background: 'transparent' }}>?</div><div className="grow muted">En attente d'un joueur…</div></div>
          const self = p.user_id === me.id
          return (
            <div key={p.user_id} className="item" style={{ cursor: 'default' }}>
              <Av name={names[p.user_id]} size={44} />
              <div className="grow"><b>{names[p.user_id] || '…'}{self ? ' (toi)' : ''}</b>{room.host_id === p.user_id && <div className="small muted">Hôte</div>}</div>
              {self
                ? <button className={'badge ' + (p.ready ? 'b-ok' : 'b-gold')} style={{ border: 0 }} disabled={busy} onClick={() => act(() => rpc('set_room_ready', { _room: id, _ready: !p.ready }))}>{p.ready ? 'Prêt' : 'Je suis prêt'}</button>
                : <span className={'badge ' + (p.ready ? 'b-ok' : 'b-wait')}>{p.ready ? 'Prêt' : 'Pas prêt'}</span>}
            </div>
          )
        })}
      </div>
      <div className="card small" style={{ marginTop: 12 }}>
        {room.live_audience === 'none' ? 'Pas de live pour cette salle.' : `Live : ${room.live_audience === 'friends' ? 'visible par tes amis' : 'visible par tout le monde'}, démarre au début de la partie et s'arrête à la fin.`}
      </div>
      <div className="card small" style={{ marginTop: 10 }}>Règles : {room.rules || 'standard'} · début maintenant · salle privée.</div>
      {room.live_audience !== 'none' && mine && (
        <label className="card row" style={{ marginTop: 10, gap: 12 }}>
          <input type="checkbox" className="sw" checked={!!mine.consent} onChange={(e) => act(() => rpc('set_room_consent', { _room: id, _consent: e.target.checked }))} />
          <div className="small grow">J'accepte que cette salle soit diffusée : le live démarre au début de la partie et s'arrête à la fin.</div>
        </label>
      )}
      <ErrBox text={err} />
      <div className="stack" style={{ marginTop: 14 }}>
        {isHost && <button className="btn" disabled={busy} onClick={() => act(async () => { await rpc('start_room', { _room: id }); nav.replace('rplay', { id }) })}>Démarrer la partie</button>}
        <button className="btn ghost" disabled={busy} onClick={leave}>Quitter la salle</button>
      </div>
    </section>
  )
}

export function RoomPlay({ id }: { id: string }) {
  const { me, nav, toast } = useApp()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [rated, setRated] = useState(false)
  const [bubbleShown, setBubbleShown] = useState(false)
  const [bubbleLive, setBubbleLive] = useState(false)

  useEffect(() => {
    arenaBubbleStatus().then((s) => { setBubbleShown(s.shown); setBubbleLive(s.live) })
    const sub = onArenaLiveStateChanged((live) => setBubbleLive(live))
    return () => { try { sub.remove() } catch {} }
  }, [])

  const toggleBubble = async () => {
    if (bubbleShown) { await stopArenaBubble(); setBubbleShown(false); setBubbleLive(false); return }
    try {
      const { data: s } = await sb.auth.getSession()
      const token = s.session?.access_token
      if (!token) return setErr('Session expirée, reconnecte-toi.')
      await startArenaBubble({
        roomId: id,
        mode: 'room',
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY,
        accessToken: token,
        userId: me.id,
        displayName: me.profile?.username || 'Joueur',
      })
      setBubbleShown(true)
    } catch (e: any) {
      if (e.message === 'not_native') setErr("La bulle flottante n'est disponible que dans l'application Android.")
      else if (e.message === 'overlay_denied') setErr("Autorisation « Affichage par-dessus les autres apps » refusée : la bulle ne peut pas s'ouvrir.")
      else if (e.message === 'projection_denied') setErr("Autorisation de capture d'écran refusée : le live ne pourra pas démarrer.")
      else setErr(errMsg(e))
    }
  }
  const { data, loading, reload } = useLoad(async () => {
    const d = await loadRoom(id)
    const ids = d.pl.map((p) => p.user_id).filter((u) => u !== me.id)
    const idents = ids.length ? await q<any[]>(sb.from('player_identity').select('user_id,arena_id').in('user_id', ids)) : []
    return { ...d, idents }
  }, [id], 4000)
  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('')
    try { await fn(); await reload() } catch (e: any) { setErr(errMsg(e)) }
    setBusy(false)
  }
  if (loading && !data) return <section className="screen"><Top title="Partie" /><Spin /></section>
  if (!data) return <section className="screen"><Top title="Partie" /><ErrBox text="Salle introuvable." /></section>
  const { room, pl, names, idents } = data
  const opp = pl.filter((p) => p.user_id !== me.id)
  const closed = room.status === 'closed'
  const aid = (u: string) => idents.find((i: any) => i.user_id === u)?.arena_id
  const exit = async () => { try { await rpc('leave_room', { _room: id }) } catch { /* */ } nav.tab('play') }
  return (
    <section className="screen">
      <Top title={closed ? 'Partie terminée' : 'En cours de partie'} back={false} right={!closed && <span className="badge b-live">● LIVE</span>} />
      <div className="pitch" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'center', gap: 18 }}>
          <Av name={me.profile?.username} size={50} />
          <b style={{ fontSize: 22 }}>VS</b>
          <Av name={names[opp[0]?.user_id]} size={50} />
        </div>
      </div>
      {!closed && (overlayAvailable() ? (
        <div className="card small stack" style={{ marginBottom: 10, borderColor: bubbleLive ? 'var(--live)' : 'var(--gold)' }}>
          <b>{bubbleLive ? '🔴 Live en cours' : 'Bulle flottante'}</b>
          <div className="muted">
            {bubbleShown
              ? "La bulle est active par-dessus eFootball : échangez-y le code de la salle, puis utilisez-la pour le live, la capture d'écran et la discussion."
              : "Ouvre la bulle avant d'aller sur eFootball : n'importe qui peut y indiquer le code de la salle, elle reste ensuite affichée pour le live et la discussion."}
          </div>
          <button className="btn" style={bubbleShown ? { background: 'var(--line)' } : undefined} disabled={busy} onClick={toggleBubble}>
            {bubbleShown ? 'Fermer la bulle' : 'Ouvrir la bulle flottante'}
          </button>
        </div>
      ) : (
        <div className="small muted" style={{ marginBottom: 10 }}>🫧 La bulle flottante n'est disponible que dans l'application Android installée (pas dans un navigateur).</div>
      ))}
      {!closed && <button className="btn ghost" style={{ marginBottom: 10 }} onClick={() => openEfootball(toast)}>Ouvrir le jeu directement</button>}
      <div className="card small muted" style={{ marginBottom: 10 }}>Joue ta partie dans eFootball avec le code de salle, puis reviens ici pour la terminer.</div>
      <div className="stack">
        {opp.map((p) => (
          <div key={p.user_id} className="item" style={{ cursor: 'default' }}>
            <Av name={names[p.user_id]} size={44} />
            <div className="grow"><b>{names[p.user_id]}</b><div className="small muted">Identifiant Arena</div></div>
            <b className="arena-id">{aid(p.user_id) || '—'}</b>
          </div>
        ))}
      </div>
      <ErrBox text={err} />
      {!closed ? (
        room.host_id === me.id
          ? <button className="btn gold" style={{ marginTop: 14 }} disabled={busy} onClick={() => act(() => rpc('end_room', { _room: id }))}>Terminer la partie</button>
          : <div className="card small muted" style={{ marginTop: 14 }}>L'hôte termine la partie une fois le match joué.</div>
      ) : (
        <div className="stack" style={{ marginTop: 14 }}>
          {!rated && opp.map((p) => (
            <div key={p.user_id} className="card stack">
              <b>Comment était {names[p.user_id]} ?</b>
              <div className="chips">
                {[['fair', 'Fair-play'], ['ok', 'Correct'], ['problem', 'Problème']].map(([k, l]) => (
                  <button key={k} className="chip" onClick={() => act(async () => { await rpc('rate_friendly', { _room: id, _rated: p.user_id, _rating: k }); setRated(true); toast('Merci !') })}>{l}</button>
                ))}
              </div>
            </div>
          ))}
          <button className="btn" onClick={exit}>Quitter la salle</button>
        </div>
      )}
    </section>
  )
}
