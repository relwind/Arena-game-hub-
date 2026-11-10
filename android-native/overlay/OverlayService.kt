package app.arena.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import app.arena.gamehub.R
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Service qui fait vivre la bulle flottante Arena par-dessus les autres applications
 * (notamment eFootball) : démarrage/arrêt du live, capture d'écran, et une petite
 * fenêtre de discussion. Tourne en foreground service pour ne pas être tué par le
 * système pendant que le joueur joue.
 *
 * NB : la diffusion vidéo réelle vers LiveKit n'est pas encore branchée ici (il faut
 * d'abord les identifiants LiveKit Cloud). Pour l'instant, "Démarrer le live" ouvre
 * déjà la capture d'écran (MediaProjection) et prévient le serveur Arena (start_live),
 * ce qui permet de tester toute la mécanique de la bulle. Le branchement vers LiveKit
 * (publication de la piste vidéo) viendra se greffer sur le VirtualDisplay déjà créé ici.
 */
class OverlayService : Service() {

    companion object {
        const val ACTION_START = "app.arena.overlay.START"
        const val ACTION_STOP = "app.arena.overlay.STOP"
        const val CHANNEL_ID = "arena_live_bubble"
        const val NOTIF_ID = 4210

        var pluginRef: ArenaOverlayPlugin? = null
        var pendingProjectionResultCode: Int? = null
        var pendingProjectionData: Intent? = null

        @Volatile var isRunning = false
        @Volatile var isLive = false
    }

    private lateinit var wm: WindowManager
    private val handler = Handler(Looper.getMainLooper())

    private var bubbleView: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var menuView: View? = null
    private var chatView: View? = null
    private var statusView: View? = null
    private var alertView: View? = null

    private var sessionId: String = ""
    private var matchId: String = ""
    private var roomId: String = ""
    private var mode: String = "match" // "match" (compétition) ou "room" (match amical)
    private var roomOpened = false // vrai une fois qu'on a déjà ouvert eFootball depuis la bulle (mode "room")
    private var supabaseUrl: String = ""
    private var supabaseKey: String = ""
    private var accessToken: String = ""
    private var userId: String = ""
    private var displayName: String = "Joueur"

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private var chatPoll: Runnable? = null
    private val nameCache = HashMap<String, String>()

