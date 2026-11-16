import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { sb } from './supabase'

let started = false

// Demande l'autorisation, crée le canal Android et enregistre le jeton de cet appareil.
// Ne fait rien dans un navigateur ou si l'utilisateur a déjà refusé : on ne redemande pas sans cesse.
export async function startPush(userId: string) {
  if (started || !Capacitor.isNativePlatform()) return
  started = true
  try {
    await PushNotifications.createChannel({
      id: 'arena_default',
      name: 'Arena Game Hub',
      description: 'Rappels de match, messages et annonces',
      importance: 4,
      visibility: 1,
    })

    const perm = await PushNotifications.checkPermissions()
    let state = perm.receive
    if (state === 'prompt' || state === 'prompt-with-rationale') {
      state = (await PushNotifications.requestPermissions()).receive
    }
    if (state !== 'granted') return

    PushNotifications.addListener('registration', async (token) => {
      try {
        await sb.from('push_tokens').upsert({ token: token.value, user_id: userId, platform: Capacitor.getPlatform() })
      } catch { /* pas grave : on réessaiera à la prochaine ouverture */ }
    })
    PushNotifications.addListener('registrationError', () => { /* pas de jeton cette fois, on continue sans */ })

    await PushNotifications.register()
  } catch { /* plateforme sans notifications push : on continue normalement */ }
}

// Écoute le tap sur une notification (y compris celle qui vient de lancer l'appli) et renvoie
// le "lien" attaché côté serveur (ex. "match:<id>", "room:<id>", "comp:<id>", "conv:<id>"),
// pour amener directement au bon endroit plutôt qu'à l'accueil.
export function onPushNotificationTapped(cb: (link: string) => void) {
  if (!Capacitor.isNativePlatform()) return { remove: () => {} }
  const handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const link = action?.notification?.data?.link as string | undefined
    if (link) cb(link)
  })
  return { remove: () => { handle.remove() } }
}
