import React, { useRef, useState } from 'react'
import { sb } from './supabase'
import { useApp, ErrBox, errMsg } from './ui'

// Lit une image choisie, la recadre/réduit et la renvoie en JPEG léger.
export async function shrink(file: File, maxW: number, maxH: number, cover = false): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error('Choisis une image (JPG, PNG ou WebP).')
  const bmp = await createImageBitmap(file)
  let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0
  let dw = maxW, dh = maxH
  if (cover) {
    const r = maxW / maxH
    if (sw / sh > r) { const nw = sh * r; sx = (sw - nw) / 2; sw = nw } else { const nh = sw / r; sy = (sh - nh) / 2; sh = nh }
  } else {
    const k = Math.min(1, maxW / sw, maxH / sh); dw = Math.round(sw * k); dh = Math.round(sh * k)
  }
  const cv = document.createElement('canvas'); cv.width = dw; cv.height = dh
  cv.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh)
  return await new Promise<Blob>((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error('Image illisible.'))), 'image/jpeg', 0.82))
}

export async function uploadImage(bucket: string, uid: string, blob: Blob, name: string, upsert = false): Promise<string> {
  const path = `${uid}/${name}`
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert })
  if (error) throw new Error(/size|exceed/i.test(error.message) ? 'Image trop lourde.' : errMsg(error))
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl + (upsert ? '?v=' + Date.now() : '')
}

export const THEMES: [string, string, string, string][] = [
  ['Nuit bleue', '#0d1a4a', '#2F7BFF', '#35D0FF'],
  ['Or', '#3a2a05', '#F5B83D', '#ffe08a'],
  ['Pelouse', '#06311d', '#1c7a3f', '#7CFFB2'],
  ['Feu', '#3b0a12', '#ff4455', '#ffb199'],
  ['Violet', '#1d0f45', '#7c3aed', '#d946ef'],
  ['Noir', '#05070d', '#1E2E5A', '#8A98BF'],
]

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/), lines: string[] = []
  let cur = ''
  words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t })
  if (cur) lines.push(cur)
  return lines
}

