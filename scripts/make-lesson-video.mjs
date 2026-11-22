/**
 * Builds a short step-by-step LESSON video (not a marketing film): one task, phone screens that
 * stay still, a ring on the button to press, a step counter on top, an Egyptian-Arabic teacher
 * voice, and a recap card with one "watch out" tip at the end.
 *
 *   node scripts/make-lesson-video.mjs --lesson docs/lessons/<id>.json --vo <dir> --voice-only
 *   node scripts/make-lesson-video.mjs --lesson docs/lessons/<id>.json --frames <dir> --vo <dir> --out <file.mp4>
 *        [--still 3,12.5]  writes PNG stills at those seconds instead of a film
 *        [--only 4]        with --voice-only: re-records one line
 *        [--voice Charon] [--model gemini-2.5-flash-preview-tts] [--tempo 1.05] [--fps 30]
 *
 * Frames are <name>.png (1080x1500, a 432x600 phone viewport at 2.5x) + <name>.json {box} in image
 * pixels — the box is what the ring goes round. They are captured from the DEMO clinic only.
 *
 * Every frame of the film is drawn by lesson-video.html's render(t) for an exact time and piped to
 * ffmpeg, so picture and voice cannot drift. The voice is the master clock: a beat lasts as long as
 * its line plus a breath. Run from the project root (reads GEMINI_API_KEY from .env.local).
 *
 * Nothing is downloaded: Playwright comes from the npx cache with the installed Chrome, ffmpeg is
 * the one on PATH.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PLAYWRIGHT = "C:/Users/PC/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright";

/** Silence before a line starts and after it ends. Cards breathe a little longer than steps. */
const LEAD = { step: 0.35, card: 0.6 };
const TAIL = { step: 0.5, card: 0.8 };
/** The shortest a shot may be: a tap needs time for the ring, the finger and the press. */
const MIN_SHOT = { tap: 2.2, look: 2.0 };
/** How long before a tap shot ends the press lands (matches lesson-video.html). */
const TAP_BEFORE_END = 0.55;

const has = (name) => process.argv.includes(`--${name}`);
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const TEMPO = Number(arg("tempo", 1));

/* --- voice --------------------------------------------------------------------------------- */

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k]) continue;
    process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function pcmToWav(pcm, sampleRate, channels = 1, bits = 16) {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * The read's direction. Written in Egyptian Arabic on purpose: with an English instruction, or
 * none, the model reads Arabic as a formal newsreader, which is nothing like a colleague teaching.
 */
const TEACHER =
  "اقرأ الكلام ده بالعامية المصرية، بصوت مدرّس هادي وواضح بيشرح لزميله في العيادة خطوة خطوة. سرعة عادية ومريحة، ووقفة صغيرة بعد كل جملة. من غير نبرة إعلانات ولا نشرة أخبار";

async function synth(text, voice, model, apiKey) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${TEACHER}:\n\n${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, attempt * 4000)); continue; }
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    }
    const inline = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) { await new Promise((r) => setTimeout(r, attempt * 3000)); continue; }
    const rate = Number((String(inline.mimeType || "").match(/rate=(\d+)/) || [])[1] || 24000);
    return pcmToWav(Buffer.from(inline.data, "base64"), rate);
  }
  throw new Error("Gemini returned no audio after 4 attempts.");
}

const wavSeconds = (wav) => (wav.length - 44) / (wav.readUInt32LE(24) * 2);

async function recordVoice(lesson, voDir) {
  loadEnvLocal();
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY missing from .env.local");
  const voice = arg("voice", "Charon");
  const model = arg("model", "gemini-2.5-flash-preview-tts");
  const only = has("only") ? Number(arg("only")) : null;
  fs.mkdirSync(voDir, { recursive: true });
  console.log(`Voice: ${voice} (${model})`);
  for (const b of lesson.beats) {
    if (only !== null && b.n !== only) continue;
    const name = `vo-${String(b.n).padStart(2, "0")}.wav`;
    const wav = await synth(b.say, voice, model, key);
    fs.writeFileSync(path.join(voDir, name), wav);
    console.log(`  ${name}  ${wavSeconds(wav).toFixed(2)}s  ${b.say.slice(0, 50)}`);
  }
  writeTimings(lesson, voDir);
}

/**
 * The breaths inside a line (not the silence before or after it), found by ffmpeg. A teacher pauses
 * between sentences, so these are where the picture may change: shot or recap row k can be cued to
 * the end of pause k and lands exactly as its sentence starts.
 */
