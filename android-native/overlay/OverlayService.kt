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
import android.graphics.PixelFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
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
import io.livekit.android.LiveKit
import io.livekit.android.audio.ScreenAudioCapturer
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Date

/**
 * Service qui fait vivre la bulle flottante Arena par-dessus les autres applications
 * (notamment eFootball) : démarrage/arrêt du live (diffusion vidéo réelle vers LiveKit
 * Cloud, avec son du jeu en option), et une petite fenêtre de discussion. Tourne en
 * foreground service pour ne pas être tué par le système pendant que le joueur joue.
 *
 * NB : un seul jeton de MediaProjection ne peut démarrer qu'une seule capture d'écran
 * (depuis Android 14). C'est LiveKit (dans connectLiveKit) qui la démarre pour publier
 * la vidéo ; rien d'autre ici ne doit créer de second VirtualDisplay sur ce jeton.
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
        // Un jeton de MediaProjection ne peut démarrer qu'UNE SEULE capture, pour toute sa
        // durée de vie (pas seulement "une à la fois") : même arrêté puis relancé, un live qui
        // réutilise le même jeton échoue avec "Cannot start already started MediaProjection".
        // On le suit nous-mêmes car Android n'expose aucun moyen de l'interroger à l'avance.
        @Volatile var projectionTokenUsed = false

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
    private var audioAllowed: Boolean = false // micro autorisé par le joueur : on tente aussi le son du jeu en live

    private var mediaProjection: MediaProjection? = null

    // Diffusion vidéo réelle vers LiveKit Cloud.
    private var liveKitRoom: Room? = null
    private val liveKitScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var screenAudioCapturer: ScreenAudioCapturer? = null
    private var micAudioTrack: LocalAudioTrack? = null

    private var chatPoll: Runnable? = null
    private val nameCache = HashMap<String, String>()

    // État de la salle de match, avant que la partie ne soit lancée.
    private var hostId: String? = null
    private var roomCode: String? = null
    private var kickedAt: String? = null
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
                audioAllowed = intent?.getBooleanExtra("audioAllowed", audioAllowed) ?: audioAllowed
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
            // Déclaré dès le départ même si le son du live n'est pas encore activé à cet instant :
            // un foreground service ne peut pas ajouter un type après coup.
            startForeground(
                NOTIF_ID, notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
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
        closeOtherPanels(keep = "menu")
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_menu, null)
        menuView = view

        val liveBtn = view.findViewById<View>(R.id.arenaBtnLive)
        val liveIcon = view.findViewById<TextView>(R.id.arenaBtnLiveIcon)
        val liveLabel = view.findViewById<TextView>(R.id.arenaBtnLiveLabel)
        updateLiveMenuLabel(liveBtn, liveIcon, liveLabel)

        liveBtn.setOnClickListener {
            if (!isLive && !liveAllowed()) { toast(liveBlockedReason()); return@setOnClickListener }
            removeView(menuView); menuView = null
            if (isLive) stopLive() else startLive()
        }
        // Retiré : capturait l'écran via une deuxième VirtualDisplay sur le même jeton de
        // MediaProjection que le live, ce qu'Android 14+ interdit ("Cannot start already
        // started MediaProjection") — faisait planter la diffusion vidéo à chaque fois.
        view.findViewById<View>(R.id.arenaBtnShot).visibility = View.GONE
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

    /** Conditions de démarrage du live : session Arena valide, jeton de capture pas déjà
     *  consommé, et salle active en compétition. */
    private fun liveAllowed(): Boolean {
        if (accessToken.isEmpty() || userId.isEmpty()) return false
        if (pendingProjectionResultCode == null || pendingProjectionData == null || projectionTokenUsed) return false
        if (mode == "match" && roomCode == null) return false
        return true
    }

    private fun liveBlockedReason(): String = when {
        accessToken.isEmpty() || userId.isEmpty() -> "Session Arena perdue. Rouvre l'application pour relancer le live."
        pendingProjectionResultCode == null || pendingProjectionData == null || projectionTokenUsed ->
            "Autorisation de capture d'écran épuisée (déjà utilisée). Reviens sur Arena pour relancer le live."
        else -> "La salle n'est pas encore active : attends que le code de la salle soit envoyé."
    }

    private fun updateLiveMenuLabel(btn: View, icon: TextView, label: TextView) {
        when {
            isLive -> { icon.text = "⏹"; label.text = "Arrêter le live"; btn.alpha = 1f }
            liveAllowed() -> { icon.text = "▶"; label.text = "Démarrer le live"; btn.alpha = 1f }
            else -> { icon.text = "▶"; label.text = "Live indisponible pour l'instant"; btn.alpha = 0.4f }
        }
    }

    private fun removeView(v: View?) {
        if (v == null) return
        try { wm.removeView(v) } catch (_: Exception) {}
    }

    /** Ferme toute fenêtre de la bulle autre que celle qu'on est en train d'ouvrir : sans ça,
     *  un changement d'état du match pendant qu'une fenêtre est ouverte (ex. la partie démarre
     *  pendant que l'écran de salle est affiché) pouvait faire apparaître la fenêtre suivante
     *  PAR-DESSUS l'ancienne au lieu de la remplacer — plusieurs popups empilées à l'écran. */
    private fun closeOtherPanels(keep: String) {
        if (keep != "menu" && menuView != null) { removeView(menuView); menuView = null }
        if (keep != "status" && statusView != null) { removeView(statusView); statusView = null }
        if (keep != "alert" && alertView != null) { removeView(alertView); alertView = null }
        if (keep != "chat" && chatView != null) { stopChatPoll(); removeView(chatView); chatView = null }
    }

    // ---------------------------------------------------------------- contacter l'organisateur (compétition uniquement)

    private fun toggleAlert() {
        if (alertView != null) { removeView(alertView); alertView = null; return }
        closeOtherPanels(keep = "alert")
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

    // Empêche de relancer renderStatus() (et donc de perturber la saisie en cours du code) à
    // chaque sondage de 5s tant que rien n'a réellement changé côté serveur.
    private var lastStatusSig: String? = null

    private fun refreshMatchState() {
        if (mode == "room") {
            if (roomId.isEmpty()) return
            BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "rooms?id=eq.$roomId&select=efootball_code,host_id") { rows ->
                val row = rows?.optJSONObject(0)
                roomCode = row?.optString("efootball_code")?.takeIf { it.isNotEmpty() && it != "null" }
                hostId = row?.optString("host_id")?.takeIf { it.isNotEmpty() && it != "null" }
                handler.post { renderStatusIfChanged() }
            }
            return
        }
        if (matchId.isEmpty()) return
        BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "matches?id=eq.$matchId&select=host_id,kicked_at") { rows ->
            val row = rows?.optJSONObject(0)
            val wasKicked = kickedAt != null
            hostId = row?.optString("host_id")?.takeIf { it.isNotEmpty() && it != "null" }
            kickedAt = row?.optString("kicked_at")?.takeIf { it.isNotEmpty() && it != "null" }
            BubbleHttp.selectRows(supabaseUrl, supabaseKey, accessToken, "match_room?match_id=eq.$matchId&select=room_code") { rows2 ->
                roomCode = rows2?.optJSONObject(0)?.optString("room_code")?.takeIf { it.isNotEmpty() }
                handler.post {
                    // La partie vient de démarrer pendant que l'écran de salle était ouvert :
                    // il devient obsolète (c'est le menu, pas cet écran, qu'il faut maintenant
                    // utiliser) — on le referme au lieu de laisser le prochain tap en ouvrir
                    // un second par-dessus.
                    if (!wasKicked && kickedAt != null && statusView != null) {
                        removeView(statusView); statusView = null
                    } else {
                        renderStatusIfChanged()
                    }
                }
            }
        }
    }

    private fun renderStatusIfChanged() {
        val sv = statusView ?: return
        val sig = "$hostId|$roomCode|$kickedAt|$isLive"
        if (sig == lastStatusSig) return
        lastStatusSig = sig
        renderStatus(sv)
    }

    private fun toggleStatus() {
        if (statusView != null) { removeView(statusView); statusView = null; return }
        closeOtherPanels(keep = "status")
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.arena_status, null)
        statusView = view

        view.findViewById<View>(R.id.arenaStatusClose).setOnClickListener { removeView(statusView); statusView = null }

        // « Ouvrir eFootball » : ouvre TOUJOURS le jeu pour celui qui clique, sans aucun autre effet.
        // Chez l'hôte, ça lui sert juste à aller créer la salle. Chez l'adversaire, ce bouton n'est
        // affiché que dès que le code de la salle est arrivé (voir renderStatus) : plus besoin d'une
        // action séparée de l'hôte pour « faire venir » l'adversaire, envoyer le code suffit.
        view.findViewById<View>(R.id.arenaStatusOpenGame).setOnClickListener {
            val isHost = hostId == userId
            if (!isHost && mode == "match" && kickedAt == null) {
                BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, "mark_kicked", JSONObject().put("_match", matchId)) {
                    kickedAt = kickedAt ?: java.util.Date().toString()
                    refreshMatchState()
                }
            }
            if (mode == "room") roomOpened = true
            openEfootball()
            removeView(statusView); statusView = null
        }
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
        view.findViewById<View>(R.id.arenaStatusSecondary).setOnClickListener {
            val code = roomCode
            if (code != null) {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Code Arena", code))
                toast("Code copié")
            }
        }

        // Pas de FLAG_NOT_FOCUSABLE ici (contrairement à la bulle et au menu) : cet écran contient
        // un champ de saisie (le code de la salle), et une fenêtre non focusable empêche le clavier
        // de s'ouvrir dessus. Même choix que la fenêtre « Contacter l'organisateur » juste au-dessus.
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(), 0, PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val bp = bubbleParams
        params.x = ((bp?.x ?: 0) - 270).coerceAtLeast(10)
        params.y = bp?.y ?: 200
        wm.addView(view, params)
        lastStatusSig = "$hostId|$roomCode|$kickedAt|$isLive"
        renderStatus(view)
    }

    private fun renderStatus(view: View) {
        val title = view.findViewById<TextView>(R.id.arenaStatusTitle)
        val body = view.findViewById<TextView>(R.id.arenaStatusBody)
        val input = view.findViewById<EditText>(R.id.arenaStatusInput)
        val secondary = view.findViewById<TextView>(R.id.arenaStatusSecondary)
        val primary = view.findViewById<TextView>(R.id.arenaStatusPrimary)
        val openGame = view.findViewById<TextView>(R.id.arenaStatusOpenGame)
        val notify = view.findViewById<TextView>(R.id.arenaStatusNotify)
        input.visibility = View.GONE; secondary.visibility = View.GONE; primary.visibility = View.GONE
        openGame.visibility = View.GONE; notify.visibility = View.GONE
        val isHost = hostId != null && hostId == userId

        if (mode == "room") {
            if (isHost) {
                title.text = "Tu es l'hôte"
                body.text = (if (roomCode != null) "Code envoyé : $roomCode\n\n" else "") +
                    "Ouvre eFootball pour créer la salle, puis envoie le code ci-dessous : ton coéquipier pourra ouvrir eFootball dès qu'il l'aura reçu."
                openGame.visibility = View.VISIBLE
                input.visibility = View.VISIBLE
                primary.visibility = View.VISIBLE
                if (roomCode != null) secondary.visibility = View.VISIBLE
            } else if (roomCode != null) {
                title.text = "Tu peux y aller"
                body.text = "Code de la salle : $roomCode"
                openGame.visibility = View.VISIBLE
                secondary.visibility = View.VISIBLE
            } else {
                title.text = "En attente"
                body.text = "Ton coéquipier prépare la salle dans eFootball. Tu pourras ouvrir eFootball dès qu'il t'enverra le code."
            }
            return
        }

        when {
            kickedAt != null -> {
                title.text = "Partie en cours"
                body.text = (if (isLive) "🔴 Live en cours.\n\n" else "") +
                    "La partie a été lancée. Ferme cet écran pour accéder au menu (live, capture d'écran, chat).\n\nLa capture d'écran du score final sera obligatoire pour valider le match."
            }
            hostId == null -> {
                title.text = "En attente"
                body.text = "En attente de la désignation de l'hôte par Arena…"
            }
            isHost -> {
                title.text = "Tu es l'hôte"
                body.text = (if (roomCode != null) "Code envoyé : $roomCode\n\n" else "") +
                    "Ouvre eFootball pour créer la salle, puis envoie le code ci-dessous : ton adversaire pourra ouvrir eFootball dès qu'il l'aura reçu.\n\nActive le live si tu veux — la capture d'écran sera obligatoire à la fin du match."
                openGame.visibility = View.VISIBLE
                input.visibility = View.VISIBLE
                primary.visibility = View.VISIBLE
                if (roomCode != null) secondary.visibility = View.VISIBLE
            }
            roomCode != null -> {
                title.text = "Tu peux y aller"
                body.text = "Code de la salle : $roomCode"
                openGame.visibility = View.VISIBLE
                secondary.visibility = View.VISIBLE
            }
            else -> {
                title.text = "En attente"
                body.text = "Ton adversaire prépare la salle dans eFootball. Tu pourras ouvrir eFootball dès qu'il t'enverra le code."
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
        // Session morte (processus Arena tué puis service relancé seul par START_STICKY) ou
        // salle de compétition pas encore active (code non envoyé) : voir liveAllowed().
        if (!liveAllowed()) { toast(liveBlockedReason()); return }
        val resultCode = pendingProjectionResultCode
        val data = pendingProjectionData
        if (resultCode == null || data == null) {
            toast("Autorisation de capture d'écran manquante. Rouvrez Arena pour l'accorder.")
            return
        }
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        try {
            // Un jeton de MediaProjection est à usage unique pour toute sa durée de vie : on le
            // marque consommé ICI, avant même de savoir si la capture réussit, car Android ne
            // permet de toute façon plus aucune nouvelle tentative avec ce même jeton ensuite.
            projectionTokenUsed = true
            val projection = mgr.getMediaProjection(resultCode, data)
            mediaProjection = projection
            // Obligatoire depuis Android 14 : un callback doit être enregistré avant toute
            // utilisation de la projection (sinon exception à la création du VirtualDisplay).
            projection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { if (isLive) stopLive() }
            }, handler)
            // Pas de VirtualDisplay/ImageReader créés ici : depuis Android 14, un jeton de
            // MediaProjection ne peut démarrer qu'une seule capture d'écran. connectLiveKit()
            // ci-dessous en démarre une (pour la diffusion vidéo) ; en créer une seconde ici
            // provoquait "Cannot start already started MediaProjection" à chaque live.
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
                    connectLiveKit(newId, data)
                }
            }
            pluginRef?.emit("liveStateChanged", JSObject().put("live", true))
        } catch (e: Exception) {
            toast("Impossible de démarrer le live : ${e.message}")
        }
    }

    /** Récupère un jeton LiveKit auprès du serveur Arena, puis publie l'écran capturé ci-dessus comme flux vidéo. */
    private fun connectLiveKit(sid: String, projectionData: Intent) {
        BubbleHttp.edgeFunction(
            supabaseUrl, supabaseKey, accessToken, "livekit-token",
            JSONObject().put("session", sid).put("publish", true).put("displayName", displayName)
        ) { text ->
            val json = text?.let { try { JSONObject(it) } catch (e: Exception) { null } }
            val url = json?.optString("url")
            val tok = json?.optString("token")
            if (url.isNullOrEmpty() || tok.isNullOrEmpty()) {
                handler.post { toast("Diffusion vidéo indisponible pour l'instant (jeton refusé).") }
                return@edgeFunction
            }
            liveKitScope.launch {
                try {
                    val r = LiveKit.create(applicationContext)
                    liveKitRoom = r
                    r.connect(url, tok)
                    r.localParticipant.setScreenShareEnabled(true, ScreenCaptureParams(projectionData))
                    if (audioAllowed) startLiveAudio(r)
                    toast("Diffusion vidéo en direct active.")
                } catch (e: Exception) {
                    toast("Connexion vidéo impossible : ${e.message}")
                }
            }
        }
    }

    /**
     * Branche le son du jeu (audio système capturé via la même projection d'écran)
     * sur une piste audio LiveKit. Entièrement facultatif : toute erreur ici laisse
     * simplement le live continuer en vidéo seule, sans faire planter le reste.
     * Nécessite RECORD_AUDIO (déjà vérifié côté JS avant d'arriver ici) et l'API 29+.
     */
    private suspend fun startLiveAudio(r: Room) {
        try {
            val mp = mediaProjection ?: return
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
            val micOk = r.localParticipant.setMicrophoneEnabled(true)
            val track = r.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack
            if (micOk && track != null) {
                val capturer = ScreenAudioCapturer(mp)
                track.setAudioBufferCallback(capturer)
                screenAudioCapturer = capturer
                micAudioTrack = track
            }
        } catch (e: Exception) {
            handler.post { toast("Le son du live n'a pas pu être activé, la vidéo continue sans lui.") }
        }
    }

    private fun stopLiveAudio() {
        try { micAudioTrack?.setAudioBufferCallback(null) } catch (_: Exception) {}
        try { screenAudioCapturer?.releaseAudioResources() } catch (_: Exception) {}
        micAudioTrack = null
        screenAudioCapturer = null
    }

    private fun disconnectLiveKit() {
        val r = liveKitRoom
        liveKitRoom = null
        stopLiveAudio()
        if (r != null) {
            liveKitScope.launch {
                try { r.localParticipant.setMicrophoneEnabled(false) } catch (_: Exception) {}
                try { r.localParticipant.setScreenShareEnabled(false, null) } catch (_: Exception) {}
                try { r.disconnect() } catch (_: Exception) {}
            }
        }
    }

    private fun stopLive() {
        isLive = false
        try { mediaProjection?.stop() } catch (_: Exception) {}
        mediaProjection = null
        disconnectLiveKit()
        bubbleView?.findViewById<TextView>(R.id.arenaBubbleFace)?.setBackgroundResource(R.drawable.arena_bubble_bg)
        toast("Live arrêté")
        val stopFn = if (mode == "room") "stop_room_live" else "stop_live"
        val stopArg = if (mode == "room") "_room" to roomId else "_match" to matchId
        BubbleHttp.rpc(supabaseUrl, supabaseKey, accessToken, stopFn, JSONObject().put(stopArg.first, stopArg.second))
        pluginRef?.emit("liveStateChanged", JSObject().put("live", false))
    }

    // ---------------------------------------------------------------- chat

    private fun toggleChat() {
        if (chatView != null) { stopChatPoll(); removeView(chatView); chatView = null; return }
        closeOtherPanels(keep = "chat")
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
