import { registerPlugin, Capacitor } from '@capacitor/core'

interface ArenaOverlayPlugin {
  hasOverlayPermission(): Promise<{ granted: boolean }>
  requestOverlayPermission(): Promise<{ granted: boolean }>
  requestProjectionPermission(): Promise<{ granted: boolean }>
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
  }): Promise<void>
  hideBubble(): Promise<void>
  isBubbleShown(): Promise<{ shown: boolean; live: boolean }>
  addListener(eventName: 'liveStateChanged', cb: (data: { live: boolean }) => void): any
  addListener(eventName: 'screenshotTaken', cb: (data: { path: string }) => void): any
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
  await ArenaOverlay.showBubble({ sessionId: '', matchId: '', roomId: '', ...args })
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
