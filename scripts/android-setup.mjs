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

console.log('Identité Arena appliquée.')
