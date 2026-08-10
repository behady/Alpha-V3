/**
 * Getting a position good enough to decide whether someone is standing in the clinic.
 *
 * Why this exists: clock-in worked for the same person, on the same phone, in the same chair, and
 * then didn't. The cause was not a bug in the usual sense — it was trusting a single GPS reading
 * and ignoring how wrong that reading admits to being.
 *
 * Two facts about phone geolocation drive everything below:
 *
 *  1. Indoors, a fix is usually derived from Wi-Fi and cell towers, not satellites. Its accuracy
 *     is routinely 30–150 metres. Against a 50-metre geofence, a perfectly honest reading of "you
 *     are 80m away, give or take 90m" was being read as "you are 80m away" and refused. Same
 *     person, same spot, different hour, different answer.
 *
 *  2. getCurrentPosition returns the FIRST fix, which is typically the coarse network one. The
 *     accurate satellite fix arrives a few seconds later, after the callback has already run.
 *
 * So: watch briefly, keep the best reading, and then judge "could this person be inside the
 * geofence?" rather than "is this exact point inside it?".
 */

/** Stop early once a reading is at least this good — no point waiting for satellites we have. */
const TARGET_ACCURACY_M = 25;

/** How long to keep improving the fix before going with the best one so far. */
const SETTLE_MS = 6000;

/** Give up entirely after this. Longer than the old 15s, because indoors 15s often wasn't enough. */
const HARD_TIMEOUT_MS = 20000;

/**
 * Beyond this, the reading tells us nothing useful. Forgiving a ±500m fix would mean anyone
 * within half a kilometre could clock in, which defeats the point of a geofence.
 */
const MAX_TRUSTED_ACCURACY_M = 200;

/**
 * The most slop we will forgive, even if the reading claims to be worse. Keeps a mediocre fix
 * from quietly widening a 50m geofence into a 200m one.
 */
const ACCURACY_ALLOWANCE_M = 100;

export type LocationFailure =
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "timeout" }
  | { kind: "inaccurate"; accuracy: number };

export type LocationReading = { latitude: number; longitude: number; accuracy: number };

export type LocationResult = { ok: true; reading: LocationReading } | { ok: false; failure: LocationFailure };

/**
 * Best position obtainable in a few seconds.
 *
 * maximumAge is 0 deliberately. The previous code accepted a cached fix up to a minute old, which
 * for someone who has just walked in from the street is a reading of the street.
 */
export function acquireBestPosition(): Promise<LocationResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ok: false, failure: { kind: "unsupported" } });
  }

  return new Promise((resolve) => {
    let best: LocationReading | null = null;
    let settled = false;
    let watchId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (settleTimer) clearTimeout(settleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    };

    const finish = (result: LocationResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const finishWithBest = (fallback: LocationFailure) => {
      if (!best) return finish({ ok: false, failure: fallback });
      if (best.accuracy > MAX_TRUSTED_ACCURACY_M) {
        return finish({ ok: false, failure: { kind: "inaccurate", accuracy: Math.round(best.accuracy) } });
      }
      finish({ ok: true, reading: best });
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy);
        const reading: LocationReading = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : Number.POSITIVE_INFINITY,
        };
        if (!best || reading.accuracy < best.accuracy) best = reading;

        // Good enough — don't make someone stand there watching a spinner.
        if (best.accuracy <= TARGET_ACCURACY_M) finishWithBest({ kind: "timeout" });
      },
      (error) => {
        // A permission refusal is final; nothing better is coming. Other errors may still be
        // followed by a good reading, so only act on them if we have nothing at all.
        if (error.code === error.PERMISSION_DENIED) return finish({ ok: false, failure: { kind: "denied" } });
        if (!best && error.code === error.POSITION_UNAVAILABLE) {
          return finish({ ok: false, failure: { kind: "unavailable" } });
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: HARD_TIMEOUT_MS }
    );

    // Take the best reading collected so far once the settle window closes.
    settleTimer = setTimeout(() => {
      if (best) finishWithBest({ kind: "timeout" });
    }, SETTLE_MS);

    hardTimer = setTimeout(() => finishWithBest({ kind: "timeout" }), HARD_TIMEOUT_MS);
  });
}

/** Great-circle distance in metres. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
}

export type GeofenceVerdict = {
  inside: boolean;
  /** Straight-line distance from the clinic to the reported point. */
  distance: number;
  /** Distance after allowing for how uncertain the reading admits to being. */
  effectiveDistance: number;
  accuracy: number;
};

/**
 * "Could this person be inside the geofence?" rather than "is this point inside it?".
 *
 * A reading of 80m ± 90m is entirely consistent with standing in reception. Refusing it is a
 * false negative, and a false negative here means a real member of staff cannot start their shift.
 */
export function judgeGeofence(args: { reading: LocationReading; clinic: Geofence }): GeofenceVerdict {
  const { reading, clinic } = args;
  const distance = metresBetween(reading.latitude, reading.longitude, clinic.lat, clinic.lng);
  const allowance = Math.min(reading.accuracy, ACCURACY_ALLOWANCE_M);
  const effectiveDistance = Math.max(0, Math.round(distance - allowance));
  return {
    inside: effectiveDistance <= clinic.radius,
    distance,
    effectiveDistance,
    accuracy: Math.round(reading.accuracy),
  };
}

export type Geofence = { lat: number; lng: number; radius: number };

/**
 * True when the clinic's saved coordinates are actually usable numbers.
 *
 * A type guard rather than a plain boolean so callers get the narrowing for free. It also closes
 * a quiet hole: settings holding an unparseable latitude produced NaN, every distance comparison
 * against NaN is false, and `distance > radius` being false meant the geofence silently passed
 * everyone. A broken configuration used to disable the check rather than report itself.
 */
export function isUsableGeofence(g: Geofence | null): g is Geofence {
  if (!g) return false;
  return (
    Number.isFinite(g.lat) &&
    Number.isFinite(g.lng) &&
    Number.isFinite(g.radius) &&
    g.radius > 0 &&
    Math.abs(g.lat) <= 90 &&
    Math.abs(g.lng) <= 180
  );
}

/** What to tell the person, in the language they are using. */
export function locationFailureMessage(failure: LocationFailure, isAr: boolean): string {
  switch (failure.kind) {
    case "unsupported":
      return isAr
        ? "الجهاز ده مش بيدعم تحديد الموقع. جرّب من موبايل."
        : "This device cannot determine location. Try from a phone.";
    case "denied":
      return isAr
        ? "إذن الموقع مرفوض. افتح إعدادات المتصفح واسمح بالوصول للموقع، وبعدين جرّب تاني."
        : "Location permission is blocked. Allow location access in your browser settings, then try again.";
    case "unavailable":
      return isAr
        ? "مش قادرين نحدد موقعك. اتأكد إن الـ GPS مفعّل وجرّب تاني."
        : "Your location could not be determined. Check that GPS is switched on and try again.";
    case "timeout":
      return isAr
        ? "أخدنا وقت طويل في تحديد الموقع. قرّب من شباك أو اطلع بره لحظة وجرّب تاني."
        : "Finding your location took too long. Move near a window or step outside briefly, then try again.";
    case "inaccurate":
      return isAr
        ? `إشارة الموقع ضعيفة جداً دلوقتي (دقة ±${failure.accuracy} متر). قرّب من شباك وجرّب تاني.`
        : `The location signal is too weak right now (accurate to about ±${failure.accuracy}m). Move near a window and try again.`;
  }
}
