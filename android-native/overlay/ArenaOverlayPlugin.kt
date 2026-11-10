package app.arena.overlay

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Pont JS <-> natif pour la bulle flottante Arena.
 * Côté JS : src/lib/overlay.ts (registerPlugin('ArenaOverlay')).
 * La bulle elle-même (fenêtre système, live, capture, chat) vit dans OverlayService,
 * qui continue de tourner même quand l'appli Arena passe en arrière-plan
 * (le joueur est dans eFootball).
 */
@CapacitorPlugin(name = "ArenaOverlay")
class ArenaOverlayPlugin : Plugin() {

    override fun load() {
        super.load()
        OverlayService.pluginRef = this
    }

    @PluginMethod
    fun hasOverlayPermission(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", Settings.canDrawOverlays(context))
        call.resolve(ret)
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (Settings.canDrawOverlays(context)) {
            val ret = JSObject(); ret.put("granted", true); call.resolve(ret); return
        }
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + context.packageName))
        startActivityForResult(call, intent, "overlayPermissionResult")
    }

    @ActivityCallback
    private fun overlayPermissionResult(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        val ret = JSObject(); ret.put("granted", Settings.canDrawOverlays(context)); call.resolve(ret)
    }

    @PluginMethod
    fun requestProjectionPermission(call: PluginCall) {
        val mgr = context.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(call, mgr.createScreenCaptureIntent(), "projectionPermissionResult")
    }

    @ActivityCallback
    private fun projectionPermissionResult(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        val granted = result != null && result.resultCode == Activity.RESULT_OK && result.data != null
        if (granted) {
            OverlayService.pendingProjectionResultCode = result!!.resultCode
            OverlayService.pendingProjectionData = result.data
        }
        val ret = JSObject(); ret.put("granted", granted); call.resolve(ret)
    }

    @PluginMethod
    fun showBubble(call: PluginCall) {
        if (!Settings.canDrawOverlays(context)) {
            call.reject("overlay_permission_missing"); return
        }
        // La bulle ne sert qu'à accompagner une partie eFootball : pas la peine de l'ouvrir
        // (et de demander des permissions) si le jeu n'est même pas installé sur l'appareil.
        if (context.packageManager.getLaunchIntentForPackage("jp.konami.pesam") == null) {
            call.reject("efootball_not_installed"); return
        }
        val intent = Intent(context, OverlayService::class.java).apply {
            action = OverlayService.ACTION_START
            putExtra("sessionId", call.getString("sessionId", ""))
            putExtra("matchId", call.getString("matchId", ""))
            putExtra("roomId", call.getString("roomId", ""))
            putExtra("mode", call.getString("mode", "match"))
            putExtra("supabaseUrl", call.getString("supabaseUrl", ""))
            putExtra("supabaseKey", call.getString("supabaseKey", ""))
            putExtra("accessToken", call.getString("accessToken", ""))
            putExtra("userId", call.getString("userId", ""))
            putExtra("displayName", call.getString("displayName", "Joueur"))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun hideBubble(call: PluginCall) {
        context.startService(Intent(context, OverlayService::class.java).apply { action = OverlayService.ACTION_STOP })
        call.resolve()
    }

    @PluginMethod
    fun isBubbleShown(call: PluginCall) {
        val ret = JSObject(); ret.put("shown", OverlayService.isRunning); ret.put("live", OverlayService.isLive)
        call.resolve(ret)
    }

    /** Appelé par OverlayService pour remonter un évènement au JS (liveStateChanged, screenshotTaken…). */
    fun emit(eventName: String, data: JSObject) {
        notifyListeners(eventName, data)
    }
}
