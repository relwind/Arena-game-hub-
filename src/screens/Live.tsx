import React, { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, Top, Spin, errMsg, namesOf, fmt } from '../lib/ui'

export function Live() {
  const { nav } = useApp()
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
              <button key={l.id} className="item" onClick={() => nav.go('watch', { id: l.id })}>
                <div className="grow"><b>{m ? `${data.names[m.player_a]} vs ${data.names[m.player_b]}` : 'Match'}</b><div className="small muted">{c?.name} · depuis {fmt(l.started_at)}</div></div>
                <span className="badge b-live">LIVE</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Délai avant de considérer qu'il n'y a vraiment aucun flux vidéo (laisse le temps
// à la connexion LiveKit et à la publication côté joueur de s'établir).
const NO_VIDEO_TIMEOUT_MS = 12000

export function Watch({ id }: { id: string }) {
  const { me } = useApp()
  const [status, setStatus] = useState<'connecting' | 'waiting' | 'live' | 'ended' | 'error'>('connecting')
  const [err, setErr] = useState('')
  // Les deux joueurs d'un match peuvent diffuser en même temps : on garde un flux
  // vidéo par identité (= id du joueur côté Arena, utilisé comme identity LiveKit)
  // et on permet de basculer entre eux, un peu comme un mode spectateur CoD/Free Fire.
  const [feeds, setFeeds] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const roomRef = useRef<any>(null)
  const tracksRef = useRef<Record<string, any>>({})
  const attachedRef = useRef<{ identity: string | null; track: any }>({ identity: null, track: null })
  const selectedRef = useRef<string | null>(null)

  const { data } = useLoad(async () => {
    const s = await q<any>(sb.from('live_sessions').select('id,match_id,competition_id,status,started_at').eq('id', id).single())
    const m = s.match_id ? await q<any>(sb.from('matches').select('id,player_a,player_b').eq('id', s.match_id).single()) : null
    const names = m ? await namesOf([m.player_a, m.player_b]) : {}
    return { s, m, names }
  }, [id], 8000)

  // Affiche le flux demandé dans la balise <video> : détache l'ancien, attache le nouveau.
  const showFeed = (identity: string | null) => {
    const el = videoRef.current
    const prev = attachedRef.current
    if (el && prev.track && prev.identity !== identity) { try { prev.track.detach(el) } catch { /* */ } }
    const track = identity ? tracksRef.current[identity] : null
    if (el && track) { try { track.attach(el) } catch { /* */ } }
    attachedRef.current = { identity, track: track || null }
    selectedRef.current = identity
    setSelected(identity)
  }

  useEffect(() => {
    let cancelled = false
    let noVideoTimer: any = null

    const connect = async () => {
      try {
        const { data: d, error } = await sb.functions.invoke('livekit-token', {
          body: { session: id, publish: false, displayName: me.profile?.username || 'Spectateur' },
        })
        if (error) throw new Error(errMsg(error))
        const url = d?.url, token = d?.token
        if (!url || !token) throw new Error("Jeton vidéo refusé — le live n'est peut-être plus actif.")
        if (cancelled) return

        const { Room, RoomEvent, Track } = await import('livekit-client')
        const room = new Room()
        roomRef.current = room

        const addFeed = (identity: string, track: any) => {
          tracksRef.current[identity] = track
          setFeeds((f) => (f.includes(identity) ? f : [...f, identity]))
          if (noVideoTimer) clearTimeout(noVideoTimer)
          setStatus('live')
          // Premier flux reçu : on l'affiche. Si c'était déjà celui sélectionné (reconnexion), on réaffiche.
          if (selectedRef.current === null || selectedRef.current === identity) showFeed(identity)
        }

        room.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
          if (track.kind === Track.Kind.Video) addFeed(participant.identity, track)
        })
        room.on(RoomEvent.TrackUnsubscribed, (track: any, _pub: any, participant: any) => {
          if (track.kind !== Track.Kind.Video) return
          delete tracksRef.current[participant.identity]
          setFeeds((f) => f.filter((x) => x !== participant.identity))
          if (selectedRef.current === participant.identity) {
            const next = Object.keys(tracksRef.current)[0] || null
            showFeed(next)
            if (!next) setStatus('waiting')
          }
        })
        room.on(RoomEvent.Disconnected, () => { if (!cancelled) setStatus('ended') })

        await room.connect(url, token)
        if (cancelled) { room.disconnect(); return }

        // Flux déjà en cours de publication au moment où on rejoint la room.
        room.remoteParticipants.forEach((p: any) => {
          p.videoTrackPublications.forEach((pub: any) => { if (pub.track) addFeed(p.identity, pub.track) })
        })

        setStatus((s) => (s === 'connecting' ? 'waiting' : s))
        noVideoTimer = setTimeout(() => { if (!cancelled) setStatus((s) => (s === 'waiting' ? 'waiting' : s)) }, NO_VIDEO_TIMEOUT_MS)
      } catch (e: any) {
        if (!cancelled) { setStatus('error'); setErr(errMsg(e)) }
      }
    }
    connect()

    return () => {
      cancelled = true
      if (noVideoTimer) clearTimeout(noVideoTimer)
      try { roomRef.current?.disconnect() } catch { /* */ }
      roomRef.current = null
      tracksRef.current = {}
      attachedRef.current = { identity: null, track: null }
    }
  }, [id])

  const title = data?.m ? `${data.names[data.m.player_a] || '…'} vs ${data.names[data.m.player_b] || '…'}` : 'Live'
  const nameOf = (uid: string) => data?.names?.[uid] || 'Joueur'

  return (
    <section className="screen">
      <Top title={title} />
      <div className="card center" style={{ padding: 0, overflow: 'hidden', aspectRatio: '16/9', background: '#000', position: 'relative' }}>
        <video ref={videoRef} autoPlay playsInline muted={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: status === 'live' ? 'block' : 'none' }} />
        {status !== 'live' && (
          <div className="small muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16 }}>
            {status === 'connecting' && 'Connexion au live…'}
            {status === 'waiting' && "En attente de l'image d'un joueur…"}
            {status === 'ended' && 'Ce live est terminé.'}
            {status === 'error' && (err || 'Impossible de rejoindre ce live.')}
          </div>
        )}
      </div>
      {feeds.length > 1 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {feeds.map((identity) => (
            <button key={identity} className={'chip' + (selected === identity ? ' on' : '')} onClick={() => showFeed(identity)}>
              📺 {nameOf(identity)}
            </button>
          ))}
        </div>
      )}
      <div className="card small muted" style={{ marginTop: 10 }}>
        {feeds.length > 1
          ? "Les deux joueurs diffusent leur écran : choisis lequel regarder ci-dessus."
          : "Le flux peut avoir quelques secondes de décalage. Si rien ne s'affiche après une minute, le joueur a peut-être mis en pause ou arrêté son live."}
      </div>
    </section>
  )
}
