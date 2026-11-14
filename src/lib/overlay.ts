import { registerPlugin, Capacitor } from '@capacitor/core'

interface ArenaOverlayPlugin {
  hasOverlayPermission(): Promise<{ granted: boolean }>
  requestOverlayPermission(): Promise<{ granted: boolean }>
  requestProjectionPermission(): Promise<{ granted: boolean }>
  hasMicPermission(): Promise<{ granted: boolean }>
  requestMicPermission(): Promise<{ granted: boolean }>
  showBubble(opts: {
    sessionId: string
    matchId: string
    roomId: string
    mode: 'match' | 'room'
    supabaseUrl: string
    supabaseKey: string
    accessToken: string
    userId: string
    displayName: string
    audioAllowed: boolean
  }): Promise<void>
  hideBubble(): Promise<void>
  isBubbleShown(): Promise<{ shown: boolean; live: boolean }>
  addListener(eventName: 'liveStateChanged', cb: (data: { live: boolean }) => void): any
  addListener(eventName: 'screenshotTaken', cb: (data: { path: string }) => void): any
  addListener(eventName: 'endRequested', cb: (data: { matchId: string; roomId: string; mode: 'match' | 'room' }) => void): any
}

const ArenaOverlay = registerPlugin<ArenaOverlayPlugin>('ArenaOverlay')

export function overlayAvailable() {
  return Capacitor.isNativePlatform()
}

/**
 * Demande les deux permissions nécessaires (affichage par-dessus les autres apps,
 * puis capture d'écran) et lance la bulle flottante pour un match donné.
 * Doit être appelé pendant que l'appli Arena est au premier plan.
 */
export async function startArenaBubble(args: {
  matchId?: string
  roomId?: string
  mode: 'match' | 'room'
  supabaseUrl: string
  supabaseKey: string
  accessToken: string
  userId: string
  displayName: string
}) {
  if (!overlayAvailable()) throw new Error('not_native')
  let perm = await ArenaOverlay.hasOverlayPermission()
  if (!perm.granted) perm = await ArenaOverlay.requestOverlayPermission()
  if (!perm.granted) throw new Error('overlay_denied')
  const proj = await ArenaOverlay.requestProjectionPermission()
  if (!proj.granted) throw new Error('projection_denied')
  // Son du jeu en live : facultatif, on ne bloque jamais la bulle si le joueur refuse
  // ou si le micro n'est pas disponible — le live continue simplement sans le son.
  let audioAllowed = false
  try {
    const mic = await ArenaOverlay.requestMicPermission()
    audioAllowed = !!mic.granted
  } catch { /* pas grave : live vidéo seule */ }
  await ArenaOverlay.showBubble({ sessionId: '', matchId: '', roomId: '', audioAllowed, ...args })
}

export async function stopArenaBubble() {
  if (!overlayAvailable()) return
  await ArenaOverlay.hideBubble()
}

export async function arenaBubbleStatus() {
  if (!overlayAvailable()) return { shown: false, live: false }
  return ArenaOverlay.isBubbleShown()
}

export function onArenaLiveStateChanged(cb: (live: boolean) => void) {
  if (!overlayAvailable()) return { remove: () => {} }
  const handle: any = ArenaOverlay.addListener('liveStateChanged', (d) => cb(d.live))
  return {
    remove: () => {
      if (typeof handle?.remove === 'function') handle.remove()
      else if (typeof handle?.then === 'function') handle.then((h: any) => h.remove())
    },
  }
}

/**
 * Appelé quand le joueur appuie sur « Terminer » dans la bulle : le live est déjà
 * arrêté et la bulle fermée côté natif, il ne reste qu'à amener l'app au premier
 * plan sur le bon écran (géré au niveau de App.tsx, pas écran par écran).
 */
export function onArenaEndRequested(cb: (data: { matchId: string; roomId: string; mode: 'match' | 'room' }) => void) {
  if (!overlayAvailable()) return { remove: () => {} }
  const handle: any = ArenaOverlay.addListener('endRequested', cb)
  return {
    remove: () => {
      if (typeof handle?.remove === 'function') handle.remove()
      else if (typeof handle?.then === 'function') handle.then((h: any) => h.remove())
    },
  }
}