    // État de la salle de match, avant que la partie ne soit lancée.
    private var hostId: String? = null
    private var roomCode: String? = null
    private var kickedAt: String? = null
    private var invitedAt: String? = null // host a signalé que la salle est prête (match ou room), même sans code envoyé
    private var matchPoll: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopEverything(); return START_NOT_STICKY }
            else -> {
                sessionId = intent?.getStringExtra("sessionId") ?: sessionId
                matchId = intent?.getStringExtra("matchId") ?: matchId
                roomId = intent?.getStringExtra("roomId") ?: roomId
                mode = intent?.getStringExtra("mode") ?: mode
                supabaseUrl = intent?.getStringExtra("supabaseUrl") ?: supabaseUrl
                supabaseKey = intent?.getStringExtra("supabaseKey") ?: supabaseKey
                accessToken = intent?.getStringExtra("accessToken") ?: accessToken
                userId = intent?.getStringExtra("userId") ?: userId
                displayName = intent?.getStringExtra("displayName") ?: displayName
                startForegroundNotif()
                if (!isRunning) {
                    wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
                    showBubble()
                    refreshMatchState()
                    startMatchPoll()
                }
                isRunning = true
            }
        }
        return START_STICKY
    }

    // ---------------------------------------------------------------- notification

    private fun startForegroundNotif() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Bulle Arena", NotificationManager.IMPORTANCE_LOW))
            }
        }
        val stopIntent = Intent(this, OverlayService::class.java).apply { action = ACTION_STOP }
        val stopPending = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE)
        val notif = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Arena Game Hub")
            .setContentText("La bulle Arena est active")
            .setSmallIcon(R.drawable.ic_stat_arena)
            .addAction(0, "Arrêter la bulle", stopPending)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun overlayType() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

    // ---------------------------------------------------------------- bulle

    private fun showBubble() {
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_bubble, null)
        bubbleView = view
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val dm = DisplayMetrics(); wm.defaultDisplay.getMetrics(dm)
        params.x = dm.widthPixels - 180
        params.y = dm.heightPixels / 3
        bubbleParams = params

        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var dragged = false
        view.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX; downY = ev.rawY; startX = params.x; startY = params.y; dragged = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downX).toInt(); val dy = (ev.rawY - downY).toInt()
                    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) dragged = true
                    params.x = startX + dx; params.y = startY + dy
                    try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) onBubbleTap()
                    true
                }
                else -> false
            }
        }
        wm.addView(view, params)
    }

    private fun toggleMenu() {
        if (menuView != null) { removeView(menuView); menuView = null; return }
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_menu, null)
        menuView = view

        val liveIcon = view.findViewById<TextView>(R.id.arenaBtnLiveIcon)
        val liveLabel = view.findViewById<TextView>(R.id.arenaBtnLiveLabel)
        updateLiveMenuLabel(liveIcon, liveLabel)

        view.findViewById<View>(R.id.arenaBtnLive).setOnClickListener {
            removeView(menuView); menuView = null
            if (isLive) stopLive() else startLive()
        }
        view.findViewById<View>(R.id.arenaBtnShot).setOnClickListener {
            removeView(menuView); menuView = null
            takeScreenshot()
        }
        view.findViewById<View>(R.id.arenaBtnChat).setOnClickListener {
            removeView(menuView); menuView = null
            toggleChat()
        }
        val organizerBtn = view.findViewById<View>(R.id.arenaBtnOrganizer)
        if (mode == "room") {
            organizerBtn.visibility = View.GONE // pas d'organisateur en match amical
        } else {
            organizerBtn.setOnClickListener {
                removeView(menuView); menuView = null
                toggleAlert()
            }
        }
        view.findViewById<View>(R.id.arenaBtnEnd).setOnClickListener {
            removeView(menuView); menuView = null
            endAndReturnToArena()
        }
        view.findViewById<View>(R.id.arenaBtnMenuClose).setOnClickListener {
            removeView(menuView); menuView = null
        }
        view.findViewById<View>(R.id.arenaBtnClose).setOnClickListener {
            removeView(menuView); menuView = null
            stopEverything()
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val bp = bubbleParams
        params.x = ((bp?.x ?: 0) - 190).coerceAtLeast(10)
        params.y = bp?.y ?: 200
        wm.addView(view, params)
    }

    private fun updateLiveMenuLabel(icon: TextView, label: TextView) {
        if (isLive) { icon.text = "⏹"; label.text = "Arrêter le live" } else { icon.text = "▶"; label.text = "Démarrer le live" }
    }

    private fun removeView(v: View?) {
        if (v == null) return
        try { wm.removeView(v) } catch (_: Exception) {}
    }

    // ---------------------------------------------------------------- contacter l'organisateur (compétition uniquement)

    private fun toggleAlert() {
        if (alertView != null) { removeView(alertView); alertView = null; return }
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_alert, null)
        alertView = view

        view.findViewById<View>(R.id.arenaAlertClose).setOnClickListener { removeView(alertView); alertView = null }
        view.findViewById<View>(R.id.arenaAlertSend).setOnClickListener {
            val input = view.findViewById<EditText>(R.id.arenaAlertInput)
            val text = input.text.toString().trim()
            if (text.isEmpty()) { toast("Écris un message."); return@setOnClickListener }
            if (matchId.isEmpty()) { toast("Aucun match associé."); return@setOnClickListener }
            BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "alert_organizer", JSONObject().put("_match", matchId).put("_body", text)) { res ->
                handler.post {
                    if (res == null) toast("Message non envoyé, réessaie.")
                    else { toast("Organisateur prévenu."); removeView(alertView); alertView = null }
                }
            }
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(), 0, PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val bp = bubbleParams
        params.x = ((bp?.x ?: 0) - 270).coerceAtLeast(10)
        params.y = bp?.y ?: 200
        wm.addView(view, params)
    }

    /** Avant le lancement de la partie : écran d'état (hôte / attente / code). Après : menu habituel. */
    private fun onBubbleTap() {
        val gameStarted = if (mode == "room") roomOpened else kickedAt != null
        if (gameStarted) toggleMenu() else toggleStatus()
    }

    // ---------------------------------------------------------------- salle de match / salle amicale (avant la partie)

    private fun startMatchPoll() {
        if (matchId.isEmpty() && roomId.isEmpty()) return
        val r = object : Runnable {
            override fun run() {
                refreshMatchState()
                val gameStarted = if (mode == "room") roomOpened else kickedAt != null
                if (!gameStarted) handler.postDelayed(this, 5000)
            }
        }
        matchPoll = r
        handler.postDelayed(r, 5000)
    }

    private fun stopMatchPoll() { matchPoll?.let { handler.removeCallbacks(it) }; matchPoll = null }

    private fun refreshMatchState() {
        if (mode == "room") {
            if (roomId.isEmpty()) return
            BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "rooms?id=eq.$roomId&select=efootball_code,host_id,host_invited_at") { rows ->
                val row = rows?.optJSONObject(0)
                roomCode = row?.optString("efootball_code")?.takeIf { it.isNotEmpty() && it != "null" }
                hostId = row?.optString("host_id")?.takeIf { it.isNotEmpty() && it != "null" }
                invitedAt = row?.optString("host_invited_at")?.takeIf { it.isNotEmpty() && it != "null" }
                handler.post { statusView?.let { renderStatus(it) } }
            }
            return
        }
        if (matchId.isEmpty()) return
        BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "matches?id=eq.$matchId&select=host_id,kicked_at,invited_at") { rows ->
            val row = rows?.optJSONObject(0)
            hostId = row?.optString("host_id")?.takeIf { it.isNotEmpty() && it != "null" }
            kickedAt = row?.optString("kicked_at")?.takeIf { it.isNotEmpty() && it != "null" }
            invitedAt = row?.optString("invited_at")?.takeIf { it.isNotEmpty() && it != "null" }
            BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "match_room?match_id=eq.$matchId&select=room_code") { rows2 ->
                roomCode = rows2?.optJSONObject(0)?.optString("room_code")?.takeIf { it.isNotEmpty() }
                handler.post { statusView?.let { renderStatus(it) } }
            }
        }
    }

    private fun toggleStatus() {
        if (statusView != null) { removeView(statusView); statusView = null; return }
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_status, null)
        statusView = view

        view.findViewById<View>(R.id.arenaStatusClose).setOnClickListener { removeView(statusView); statusView = null }

        view.findViewById<View>(R.id.arenaStatusPrimary).setOnClickListener {
            val input = view.findViewById<EditText>(R.id.arenaStatusInput)
            val code = input.text.toString().trim()
            if (code.isEmpty()) { toast("Entre le code de la salle."); return@setOnClickListener }
            if (mode == "room") {
                BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "post_room_efootball_code", JSONObject().put("_room", roomId).put("_code", code)) {
                    refreshMatchState()
                }
            } else {
                BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "post_room_code", JSONObject().put("_match", matchId).put("_code", code)) {
                    refreshMatchState()
                }
            }
        }
        // « Ouvrir eFootball » : accessible dès que l'hôte a sa salle prête (code ou simple invitation),
        // et pour l'adversaire dès qu'il est invité ou que le code est arrivé.
        view.findViewById<View>(R.id.arenaStatusOpenGame).setOnClickListener {
            val isHost = hostId == userId
            if (mode == "room") {
                if (isHost) {
                    BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "invite_to_room_friendly", JSONObject().put("_room", roomId)) { refreshMatchState() }
                }
                roomOpened = true
                openEfootball()
                removeView(statusView); statusView = null
                return@setOnClickListener
            }
            if (isHost && invitedAt == null) {
                BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "invite_to_room", JSONObject().put("_match", matchId)) { refreshMatchState() }
            }
            if (roomCode != null && kickedAt == null) {
                BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "mark_kicked", JSONObject().put("_match", matchId)) {
                    kickedAt = kickedAt ?: java.util.Date().toString()
                    refreshMatchState()
                }
            }
            openEfootball()
            removeView(statusView); statusView = null
        }
        view.findViewById<View>(R.id.arenaStatusSecondary).setOnClickListener {
            val code = roomCode
            if (code != null) {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Code Arena", code))
                toast("Code copié")
            }
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val bp = bubbleParams
        params.x = ((bp?.x ?: 0) - 270).coerceAtLeast(10)
        params.y = bp?.y ?: 200
        wm.addView(view, params)
        renderStatus(view)
    }

    private fun renderStatus(view: View) {
        val title = view.findViewById<TextView>(R.id.arenaStatusTitle)
        val body = view.findViewById<TextView>(R.id.arenaStatusBody)
        val input = view.findViewById<EditText>(R.id.arenaStatusInput)
        val secondary = view.findViewById<TextView>(R.id.arenaStatusSecondary)
        val primary = view.findViewById<TextView>(R.id.arenaStatusPrimary)
        val openGame = view.findViewById<TextView>(R.id.arenaStatusOpenGame)
        input.visibility = View.GONE; secondary.visibility = View.GONE; primary.visibility = View.GONE; openGame.visibility = View.GONE
        val isHost = hostId != null && hostId == userId

        if (mode == "room") {
            if (roomCode == null && isHost) {
                title.text = "Tu es l'hôte"
                body.text = "Crée la salle dans eFootball (ou ouvre-la directement d'ici), puis colle ici le code pour ton adversaire.\n\nNote : pense à lui transmettre le code dans le chat de la bulle."
                input.visibility = View.VISIBLE
                primary.text = "Envoyer le code"
                primary.visibility = View.VISIBLE
                openGame.visibility = View.VISIBLE
            } else if (roomCode == null && invitedAt != null) {
                title.text = "Salle prête"
                body.text = "Ton coéquipier a créé la salle, tu peux ouvrir eFootball. Le code arrivera ici dès qu'il sera envoyé."
                openGame.visibility = View.VISIBLE
            } else if (roomCode == null) {
                title.text = "En attente"
                body.text = "Ton coéquipier crée la salle dans eFootball. Patiente, le code apparaîtra ici."
            } else {
                title.text = "Code reçu"
                body.text = "Code de la salle : $roomCode"
                secondary.visibility = View.VISIBLE
                openGame.visibility = View.VISIBLE
            }
            return
        }

        when {
            kickedAt != null -> {
                title.text = "Partie en cours"
                body.text = "La partie a déjà été lancée. Ferme cet écran pour accéder au live et à la capture d'écran."
            }
            hostId == null -> {
                title.text = "En attente"
                body.text = "En attente de la désignation de l'hôte par Arena…"
            }
            isHost && roomCode == null -> {
                title.text = "Tu es l'hôte"
                body.text = "Crée la salle dans eFootball (ou ouvre-la directement d'ici), puis colle ici le code pour ton adversaire.\n\nNote : pense à lui transmettre le code dans le chat de la bulle. Active le live si tu veux — la capture d'écran sera obligatoire à la fin du match."
                input.visibility = View.VISIBLE
                primary.text = "Envoyer le code"
                primary.visibility = View.VISIBLE
                openGame.visibility = View.VISIBLE
            }
            isHost && roomCode != null -> {
                title.text = "Salle créée"
                body.text = "Code envoyé à ton adversaire : $roomCode"
                secondary.visibility = View.VISIBLE
                openGame.visibility = View.VISIBLE
            }
            !isHost && roomCode == null && invitedAt != null -> {
                title.text = "Salle prête"
                body.text = "Ton adversaire a créé la salle, tu peux ouvrir eFootball. Le code arrivera ici dès qu'il sera envoyé."
                openGame.visibility = View.VISIBLE
            }
            !isHost && roomCode == null -> {
                title.text = "En attente du code"
                body.text = "Ton adversaire crée la salle dans eFootball. Patiente, le code apparaîtra ici."
            }
            else -> {
                title.text = "Code reçu"
                body.text = "Code de la salle : $roomCode"
                secondary.visibility = View.VISIBLE
                openGame.visibility = View.VISIBLE
            }
        }
    }

    private fun openEfootball() {
        try {
            val pm = packageManager
            val launch = pm.getLaunchIntentForPackage("jp.konami.pesam")
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launch)
            } else {
                toast("eFootball n'est pas installé sur ce téléphone.")
            }
        } catch (e: Exception) {
            toast("Impossible d'ouvrir eFootball.")
        }
    }

    /** Bouton « Terminer » : arrête le live, ramène Arena au premier plan directement sur la saisie du score, puis ferme la bulle. */
    private fun endAndReturnToArena() {
        if (isLive) stopLive()
        try {
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                startActivity(launch)
            }
        } catch (e: Exception) {
            toast("Impossible de revenir sur Arena.")
        }
        pluginRef?.emit(
            "endRequested",
            JSObject().put("matchId", matchId).put("roomId", roomId).put("mode", mode)
        )
        stopEverything()
    }

    // ---------------------------------------------------------------- live (capture d'écran + signal serveur)

    private fun startLive() {
        val resultCode = pendingProjectionResultCode
        val data = pendingProjectionData
        if (resultCode == null || data == null) {
            toast("Autorisation de capture d'écran manquante. Rouvrez Arena pour l'accorder.")
            return
        }
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        try {
            val projection = mgr.getMediaProjection(resultCode, data)
            mediaProjection = projection
            // Obligatoire depuis Android 14 : un callback doit être enregistré avant toute
            // utilisation de la projection (sinon exception à la création du VirtualDisplay).
            projection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { if (isLive) stopLive() }
            }, handler)
            val dm = DisplayMetrics(); wm.defaultDisplay.getMetrics(dm)
            val reader = ImageReader.newInstance(dm.widthPixels, dm.heightPixels, PixelFormat.RGBA_8888, 2)
            imageReader = reader
            virtualDisplay = projection.createVirtualDisplay(
                "ArenaLive", dm.widthPixels, dm.heightPixels, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, handler
            )
            isLive = true
            bubbleView?.findViewById<TextView>(R.id.arenaBubbleFace)?.setBackgroundResource(R.drawable.arena_bubble_bg_live)
            toast("Live démarré")
            val fn = if (mode == "room") "start_room_live" else "start_live"
            val arg = if (mode == "room") "_room" to roomId else "_match" to matchId
            BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, fn, JSONObject().put(arg.first, arg.second)) { text ->
                val newId = text?.trim()?.trim('"')
                if (newId.isNullOrEmpty()) {
                    handler.post { toast("Le live a démarré localement, mais le serveur n'a pas confirmé.") }
                } else {
                    sessionId = newId
                }
            }
            pluginRef?.emit("liveStateChanged", JSObject().put("live", true))
        } catch (e: Exception) {
            toast("Impossible de démarrer le live : ${e.message}")
        }
    }

    private fun stopLive() {
        isLive = false
        try { virtualDisplay?.release() } catch (_: Exception) {}
        try { mediaProjection?.stop() } catch (_: Exception) {}
        try { imageReader?.close() } catch (_: Exception) {}
        virtualDisplay = null; mediaProjection = null; imageReader = null
        bubbleView?.findViewById<TextView>(R.id.arenaBubbleFace)?.setBackgroundResource(R.drawable.arena_bubble_bg)
        toast("Live arrêté")
        val stopFn = if (mode == "room") "stop_room_live" else "stop_live"
        val stopArg = if (mode == "room") "_room" to roomId else "_match" to matchId
        BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, stopFn, JSONObject().put(stopArg.first, stopArg.second))
        pluginRef?.emit("liveStateChanged", JSObject().put("live", false))
    }

    // ---------------------------------------------------------------- capture d'écran

    private fun takeScreenshot() {
        val reader = imageReader
        if (reader == null) {
            toast("Démarrez le live pour pouvoir capturer l'écran.")
            return
        }
        try {
            val image = reader.acquireLatestImage()
            if (image == null) { toast("Capture indisponible pour l'instant, réessayez."); return }
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * image.width
            val bitmap = Bitmap.createBitmap(image.width + rowPadding / pixelStride, image.height, Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(buffer)
            image.close()

            val dir = File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Arena")
            if (!dir.exists()) dir.mkdirs()
            val name = "arena_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE).format(Date()) + ".png"
            val file = File(dir, name)
            FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 95, it) }
            bitmap.recycle()

            toast("Capture enregistrée dans Images/Arena")
            pluginRef?.emit("screenshotTaken", JSObject().put("path", file.absolutePath))
        } catch (e: Exception) {
            toast("Capture impossible : ${e.message}")
        }
    }

    // ---------------------------------------------------------------- chat

    private fun toggleChat() {
        if (chatView != null) { stopChatPoll(); removeView(chatView); chatView = null; return }
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_chat, null)
        chatView = view

        view.findViewById<View>(R.id.arenaChatClose).setOnClickListener {
            stopChatPoll(); removeView(chatView); chatView = null
        }
        val input = view.findViewById<EditText>(R.id.arenaChatInput)
        val send = {
            val text = input.text.toString().trim()
            if (text.isNotEmpty()) {
                input.setText("")
                val table = if (mode == "room") "room_messages" else "match_messages"
                val idField = if (mode == "room") "room_id" else "match_id"
                val idValue = if (mode == "room") roomId else matchId
                val body = JSONObject().put(idField, idValue).put("user_id", userId).put("body", text)
                BubbleHttp.insertRow(supabaseUrl, supabaseKey, accessToken, table, body) { ok ->
                    if (!ok) handler.post { toast("Message non envoyé, réessaie.") }
                    loadChat(view, force = true)
                }
            }
        }
        view.findViewById<View>(R.id.arenaChatSend).setOnClickListener { send() }

        // en-tête draggable pour déplacer la fenêtre de discussion
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(), 0, PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val dm = DisplayMetrics(); wm.defaultDisplay.getMetrics(dm)
        params.x = (dm.widthPixels - 320).coerceAtLeast(10)
        params.y = dm.heightPixels / 4
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        view.findViewById<View>(R.id.arenaChatHeader).setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> { downX = ev.rawX; downY = ev.rawY; startX = params.x; startY = params.y; true }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (ev.rawX - downX).toInt(); params.y = startY + (ev.rawY - downY).toInt()
                    try { wm.updateViewLayout(view, params) } catch (_: Exception) {}
                    true
                }
                else -> false
            }
        }
        wm.addView(view, params)
        loadChat(view, force = true)
        startChatPoll(view)
    }

    private fun startChatPoll(view: View) {
        val r = object : Runnable { override fun run() { loadChat(view, force = false); handler.postDelayed(this, 4000) } }
        chatPoll = r
        handler.postDelayed(r, 4000)
    }

    private fun stopChatPoll() { chatPoll?.let { handler.removeCallbacks(it) }; chatPoll = null }

    private fun loadChat(view: View, force: Boolean) {
        val table = if (mode == "room") "room_messages" else "match_messages"
        val idField = if (mode == "room") "room_id" else "match_id"
        val idValue = if (mode == "room") roomId else matchId
        if (idValue.isEmpty()) return
        val query = "$table?$idField=eq.$idValue&select=user_id,body,created_at&order=created_at.asc&limit=50"
        BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, query) { rows ->
            if (rows == null) return@selectRows
            resolveNames(rows) {
                handler.post {
                    val list = view.findViewById<LinearLayout>(R.id.arenaChatList)
                    val scroll = view.findViewById<ScrollView>(R.id.arenaChatScroll)
                    list.removeAllViews()
                    for (i in 0 until rows.length()) {
                        val o = rows.getJSONObject(i)
                        val uid = o.optString("user_id", "")
                        val who = if (uid == userId) "Toi" else (nameCache[uid] ?: "Joueur")
                        val tv = TextView(this)
                        tv.setTextColor(0xFFE8EEFF.toInt())
                        tv.textSize = 12.5f
                        tv.setPadding(0, 4, 0, 4)
                        tv.text = "$who : ${o.optString("body", "")}"
                        list.addView(tv)
                    }
                    scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
                }
            }
        }
    }

    /** Résout les pseudos des auteurs non encore en cache (une seule requête groupée). */
    private fun resolveNames(rows: org.json.JSONArray, onDone: () -> Unit) {
        val missing = LinkedHashSet<String>()
        for (i in 0 until rows.length()) {
            val uid = rows.getJSONObject(i).optString("user_id", "")
            if (uid.isNotEmpty() && uid != userId && !nameCache.containsKey(uid)) missing.add(uid)
        }
        if (missing.isEmpty()) { onDone(); return }
        val ids = missing.joinToString(",")
        val query = "profiles?id=in.($ids)&select=id,username"
        BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, query) { rows2 ->
            if (rows2 != null) {
                for (i in 0 until rows2.length()) {
                    val o = rows2.getJSONObject(i)
                    nameCache[o.optString("id", "")] = o.optString("username", "Joueur")
                }
            }
            onDone()
        }
    }

    // ---------------------------------------------------------------- nettoyage

    private fun toast(msg: String) { handler.post { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() } }

    private fun stopEverything() {
        if (isLive) stopLive()
        stopChatPoll()
        stopMatchPoll()
        removeView(chatView); chatView = null
        removeView(menuView); menuView = null
        removeView(statusView); statusView = null
        removeView(alertView); alertView = null
        removeView(bubbleView); bubbleView = null
        isRunning = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        stopEverything()
        super.onDestroy()
    }
}
