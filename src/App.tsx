import React, { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { sb } from './lib/supabase'
import { Ctx, Route, Spin, q } from './lib/ui'
import { Splash, Login, Signup, Verify, OnbProfile, OnbPrefs, Valid } from './screens/Auth'
import { Home } from './screens/Home'
import { Comps, CompDetail, CompCreate, MyComps } from './screens/Comps'
import { MatchRoom, MyMatches } from './screens/Match'
import { Me, Notifs, Organizer } from './screens/Me'
import { Play, RoomCreate, RoomJoin, Room, RoomPlay } from './screens/Play'
import { Search, Rules } from './screens/Search'
import { Admin } from './screens/Admin'
import { Forgot, Settings, PublicProfile, Help, Legal } from './screens/Extra'
import { Messages, Conv } from './screens/Messages'
import { CompManage } from './screens/Manage'
import { Live } from './screens/Live'

const TABS: { name: string; label: string; icon: string }[] = [
  { name: 'home', label: 'Accueil', icon: 'M3 11l9-8 9 8M5 10v10h14V10' },
  { name: 'play', label: 'Jouer', icon: 'M2 7h20v11H2zM7 10v5M5 12.5h4M16 11h.01M18 14h.01' },
  { name: 'comps', label: 'Compétitions', icon: 'M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8' },
  { name: 'live', label: 'Live', icon: 'M12 10a2 2 0 100 4 2 2 0 000-4zM7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M4.8 4.8a10 10 0 000 14.4M19.2 4.8a10 10 0 010 14.4' },
  { name: 'me', label: 'Profil', icon: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]
const TAB_NAMES = TABS.map((t) => t.name)
const SECTION: Record<string, string> = {
  rcreate: 'play', rjoin: 'play', room: 'play', rplay: 'play',
  cdetail: 'comps', cmanage: 'comps', ccreate: 'comps', mycomps: 'comps', match: 'comps', mymatches: 'comps',
  notifs: 'me', settings: 'me', help: 'me', legal: 'me', pprof: 'home', messages: 'home', conv: 'home', organizer: 'me', admin: 'me', search: 'home', rules: 'home',
}

export default function App() {
  const [session, setSession] = useState<any>(undefined)
  const [me, setMe] = useState<any>(null)
  const [stack, setStack] = useState<Route[]>([{ name: 'splash' }])
  const [toastTxt, setToastTxt] = useState('')
  const toastT = useRef<any>(null)

  const toast = useCallback((t: string) => {
    setToastTxt(t)
    clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToastTxt(''), 3200)
  }, [])

  const loadMe = useCallback(async (uid: string) => {
    const [pr, id, ro, pp] = await Promise.all([
      sb.from('profiles').select('id,username,country,is_minor,bio,avatar_url').eq('id', uid).maybeSingle(),
      sb.from('player_identity').select('arena_id,efootball_name').eq('user_id', uid).maybeSingle(),
      sb.from('user_roles').select('role').eq('user_id', uid),
      sb.from('profile_private').select('onboarded').eq('user_id', uid).maybeSingle(),
    ])
    const pending = localStorage.getItem('arena_country')
    if (pending && pr.data && !pr.data.country) {
      await sb.from('profiles').update({ country: pending }).eq('id', uid)
      pr.data.country = pending
    }
    if (pending) localStorage.removeItem('arena_country')
    setMe({
      id: uid,
      profile: pr.data,
      ident: id.data,
      roles: (ro.data || []).map((r: any) => r.role),
      onboarded: pp.data ? !!pp.data.onboarded : true,
    })
  }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s || null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (session) {
      loadMe(session.user.id).then(() =>
        setStack((s) => (['splash', 'login', 'signup', 'verify'].includes(s[s.length - 1].name) ? [{ name: 'home' }] : s)))
    } else {
      setMe(null)
      setStack((s) => (['splash', 'login', 'signup', 'verify'].includes(s[s.length - 1].name) ? s : [{ name: 'splash' }]))
    }
  }, [session, loadMe])

  const nav = {
    go: (name: string, p?: any) => setStack((s) => [...s, { name, p }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name: string, p?: any) => setStack((s) => [...s.slice(0, -1), { name, p }]),
    tab: (name: string) => setStack([{ name }]),
  }

  const stackRef = useRef(stack)
  stackRef.current = stack
  useEffect(() => {
    const h = CapApp.addListener('backButton', () => {
      const s = stackRef.current
      if (s.length > 1) setStack(s.slice(0, -1))
      else if (TAB_NAMES.includes(s[0].name) && s[0].name !== 'home') setStack([{ name: 'home' }])
      else CapApp.minimizeApp()
    })
    return () => { h.then((x) => x.remove()) }
  }, [])

  if (session === undefined) return <Spin />

  const cur = stack[stack.length - 1]
  const showTabs = !!session && !!me && me.onboarded && !['rplay', 'valid'].includes(cur.name)
  const section = TAB_NAMES.includes(cur.name) ? cur.name : SECTION[cur.name] || 'home'
  const ctx = { nav, me, toast, refreshMe: () => (session ? loadMe(session.user.id) : Promise.resolve()) }

  let view: React.ReactNode
  const key = stack.length + cur.name + JSON.stringify(cur.p || {})
  if (!session) {
    view = cur.name === 'login' ? <Login /> : cur.name === 'forgot' ? <Forgot /> : cur.name === 'signup' ? <Signup /> : cur.name === 'verify' ? <Verify p={cur.p} /> : <Splash />
  } else if (!me) {
    view = <Spin />
  } else if (!me.onboarded && !['onb3', 'onb4', 'valid'].includes(cur.name)) {
    view = <OnbProfile />
  } else {
    switch (cur.name) {
      case 'onb3': view = <OnbProfile />; break
      case 'onb4': view = <OnbPrefs />; break
      case 'valid': view = <Valid />; break
      case 'home': view = <Home />; break
      case 'comps': view = <Comps />; break
      case 'cdetail': view = <CompDetail id={cur.p.id} />; break
      case 'ccreate': view = <CompCreate />; break
      case 'mycomps': view = <MyComps />; break
      case 'match': view = <MatchRoom id={cur.p.id} />; break
      case 'mymatches': view = <MyMatches />; break
      case 'play': view = <Play />; break
      case 'rcreate': view = <RoomCreate />; break
      case 'rjoin': view = <RoomJoin />; break
      case 'room': view = <Room id={cur.p.id} />; break
      case 'rplay': view = <RoomPlay id={cur.p.id} />; break
      case 'search': view = <Search />; break
      case 'admin': view = <Admin />; break
      case 'settings': view = <Settings />; break
      case 'pprof': view = <PublicProfile id={cur.p.id} />; break
      case 'help': view = <Help />; break
      case 'legal': view = <Legal k={cur.p?.k} />; break
      case 'messages': view = <Messages />; break
      case 'conv': view = <Conv id={cur.p.id} name={cur.p.name} />; break
      case 'cmanage': view = <CompManage id={cur.p.id} />; break
      case 'rules': view = <Rules />; break
      case 'live': view = <Live />; break
      case 'me': view = <Me />; break
      case 'notifs': view = <Notifs />; break
      case 'organizer': view = <Organizer />; break
      default: view = <Home />
    }
  }

  return (
    <Ctx.Provider value={ctx}>
      <div key={key}>{view}</div>
      {showTabs && (
        <nav className="tabbar">
          {TABS.map((t) => (
            <button key={t.name} className={section === t.name ? 'on' : ''} onClick={() => nav.tab(t.name)}>
              <svg viewBox="0 0 24 24"><path d={t.icon} /></svg>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      {toastTxt && <div className="toast">{toastTxt}</div>}
    </Ctx.Provider>
  )
}
