import React, { useEffect, useRef, useState } from 'react'
import { sb } from '../lib/supabase'
import { useApp, useLoad, q, rpc, Top, Spin, ErrBox, errMsg, namesOf, Av } from '../lib/ui'

const ago = (d?: string) => {
  if (!d) return ''
  const x = new Date(d), n = new Date()
  if (x.toDateString() === n.toDateString()) return x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const y = new Date(n.getTime() - 864e5)
  return x.toDateString() === y.toDateString() ? 'Hier' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function Messages() {
  const { me, nav, toast } = useApp()
  const [tab, setTab] = useState('d')
  const { data, loading, reload } = useLoad(async () => {
    const mem = await q<any[]>(sb.from('channel_members').select('channel_id,last_read_at').eq('user_id', me.id))
    const ids = mem.map((m) => m.channel_id)
    const chans = ids.length ? await q<any[]>(sb.from('channels').select('id,kind,name,competition_id').in('id', ids)) : []
    const others = ids.length ? await q<any[]>(sb.from('channel_members').select('channel_id,user_id').in('channel_id', ids).neq('user_id', me.id)) : []
    const msgs = ids.length ? await q<any[]>(sb.from('messages').select('channel_id,body,created_at,user_id').in('channel_id', ids).is('deleted_at', null).order('created_at', { ascending: false }).limit(200)) : []
    const names = await namesOf(others.map((o) => o.user_id))
    const friends = (await rpc('list_friends')) as any[]
    const last: Record<string, any> = {}, unread: Record<string, number> = {}
    msgs.forEach((m) => {
      if (!last[m.channel_id]) last[m.channel_id] = m
      const lr = mem.find((x) => x.channel_id === m.channel_id)?.last_read_at
      if (m.user_id !== me.id && (!lr || m.created_at > lr)) unread[m.channel_id] = (unread[m.channel_id] || 0) + 1
    })
    const rows = chans.map((c) => {
      const o = others.find((x) => x.channel_id === c.id)
      return { ...c, title: c.kind === 'dm' ? names[o?.user_id] || 'Joueur' : c.name || 'Canal', last: last[c.id], unread: unread[c.id] || 0 }
    }).sort((a, b) => (b.last?.created_at || '').localeCompare(a.last?.created_at || ''))
    return { rows, friends }
  }, [me.id], 8000)

  const openDm = async (u: string, name: string) => {
    try { const ch = await rpc('open_dm', { _other: u }); nav.go('conv', { id: ch, name }) } catch (e: any) { toast(errMsg(e)) }
  }
  const resp = async (u: string, ok: boolean) => {
    try { await rpc('respond_friend', { _other: u, _accept: ok }); toast(ok ? 'Ami ajouté' : 'Demande refusée'); await reload() } catch (e: any) { toast(errMsg(e)) }
  }
  const dms = (data?.rows || []).filter((r: any) => r.kind === 'dm')
  const chs = (data?.rows || []).filter((r: any) => r.kind !== 'dm')
  const acc = (data?.friends || []).filter((f: any) => f.status === 'accepted')
  const inc = (data?.friends || []).filter((f: any) => f.status === 'pending' && f.incoming)
  const row = (r: any) => (
    <button key={r.id} className="item" onClick={() => nav.go('conv', { id: r.id, name: r.title })}>
      <Av name={r.title} size={48} />
      <div className="grow"><b>{r.title}</b><div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.last?.body || 'Aucun message'}</div></div>
      <div style={{ textAlign: 'right' }}><div className="small muted">{ago(r.last?.created_at)}</div>{r.unread > 0 && <b>{r.unread}</b>}</div>
    </button>
  )
  return (
    <section className="screen">
      <Top title="Messages" />
      <div className="seg" style={{ marginBottom: 12 }}>
        {[['d', 'Discussions'], ['a', 'Amis'], ['c', 'Canaux'], ['r', `Demandes${inc.length ? ' ' + inc.length : ''}`]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} style={{ fontSize: 12.5, padding: '8px 2px' }} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {loading && !data ? <Spin /> : (
        <div className="stack">
          {tab === 'd' && (!dms.length ? <div className="card small muted">Aucune discussion. Va dans « Amis » pour écrire à quelqu'un.</div> : dms.map(row))}
          {tab === 'a' && (
            <>
              <button className="btn ghost" onClick={() => nav.go('search')}>Rechercher un joueur</button>
              {!acc.length && <div className="card small muted">Aucun ami pour le moment.</div>}
              {acc.map((f: any) => (
                <button key={f.user_id} className="item" onClick={() => openDm(f.user_id, f.username)}><Av name={f.username} size={48} /><div className="grow"><b>{f.username}</b><div className="small muted">Écrire un message</div></div><span className="muted">›</span></button>
              ))}
            </>
          )}
          {tab === 'c' && (!chs.length ? <div className="card small muted">Aucun canal. Les canaux des compétitions apparaissent ici une fois inscrit.</div> : chs.map(row))}
          {tab === 'r' && (!inc.length ? <div className="card small muted">Aucune demande d'ami.</div> : inc.map((f: any) => (
            <div key={f.user_id} className="item" style={{ cursor: 'default' }}><Av name={f.username} size={48} /><div className="grow"><b>{f.username}</b></div>
              <button className="badge b-ok" style={{ border: 0 }} onClick={() => resp(f.user_id, true)}>Accepter</button>
              <button className="badge b-wait" style={{ border: 0 }} onClick={() => resp(f.user_id, false)}>Refuser</button></div>
          )))}
        </div>
      )}
    </section>
  )
}

export function Conv({ id, name }: { id: string; name: string }) {
  const { me, toast } = useApp()
  const [txt, setTxt] = useState('')
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const { data, loading, reload } = useLoad(async () => {
    const ms = await q<any[]>(sb.from('messages').select('id,user_id,body,created_at').eq('channel_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(80))
    const names = await namesOf(ms.map((m) => m.user_id))
    sb.from('channel_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', id).eq('user_id', me.id).then(() => {})
    return { ms: ms.reverse(), names }
  }, [id], 4000)
  useEffect(() => { end.current?.scrollIntoView() }, [data?.ms.length])
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!txt.trim()) return
    setErr('')
    try { await rpc('send_message', { _channel: id, _body: txt.trim() }); setTxt(''); await reload() } catch (x: any) { setErr(errMsg(x)); toast(errMsg(x)) }
  }
  return (
    <section className="screen">
      <Top title={name || 'Discussion'} />
      <div className="card stack">
        <div className="chat" style={{ maxHeight: '55vh', minHeight: 200 }}>
          {loading && !data ? <Spin /> : !data?.ms.length ? <div className="small muted">Aucun message. Dis bonjour !</div> : data.ms.map((m: any) => (
            <div key={m.id} className={'msg' + (m.user_id === me.id ? ' me' : '')}>
              {m.user_id !== me.id && <div className="small muted">{data.names[m.user_id]}</div>}{m.body}
            </div>
          ))}
          <div ref={end} />
        </div>
        <ErrBox text={err} />
        <form className="row" onSubmit={send}>
          <input className="in" placeholder="Écrire un message…" maxLength={500} value={txt} onChange={(e) => setTxt(e.target.value)} />
          <button className="btn" style={{ width: 'auto' }}>Envoyer</button>
        </form>
      </div>
    </section>
  )
}
