package com.alphadental.clinic.data

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Deciding whether someone is standing in the clinic, ported from lib/attendanceLocation.ts.
 *
 * The rule is not "is this point inside the circle" but "could this person be inside it", and that
 * distinction came from a real failure on the website: clock-in worked for the same person, on the
 * same phone, in the same chair, and then didn't.
 *
 * The cause is how phone positioning actually behaves. Indoors a fix comes from wifi and cell
 * towers rather than satellites, and is routinely 30–150 metres out. Against a 50-metre geofence,
 * an honest reading of "80m away, give or take 90m" was being read as "80m away" and refused.
 *
 * So the reading's own stated accuracy is subtracted before comparing — but only up to a cap,
 * because forgiving a ±500m fix would let anyone within half a kilometre clock in, which defeats
 * the point entirely.
 */

/** The most slop forgiven, however bad the reading claims to be. */
private const val ACCURACY_ALLOWANCE_M = 100.0

/** Beyond this the reading tells us nothing useful and is refused outright. */
const val MAX_TRUSTED_ACCURACY_M = 200.0

/** Stop waiting for a better fix once this good. */
const val TARGET_ACCURACY_M = 25.0

data class Geofence(val lat: Double, val lng: Double, val radius: Double)

data class LocationReading(val latitude: Double, val longitude: Double, val accuracy: Double)

data class GeofenceVerdict(
    val inside: Boolean,
    /** Straight-line distance from the clinic to the reported point. */
    val distance: Double,
    /** Distance after forgiving the reading's own margin of error. */
    val effectiveDistance: Int,
)

/** Great-circle distance in metres. */
fun metresBetween(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val earthRadius = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = sin(dLat / 2).pow(2) +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
    return 2 * earthRadius * asin(min(1.0, sqrt(a)))
}

/** Could this person be inside the clinic's geofence? */
fun judgeGeofence(reading: LocationReading, clinic: Geofence): GeofenceVerdict {
    val distance = metresBetween(reading.latitude, reading.longitude, clinic.lat, clinic.lng)
    val allowance = min(reading.accuracy, ACCURACY_ALLOWANCE_M)
    val effective = kotlin.math.max(0.0, (distance - allowance)).roundToInt()

    return GeofenceVerdict(
        inside = effective <= clinic.radius,
        distance = distance,
        effectiveDistance = effective,
    )
}

/**
 * Is this geofence worth enforcing at all?
 *
 * Guards a quiet hole the website had: settings holding an unparseable latitude produced NaN,
 * every comparison against NaN is false, and `distance > radius` being false meant the geofence
 * silently passed everyone. A geofence that cannot be trusted must be treated as absent — which
 * is a visible state — rather than as satisfied.
 */
fun isUsableGeofence(g: Geofence?): Boolean =
    g != null &&
        g.lat.isFinite() &&
        g.lng.isFinite() &&
        g.radius.isFinite() &&
        g.radius > 0 &&
        !(g.lat == 0.0 && g.lng == 0.0)