export function drawPoster(cv: HTMLCanvasElement, o: { title: string; sub: string; theme: number; photo?: ImageBitmap | null }) {
  const W = 1200, H = 440
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  const [, c1, c2, c3] = THEMES[o.theme]
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, c1); g.addColorStop(1, c2)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  if (o.photo) {
    const r = W / H; let sw = o.photo.width, sh = o.photo.height, sx = 0, sy = 0
    if (sw / sh > r) { const nw = sh * r; sx = (sw - nw) / 2; sw = nw } else { const nh = sw / r; sy = (sh - nh) / 2; sh = nh }
    ctx.globalAlpha = .55; ctx.drawImage(o.photo, sx, sy, sw, sh, 0, 0, W, H); ctx.globalAlpha = 1
    const ov = ctx.createLinearGradient(0, 0, W, 0); ov.addColorStop(0, c1 + 'ee'); ov.addColorStop(1, c1 + '33'); ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H)
  }
  ctx.save(); ctx.globalAlpha = .12; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3
  for (let x = -H; x < W; x += 70) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke() }
  ctx.restore()
  const rg = ctx.createRadialGradient(W - 160, 100, 10, W - 160, 100, 320); rg.addColorStop(0, c3 + '99'); rg.addColorStop(1, c3 + '00'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  // trophée
  ctx.save(); ctx.translate(W - 250, 70); ctx.strokeStyle = c3; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = .9
  ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(160, 0); ctx.lineTo(160, 80); ctx.arc(100, 80, 60, 0, Math.PI); ctx.closePath(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(40, 25); ctx.lineTo(8, 25); ctx.lineTo(8, 55); ctx.arc(40, 55, 32, Math.PI, Math.PI / 2, true); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(160, 25); ctx.lineTo(192, 25); ctx.lineTo(192, 55); ctx.arc(160, 55, 32, 0, Math.PI / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(100, 140); ctx.lineTo(100, 200); ctx.moveTo(60, 215); ctx.lineTo(140, 215); ctx.stroke(); ctx.restore()
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.shadowColor = '#000a'; ctx.shadowBlur = 14
  let size = 96; const font = (s: number) => `700 ${s}px "Chakra Petch","Trebuchet MS",sans-serif`
  let lines: string[] = []
  for (; size >= 44; size -= 6) { ctx.font = font(size); lines = wrap(ctx, (o.title || 'Ma compétition').toUpperCase(), W - 520); if (lines.length <= 3) break }
  const ty = 190 - ((lines.length - 1) * size * 1.05) / 2
  lines.forEach((l, i) => ctx.fillText(l, 60, ty + i * size * 1.05))
  ctx.shadowBlur = 0; ctx.fillStyle = c3; ctx.font = font(40); ctx.fillText(o.sub || '', 60, 330)
  ctx.fillStyle = '#ffffffcc'; ctx.font = font(26); ctx.fillText('ARENA GAME HUB · eFootball', 60, 395)
}

export function CoverPicker({ value, onChange, title, sub }: { value: string; onChange: (url: string) => void; title: string; sub: string }) {
  const { me } = useApp()
  const [mode, setMode] = useState<'' | 'poster'>('')
  const [theme, setTheme] = useState(0)
  const [t, setT] = useState('')
  const [s, setS] = useState('')
  const [photo, setPhoto] = useState<ImageBitmap | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cv = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const bg = useRef<HTMLInputElement>(null)

  const redraw = (o: Partial<{ theme: number; t: string; s: string; photo: ImageBitmap | null }> = {}) => {
    if (cv.current) drawPoster(cv.current, { title: o.t ?? (t || title), sub: o.s ?? (s || sub), theme: o.theme ?? theme, photo: o.photo === undefined ? photo : o.photo })
  }
  const open = () => { setMode('poster'); setT(title); setS(sub); setTimeout(() => redraw({ t: title, s: sub }), 50) }

  const importPhoto = async (f?: File) => {
    if (!f) return
    setBusy(true); setErr('')
    try { const b = await shrink(f, 1280, 480, true); onChange(await uploadImage('comp-images', me.id, b, `${Date.now()}.jpg`)) } catch (e: any) { setErr(e.message || errMsg(e)) }
    setBusy(false)
  }
  const usePoster = async () => {
    if (!cv.current) return
    setBusy(true); setErr('')
    try {
      const b = await new Promise<Blob>((ok, ko) => cv.current!.toBlob((x) => (x ? ok(x) : ko(new Error('Erreur'))), 'image/jpeg', 0.85))
      onChange(await uploadImage('comp-images', me.id, b, `${Date.now()}.jpg`)); setMode('')
    } catch (e: any) { setErr(e.message || errMsg(e)) }
    setBusy(false)
  }
  return (
    <div className="stack">
      <div className="small muted">Image de la compétition (affiche ou bannière, facultative)</div>
      {value && <div style={{ height: 110, borderRadius: 14, border: '1px solid var(--line)', background: `center/cover url(${value})` }} />}
      <div className="row">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => file.current?.click()}>Importer une photo</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={open}>Créer une affiche</button>
      </div>
      {value && <button type="button" className="small" style={{ background: 'none', border: 0, color: 'var(--live)' }} onClick={() => onChange('')}>Retirer l'image</button>}
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { importPhoto(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={bg} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const b = await createImageBitmap(f); setPhoto(b); redraw({ photo: b }) } catch { setErr('Image illisible.') } }} />
      {mode === 'poster' && (
        <div className="card stack">
          <b>Créer une affiche</b>
          <canvas ref={cv} style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />
          <div className="chips">{THEMES.map((th, i) => <button type="button" key={th[0]} className={'chip' + (theme === i ? ' on' : '')} onClick={() => { setTheme(i); redraw({ theme: i }) }}>{th[0]}</button>)}</div>
          <input className="in" maxLength={50} placeholder="Titre" value={t} onChange={(e) => { setT(e.target.value); redraw({ t: e.target.value }) }} />
          <input className="in" maxLength={50} placeholder="Sous-titre (date, lot…)" value={s} onChange={(e) => { setS(e.target.value); redraw({ s: e.target.value }) }} />
          <div className="row"><button type="button" className="btn ghost" onClick={() => bg.current?.click()}>Ajouter une photo de fond</button>
            {photo && <button type="button" className="btn ghost" onClick={() => { setPhoto(null); redraw({ photo: null }) }}>Retirer le fond</button>}</div>
          <div className="row"><button type="button" className="btn ghost" onClick={() => setMode('')}>Fermer</button>
            <button type="button" className="btn" disabled={busy} onClick={usePoster}>{busy ? 'Envoi…' : 'Utiliser cette affiche'}</button></div>
        </div>
      )}
      <ErrBox text={err} />
    </div>
  )
}

export function AvatarPicker({ name, url, size = 84, onDone }: { name?: string; url?: string | null; size?: number; onDone?: () => void }) {
  const { me, toast, refreshMe } = useApp()
  const f = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const b = await shrink(file, 400, 400, true)
      const u = await uploadImage('avatars', me.id, b, 'avatar.jpg', true)
      const { error } = await sb.from('profiles').update({ avatar_url: u }).eq('id', me.id)
      if (error) throw new Error(errMsg(error))
      await refreshMe(); toast('Photo mise à jour'); onDone?.()
    } catch (e: any) { toast(e.message || errMsg(e)) }
    setBusy(false)
  }
  const h = Array.from(name || '?').reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <div style={{ textAlign: 'center' }}>
      <button type="button" onClick={() => f.current?.click()} disabled={busy} aria-label="Changer la photo" style={{ border: 0, padding: 0, background: 'none', position: 'relative' }}>
        <div className="tile" style={{ width: size, height: size, borderRadius: '50%', fontSize: size * 0.38, background: url ? `center/cover url(${url})` : `linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 40) % 360} 75% 45%))` }}>{url ? '' : (name || '?').slice(0, 1).toUpperCase()}</div>
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: '50%', background: 'var(--blue)', display: 'grid', placeItems: 'center', fontSize: 14, border: '2px solid var(--bg)' }}>{busy ? '…' : '✎'}</span>
      </button>
      <input ref={f} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

