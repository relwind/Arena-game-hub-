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

const manPath = 'android/app/src/main/AndroidManifest.xml'
let man = fs.readFileSync(manPath, 'utf8')
if (!man.includes('jp.konami.pesam')) {
  man = man.replace('<application', '<queries>\n        <package android:name="jp.konami.pesam" />\n    </queries>\n\n    <application')
  fs.writeFileSync(manPath, man)
}

console.log('Identité Arena appliquée.')
