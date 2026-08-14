package com.alphadental.clinic.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * A position good enough to decide whether someone is standing in the clinic.
 *
 * Deliberately not "ask once and take the answer". The first fix a phone returns is almost always
 * the coarse wifi/cell one; the accurate satellite fix arrives a few seconds later, after a
 * one-shot request has already given up. The website learned this the hard way, and this mirrors
 * its approach: listen for a short while, keep the best reading seen, and stop early once the fix
 * is good enough to be worth acting on.
 */
object LocationFinder {

    /** Stop as soon as a reading is at least this good — no point waiting for satellites we have. */
    private const val GOOD_ENOUGH_M = TARGET_ACCURACY_M

    /** How long to keep improving before going with the best so far. */
    private const val SETTLE_MS = 6_000L

    /** Give up entirely after this. Indoors, anything shorter often is not enough. */
    private const val HARD_TIMEOUT_MS = 20_000L

    sealed interface Result {
        data class Found(val reading: LocationReading) : Result
        data object PermissionDenied : Result
        data object Unavailable : Result
        data object TimedOut : Result
        data class TooInaccurate(val accuracy: Double) : Result
    }

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    suspend fun bestPosition(context: Context): Result = withContext(Dispatchers.Main) {
        if (!hasPermission(context)) return@withContext Result.PermissionDenied

        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return@withContext Result.Unavailable

        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }

        if (providers.isEmpty()) return@withContext Result.Unavailable

        val best = withTimeoutOrNull(HARD_TIMEOUT_MS) {
            suspendCancellableCoroutine { continuation ->
                var bestSoFar: Location? = null
                var settled = false

                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        // Keep the most accurate reading seen, not the most recent — a later,
                        // vaguer fix must not undo an earlier precise one.
                        if (bestSoFar == null || location.accuracy < bestSoFar!!.accuracy) {
                            bestSoFar = location
                        }
                        if (!settled && location.accuracy <= GOOD_ENOUGH_M) {
                            settled = true
                            runCatching { manager.removeUpdates(this) }
                            if (continuation.isActive) continuation.resume(bestSoFar)
                        }
                    }

                    @Deprecated("Required by the interface on older Android")
                    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
                    override fun onProviderEnabled(provider: String) = Unit
                    override fun onProviderDisabled(provider: String) = Unit
                }

                providers.forEach { provider ->
                    runCatching {
                        manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
                    }
                }

                // Whatever we have after the settle window, good or not.
                val settleJob = android.os.Handler(Looper.getMainLooper()).postDelayed({
                    if (!settled) {
                        settled = true
                        runCatching { manager.removeUpdates(listener) }
                        if (continuation.isActive) continuation.resume(bestSoFar)
                    }
                }, SETTLE_MS)

                continuation.invokeOnCancellation {
                    runCatching { manager.removeUpdates(listener) }
                    android.os.Handler(Looper.getMainLooper()).removeCallbacks { settleJob }
                }
            }
        }

        val location = best ?: return@withContext Result.TimedOut

        val accuracy = location.accuracy.toDouble()
        // A reading this vague tells us nothing about whether someone is in the building, and
        // forgiving it would widen a 50-metre fence to half a kilometre.
        if (accuracy > MAX_TRUSTED_ACCURACY_M) return@withContext Result.TooInaccurate(accuracy)

        Result.Found(LocationReading(location.latitude, location.longitude, accuracy))
    }
}