// Capture d'écran d'un score : stockée dans un espace privé (joueurs du match, organisateurs et admins seulement).
export async function uploadProof(matchId: string, uid: string, file: File): Promise<string> {
  const blob = await shrink(file, 1280, 1280, false)
  const path = `${matchId}/${uid}-${Date.now()}.jpg`
  const { error } = await sb.storage.from('proofs').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(/size|exceed/i.test(error.message) ? 'Image trop lourde.' : errMsg(error))
  return path
}

export function ProofLink({ path, label = 'Voir la capture' }: { path?: string | null; label?: string }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!path) return null
  const open = async () => {
    setBusy(true); setErr('')
    const { data, error } = await sb.storage.from('proofs').createSignedUrl(path, 600)
    setBusy(false)
    if (error || !data) return setErr('Capture introuvable.')
    setUrl(data.signedUrl)
  }
  return (
    <>
      <button type="button" className="chip" disabled={busy} onClick={open}>{busy ? '…' : label}</button>
      {err && <span className="small" style={{ color: 'var(--live)' }}>{err}</span>}
      {url && (
        <div onClick={() => setUrl('')} style={{ position: 'fixed', inset: 0, background: '#000e', zIndex: 90, display: 'grid', placeItems: 'center', padding: 12 }}>
          <img src={url} alt="Capture d'écran du score" style={{ maxWidth: '100%', maxHeight: '88vh', borderRadius: 10 }} />
          <div className="small" style={{ position: 'absolute', bottom: 24, color: '#fff' }}>Touche pour fermer</div>
        </div>
      )}
    </>
  )
}