function innerPauses(file, seconds) {
  // The filter reports on stderr, also when it succeeds.
  const log = String(spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.3", "-f", "null", "-"], { encoding: "utf8" }).stderr || "");
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const out = [];
  starts.forEach((start, i) => {
    const end = ends[i] ?? seconds;
    if (start > 0.05 && end < seconds - 0.05) out.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) });
  });
  return out;
}

/** timings.json is always rebuilt from the WAVs on disk, so a re-recorded line cannot go stale. */
function writeTimings(lesson, voDir) {
  const lines = lesson.beats.map((b) => {
    const file = `vo-${String(b.n).padStart(2, "0")}.wav`;
    const full = path.join(voDir, file);
    if (!fs.existsSync(full)) throw new Error(`No narration for beat ${b.n} — run with --voice-only first.`);
    const seconds = Number(wavSeconds(fs.readFileSync(full)).toFixed(2));
    return { n: b.n, file, seconds, pauses: innerPauses(full, seconds) };
  });
  fs.writeFileSync(path.join(voDir, "timings.json"), JSON.stringify({ lines }, null, 2));
  const total = lines.reduce((a, l) => a + l.seconds, 0);
  console.log(`Narration: ${total.toFixed(1)}s over ${lines.length} lines`);
  return lines;
}

/* --- timeline ------------------------------------------------------------------------------ */

function buildTimeline(lesson, lines, framesDir) {
  const scenes = [];
  let t = 0;
  for (const b of lesson.beats) {
    const line = lines.find((l) => l.n === b.n);
    const kind = b.card ? "card" : "step";
    const spoken = LEAD[kind] + line.seconds / TEMPO + TAIL[kind];
    const sc = { n: b.n, start: t, lead: LEAD[kind], vo: line.file, voSeconds: line.seconds / TEMPO };
    if (b.card) {
      // Where each sentence of the line starts, for the recap rows.
      Object.assign(sc, { card: b.card, dur: spoken, cues: (line.pauses || []).map((p) => LEAD.card + p.end / TEMPO) });
    } else {
      const shots = b.shots.map((s) => {
        const png = path.join(framesDir, `${s.frame}.png`);
        if (!fs.existsSync(png)) throw new Error(`Missing frame ${png}`);
        const meta = JSON.parse(fs.readFileSync(path.join(framesDir, `${s.frame}.json`), "utf8"));
        return { src: pathToFileURL(path.resolve(png)).href, box: meta.box, act: s.act || "look", caption: s.caption || "", spot: s.spot !== false, w: s.w || 1, min: MIN_SHOT[s.act || "look"] };
      });
      // A shot with a "cue" starts as sentence k of the line starts (the end of inner pause k),
      // a touch early so the picture is there first; the rest share what is left by weight.
      // No shot is ever squeezed below its minimum, so a late cue pushes the ones after it.
      const cueAt = (k) => {
        const pause = line.pauses?.[k - 1];
        if (!pause) throw new Error(`Beat ${b.n}: cue ${k} but the line has ${line.pauses?.length ?? 0} pauses.`);
        return LEAD.step + pause.end / TEMPO - 0.18;
      };
      let dur;
      if (b.shots.some((s) => s.cue)) {
        shots.forEach((s, i) => {
          const floor = i === 0 ? 0 : shots[i - 1].at + shots[i - 1].min;
          s.at = i === 0 ? 0 : Math.max(b.shots[i].cue ? cueAt(b.shots[i].cue) : floor, floor);
          if (i > 0) shots[i - 1].dur = s.at - shots[i - 1].at;
        });
        const last = shots[shots.length - 1];
        dur = Math.max(spoken, last.at + last.min);
        last.dur = dur - last.at;
      } else {
        dur = Math.max(spoken, shots.reduce((a, s) => a + s.min, 0));
        const weight = shots.reduce((a, s) => a + s.w, 0);
        const spare = dur - shots.reduce((a, s) => a + s.min, 0);
        let at = 0;
        for (const s of shots) {
          s.dur = s.min + (spare * s.w) / weight;
          s.at = at;
          at += s.dur;
        }
      }
      Object.assign(sc, { step: b.step, dur, shots: shots.map(({ w, min, ...s }) => s) });
    }
    scenes.push(sc);
    t += sc.dur;
  }
  return { scenes, total: t + 0.6 };
}

/* --- sound --------------------------------------------------------------------------------- */

