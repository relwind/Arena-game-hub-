// Applique l'identité visuelle Arena au projet Android généré par Capacitor.
import fs from 'node:fs'
import path from 'node:path'

const res = 'android/app/src/main/res'
const src = 'resources/android'

for (const d of fs.readdirSync(src)) {
  const from = path.join(src, d)
  if (!fs.statSync(from).isDirectory()) continue
  const to = path.join(res, d)
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f))
}

fs.writeFileSync(path.join(res, 'values/arena_colors.xml'),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="arena_icon_bg">#070B16</color>
</resources>
`)

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/arena_icon_bg"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`
fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true })
for (const n of ['ic_launcher.xml', 'ic_launcher_round.xml'])
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', n), adaptive)

const stylesPath = path.join(res, 'values/styles.xml')
let styles = fs.readFileSync(stylesPath, 'utf8')
const bars = `        <item name="android:statusBarColor">#070B16</item>
        <item name="android:navigationBarColor">#070B16</item>
        <item name="android:windowLightStatusBar">false</item>
`
styles = styles.replace(/(<style name="AppTheme\.NoActionBar"[^>]*>)/, '$1\n' + bars)
fs.writeFileSync(stylesPath, styles)

// --- Firebase / notifications push -----------------------------------------
fs.copyFileSync('resources/android/google-services.json', 'android/app/google-services.json')

const rootGradlePath = 'android/build.gradle'
let rootGradle = fs.readFileSync(rootGradlePath, 'utf8')
if (!rootGradle.includes('com.google.gms:google-services')) {
  rootGradle = rootGradle.replace(
    /dependencies\s*\{/,
    `dependencies {
        classpath 'com.google.gms:google-services:4.4.2'`
  )
  fs.writeFileSync(rootGradlePath, rootGradle)
}

const appGradlePath = 'android/app/build.gradle'
let appGradle = fs.readFileSync(appGradlePath, 'utf8')
if (!appGradle.includes('google-services')) {
  appGradle += "\napply plugin: 'com.google.gms.google-services'\n"
  fs.writeFileSync(appGradlePath, appGradle)
}

const manPath = 'android/app/src/main/AndroidManifest.xml'
let man = fs.readFileSync(manPath, 'utf8')
if (!man.includes('jp.konami.pesam')) {
  man = man.replace('<application', '<queries>\n        <package android:name="jp.konami.pesam" />\n    </queries>\n\n    <application')
}
if (!man.includes('default_notification_icon')) {
  man = man.replace(
    '</application>',
    `    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_arena" />\n` +
    `    <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/arena_icon_bg" />\n` +
    `</application>`
  )
}
fs.writeFileSync(manPath, man)

// Canal de notification par défaut (Android 8+) et icône de notification monochrome.
const notifDrawable = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"
    android:tint="#FFFFFF">
    <path android:fillColor="#FF000000"
        android:pathData="M12,2L2,21h20L12,2z M11,17h2v2h-2z M11,10h2v5h-2z" />
</vector>
`
fs.mkdirSync(path.join(res, 'drawable'), { recursive: true })
fs.writeFileSync(path.join(res, 'drawable/ic_stat_arena.xml'), notifDrawable)

// --- Bulle flottante (live, capture d'écran, chat) --------------------------
const overlayPkgDir = 'android/app/src/main/java/app/arena/overlay'
fs.mkdirSync(overlayPkgDir, { recursive: true })
for (const f of fs.readdirSync('android-native/overlay')) {
  fs.copyFileSync(path.join('android-native/overlay', f), path.join(overlayPkgDir, f))
}

// Permissions + déclaration du service dans le manifeste.
let man2 = fs.readFileSync(manPath, 'utf8')
if (!man2.includes('SYSTEM_ALERT_WINDOW')) {
  man2 = man2.replace(
    '<application',
    `<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />\n` +
    `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n` +
    `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />\n\n    <application`
  )
}
if (!man2.includes('app.arena.overlay.OverlayService')) {
  man2 = man2.replace(
    '</application>',
    `    <service android:name="app.arena.overlay.OverlayService" android:foregroundServiceType="mediaProjection" android:exported="false" />\n</application>`
  )
}
fs.writeFileSync(manPath, man2)

// Enregistrement manuel du plugin (ce n'est pas un module npm, donc la
// découverte automatique de Capacitor ne le voit pas) dans MainActivity.
const mainActivityPath = 'android/app/src/main/java/app/arena/gamehub/MainActivity.java'
let mainActivity = fs.readFileSync(mainActivityPath, 'utf8')
if (!mainActivity.includes('ArenaOverlayPlugin')) {
  mainActivity = mainActivity.replace(
    'import com.getcapacitor.BridgeActivity;',
    'import com.getcapacitor.BridgeActivity;\nimport app.arena.overlay.ArenaOverlayPlugin;'
  )
  const patched = mainActivity.replace(
    /public class MainActivity extends BridgeActivity \{[\s\S]*?\}\s*$/,
    `public class MainActivity extends BridgeActivity {\n` +
    `    @Override\n` +
    `    public void onCreate(android.os.Bundle savedInstanceState) {\n` +
    `        registerPlugin(ArenaOverlayPlugin.class);\n` +
    `        super.onCreate(savedInstanceState);\n` +
    `    }\n` +
    `}\n`
  )
  if (!patched.includes('registerPlugin(ArenaOverlayPlugin.class)')) {
    throw new Error("Impossible d'enregistrer ArenaOverlayPlugin : MainActivity.java généré par Capacitor a un format inattendu.")
  }
  fs.writeFileSync(mainActivityPath, patched)
}

console.log('Identité Arena appliquée, bulle flottante installée.')
