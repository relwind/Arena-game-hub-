package app.arena.overlay

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Petit client HTTP maison pour parler directement à l'API REST de Supabase
 * depuis le service natif (la bulle fonctionne même quand l'appli Arena
 * est en arrière-plan, donc on ne peut pas compter sur le pont JS).
 * Pas de dépendance externe (OkHttp etc.) pour rester simple à compiler.
 */
object BubbleHttp {
    private const val TAG = "ArenaOverlay"
    private val pool = Executors.newCachedThreadPool()

    fun run(block: () -> Unit) {
        pool.execute {
            try { block() } catch (e: Exception) { Log.e(TAG, "requête échouée", e) }
        }
    }

    /** Appelle une fonction RPC Postgres exposée par PostgREST. onResult reçoit le texte brut renvoyé (ex: un uuid entre guillemets). */
    fun rpc(baseUrl: String, apiKey: String, accessToken: String, fn: String, body: JSONObject, onResult: ((String?) -> Unit)? = null) {
        run {
            val text = postJson("$baseUrl/rest/v1/rpc/$fn", apiKey, accessToken, body, preferMinimal = false)
            onResult?.let { it(text) }
        }
    }

    fun insertRow(baseUrl: String, apiKey: String, accessToken: String, table: String, body: JSONObject, onDone: ((Boolean) -> Unit)? = null) {
        run {
            val ok = postJson("$baseUrl/rest/v1/$table", apiKey, accessToken, body, preferMinimal = true) != null
            onDone?.let { it(ok) }
        }
    }

    fun selectRows(baseUrl: String, apiKey: String, accessToken: String, query: String, onDone: (JSONArray?) -> Unit) {
        run {
            val text = getText("$baseUrl/rest/v1/$query", apiKey, accessToken)
            onDone(if (text != null) try { JSONArray(text) } catch (e: Exception) { null } else null)
        }
    }

    private fun postJson(urlStr: String, apiKey: String, accessToken: String, body: JSONObject, preferMinimal: Boolean): String? {
        return try {
            val url = URL(urlStr)
            val c = url.openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 10000
            c.readTimeout = 10000
            c.setRequestProperty("apikey", apiKey)
            c.setRequestProperty("Authorization", "Bearer $accessToken")
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Prefer", if (preferMinimal) "return=minimal" else "return=representation")
            OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.let { BufferedReader(InputStreamReader(it)).readText() }
            if (code !in 200..299) Log.w(TAG, "POST $urlStr -> $code : $text")
            if (code in 200..299) (text ?: "{}") else null
        } catch (e: Exception) {
            Log.e(TAG, "POST $urlStr a échoué", e); null
        }
    }

    private fun getText(urlStr: String, apiKey: String, accessToken: String): String? {
        return try {
            val url = URL(urlStr)
            val c = url.openConnection() as HttpURLConnection
            c.requestMethod = "GET"
            c.connectTimeout = 10000
            c.readTimeout = 10000
            c.setRequestProperty("apikey", apiKey)
            c.setRequestProperty("Authorization", "Bearer $accessToken")
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.let { BufferedReader(InputStreamReader(it)).readText() }
            if (code !in 200..299) { Log.w(TAG, "GET $urlStr -> $code : $text"); null } else text
        } catch (e: Exception) {
            Log.e(TAG, "GET $urlStr a échoué", e); null
        }
    }
}
