/**
 * Synthesises every line Sara speaks on the tour, once, into the shared voice cache.
 *
 *   npx tsx scripts/warm-tour-voice.mts            # both languages, only what is missing
 *   npx tsx scripts/warm-tour-voice.mts --lang ar  # one language
 *   npx tsx scripts/warm-tour-voice.mts --dry      # count and price it, synthesise nothing
 *
 * Why this exists: the tour's audio is cached in Storage under a hash of the text, shared by
 * every clinic, so a line costs money exactly once — but the FIRST person to hear it waits for
 * Gemini while it is made. Running this after a narration change means nobody ever does.
 *
 * It writes to the same key the /api/tts route reads, and skips anything already there, so it is
 * safe to run repeatedly and cheap to run after a small edit — which is also how it survives the
 * speech model's daily quota: when the quota is gone it stops, says how many are left, and the
 * next run picks up exactly where it stopped.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function bucket() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
      }),
    });
  }
  const name = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!name) throw new Error("FIREBASE_STORAGE_BUCKET is missing.");
  return getStorage(getApps()[0]).bucket(name);
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const only = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null;
  const langs: ("en" | "ar")[] = only === "en" || only === "ar" ? [only] : ["en", "ar"];

  // Imported after the env is loaded: these modules read it at module scope.
  const { TOUR_STOPS } = await import("../src/lib/grandTour");
  const { getGeminiTtsProvider } = await import("../src/lib/tts");
  const { toSpeechText, trimForSpeech } = await import("../src/lib/speechText");

  /** Every spoken line of the tour, exactly as the overlay would ask for it. */
  const linesFor = (lang: "en" | "ar"): string[] => {
    const out = new Set<string>();
    const push = (l?: { en: string; ar: string } | null) => {
      if (!l) return;
      const spoken = trimForSpeech(toSpeechText(lang === "ar" ? l.ar : l.en, lang === "ar"), 600);
      if (spoken) out.add(spoken);
    };
    const walk = (actions: readonly unknown[] | undefined) => {
      for (const a of actions ?? []) {
        const action = a as Record<string, unknown>;
        push(action.say as { en: string; ar: string } | undefined);
        if (action.kind === "say") push(action.text as { en: string; ar: string });
        if (Array.isArray(action.then)) walk(action.then as unknown[]);
      }
    };
    for (const stop of TOUR_STOPS) {
      push(stop.say);
      walk(stop.walk);
      walk(stop.demo);
      if (stop.handsOn) {
        push(stop.handsOn.say);
        push(stop.handsOn.done);
        push(stop.handsOn.gaveUp);
        push(stop.handsOn.doneUnless?.say);
      }
      if (stop.phone) {
        push(stop.phone.say);
        walk(stop.phone.walk);
      }
    }
    return [...out];
  };

  const store = bucket();
  const provider = getGeminiTtsProvider();
  let made = 0;
  let skipped = 0;
  let failed = 0;
  let characters = 0;
  let remaining = 0;
  let quotaGone = false;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * One line, with patience. A 429 from this model is usually the per-minute rate rather than the
   * day's allowance, and waiting is the whole fix; when waiting stops helping, the day is gone.
   */
  const synthesise = async (text: string, lang: "en" | "ar") => {
    for (const wait of [0, 8000, 30000]) {
      if (wait) await sleep(wait);
      try {
        return await provider.synthesize({ text, language: lang });
      } catch (error) {
        if (!String(error).includes("429")) throw error;
      }
    }
    return null;
  };

  for (const lang of langs) {
    const lines = linesFor(lang);
    console.log(`\n${lang}: ${lines.length} distinct lines`);
    for (const [i, text] of lines.entries()) {
      const file = store.file(`tts-cache/${lang}/${createHash("sha1").update(text).digest("hex")}.wav`);
      const [exists] = await file.exists();
      if (exists) {
        skipped += 1;
        continue;
      }
      characters += text.length;
      if (dry) continue;
      if (quotaGone) {
        remaining += 1;
        continue;
      }
      try {
        const result = await synthesise(text, lang);
        if (!result) {
          // Three tries and two waits later it is still refusing: that is the day's allowance,
          // not a burst. Stop rather than hammer a closed door 500 more times.
          quotaGone = true;
          remaining += 1;
          console.warn(`  ! the speech model's quota is used up — stopping here.`);
          continue;
        }
        await file.save(Buffer.from(result.audioBase64, "base64"), { contentType: "audio/wav", resumable: false });
        made += 1;
        if (made % 10 === 0) console.log(`  …${made} made (${i + 1}/${lines.length})`);
      } catch (error) {
        failed += 1;
        console.warn(`  ! ${String(error).slice(0, 120)}`);
      }
    }
  }

  // Gemini's TTS is billed per token; ~4 characters a token is the rule of thumb, at $10/1M.
  const dollars = ((characters / 4) * 10) / 1_000_000;
  console.log(
    `\n${dry ? "Would synthesise" : "Synthesised"} ${dry ? characters : made} ${dry ? "characters" : "lines"}` +
      `, ${skipped} already cached, ${failed} failed. Rough cost: $${dollars.toFixed(2)}.`,
  );
  if (remaining > 0) {
    console.log(`${remaining} lines still to do. Run this again when the quota resets; it resumes where it stopped.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