function buildAudio(scenes, total, voDir, work) {
  const click = path.join(work, "tap.wav");
  // A short low tick: enough to read as a press, quiet enough to sit under a voice.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i",
    "aevalsrc=0.5*sin(2*PI*1400*t)*exp(-60*t)+0.25*sin(2*PI*700*t)*exp(-40*t):s=48000:d=0.12",
    "-af", "lowpass=f=3500", "-ac", "2", click]);
  const inputs = [], filters = [];
  const add = (file, ms, chain) => {
    inputs.push("-i", file);
    const i = inputs.length / 2 - 1;
    filters.push(`[${i}:a]${chain},adelay=${ms}|${ms}[a${i}]`);
  };
  for (const s of scenes) add(path.join(voDir, s.vo), Math.round((s.start + s.lead) * 1000), `aresample=48000,aformat=channel_layouts=stereo,atempo=${TEMPO}`);
  for (const s of scenes) for (const shot of s.shots || []) {
    if (shot.act === "tap") add(click, Math.round((s.start + shot.at + shot.dur - TAP_BEFORE_END) * 1000), "volume=0.35");
  }
  const n = inputs.length / 2;
  const mix = Array.from({ length: n }, (_, i) => `[a${i}]`).join("") + `amix=inputs=${n}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  const graph = path.join(work, "audio-graph.txt");
  fs.writeFileSync(graph, [...filters, mix].join(";\n"));
  const out = path.join(work, "narration.wav");
  // ffmpeg 7+: "-/opt file" reads the option's value from a file.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-/filter_complex", graph, "-map", "[out]", "-t", total.toFixed(2), "-ar", "48000", out]);
  return out;
}

/* --- film ---------------------------------------------------------------------------------- */

async function main() {
  const lessonFile = arg("lesson");
  const voDir = arg("vo");
  if (!lessonFile || !voDir) throw new Error("Pass --lesson <json> and --vo <dir>.");
  const lesson = JSON.parse(fs.readFileSync(lessonFile, "utf8"));
  if (has("voice-only")) return recordVoice(lesson, voDir);

  const framesDir = arg("frames"), outFile = arg("out");
  const fps = Number(arg("fps", 30));
  if (!framesDir || !outFile) throw new Error("Pass --frames <dir> and --out <file.mp4>.");
  const { scenes, total } = buildTimeline(lesson, writeTimings(lesson, voDir), framesDir);
  console.log(`${scenes.length} beats, ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`);
  if (has("show")) for (const l of JSON.parse(fs.readFileSync(path.join(voDir, "timings.json"), "utf8")).lines) console.log("line", l.n, l.seconds, (l.pauses || []).map((p) => `${p.start}-${p.end}`).join(" "));
  if (has("show")) for (const s of scenes) console.log(s.n, s.start.toFixed(2), s.dur.toFixed(2), s.card || (s.shots || []).map((x) => `${(s.start + x.at).toFixed(2)}+${x.dur.toFixed(2)}`).join(" "));

  const font = (file) => pathToFileURL(path.join(ROOT, "src/fonts", file)).href;
  const config = {
    lesson: { kicker: lesson.kicker, title: lesson.title, question: lesson.question, length: lesson.length, steps: lesson.steps, tip: lesson.tip },
    scenes, total,
    fonts: [
      { family: "Cairo", url: font("cairo-arabic-wght.woff2"), weight: "200 1000" },
      { family: "Cairo", url: font("cairo-latin-wght.woff2"), weight: "200 1000" },
      { family: "Montserrat", url: font("montserrat-latin-wght.woff2"), weight: "500 700" },
    ],
  };
  const work = path.join(path.dirname(path.resolve(outFile)), ".lesson-work");
  fs.mkdirSync(work, { recursive: true });

  const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT);
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(pathToFileURL(path.join(HERE, "lesson-video.html")).href, { waitUntil: "load" });
  await page.evaluate((c) => window.setup(c), config);
  await page.waitForTimeout(600);

  const stills = arg("still");
  if (stills) {
    for (const s of stills.split(",").map(Number)) {
      await page.evaluate((t) => window.render(t), s);
      const f = path.join(work, `still-${s.toFixed(2).replace(".", "_")}.png`);
      await page.screenshot({ path: f });
      console.log(f);
    }
    await browser.close();
    return;
  }

  const video = path.join(work, "video.mp4");
  // --reuse-video skips the slow frame pass and only redoes the sound and the mux.
  if (!(has("reuse-video") && fs.existsSync(video))) {
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), video], { stdio: ["pipe", "inherit", "inherit"] });
    const frames = Math.ceil(total * fps);
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.render(t), f / fps);
      const buf = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (f % (fps * 10) === 0) console.log(`  ${(f / fps).toFixed(0)}s / ${total.toFixed(0)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (code) => (code === 0 ? r() : j(new Error(`ffmpeg exited ${code}`)))));
  }
  await browser.close();

  const audio = buildAudio(scenes, total, voDir, work);
  // H.264 + AAC, faststart: plays inline on WhatsApp and on an iPhone.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", outFile]);
  console.log(`\n${outFile}\n${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} · ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
