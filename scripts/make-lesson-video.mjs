/**
 * Builds a short step-by-step LESSON video (not a marketing film): one task, screens that stay
 * still, a ring on the button to press, a step counter, an Egyptian-Arabic teacher voice, and a
 * recap card with one "watch out" tip at the end.
 *
 * Every lesson is made twice — the owner's standing rule: a mobile version and a PC version.
 *
 *   node scripts/make-lesson-video.mjs --lesson docs/lessons/<id>.json --layout phone|pc --vo <dir> --voice-only
 *   node scripts/make-lesson-video.mjs --lesson docs/lessons/<id>.json --layout phone|pc --vo <dir> --check-voice
 *   node scripts/make-lesson-video.mjs --lesson docs/lessons/<id>.json --layout phone|pc --frames <dir> --vo <dir> --out <file.mp4>
 *        [--still 3,12.5]  writes PNG stills at those seconds instead of a film
 *        [--show]          prints the timeline and each line's pauses
 *        [--voice Charon] [--model gemini-2.5-flash-preview-tts] [--tempo 1.05] [--fps 30]
 *
 * layout phone: 1080x1920, frames are 1080x1500 (a 432x600 phone viewport at 2.5x).
 * layout pc:    1920x1080, frames are 1500x1080 (a 1200x864 browser window at 1.25x).
 * A frame is <name>.png + <name>.json {box} in image pixels — the box is what the ring goes round.
 * Frames are captured from the DEMO clinic only and are not in the repo.
 *
 * THE VOICE IS ONE TAKE. The whole narration is sent as a single request and then cut into lines
 * at its pauses. One request per line was tried first and the owner heard the voice change from
 * line to line — tone and energy drift between requests. So a line cannot be re-recorded alone:
 * change the text, record the take again. --check-voice has the cut lines transcribed and prints
 * each beside its script line, because a wrong cut is silent otherwise.
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

const LAYOUTS = {
  phone: { width: 1080, height: 1920, pointer: "finger" },
  pc: { width: 1920, height: 1080, pointer: "cursor" },
};

/** Silence before a line starts and after it ends. Cards breathe a little longer than steps. */
const LEAD = { step: 0.35, card: 0.6 };
const TAIL = { step: 0.5, card: 0.8 };
/** The shortest a shot may be: a tap needs time for the ring, the pointer and the press. */
const MIN_SHOT = { tap: 2.2, look: 2.0 };
/** How long before a tap shot ends the press lands (matches lesson-video.html). */
const TAP_BEFORE_END = 0.55;

const has = (name) => process.argv.includes(`--${name}`);
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const TEMPO = Number(arg("tempo", 1));

/** A beat as one layout sees it: `pc: {...}` on a beat overrides its line and shots there. */
function beatsFor(lesson, layout) {
  return lesson.beats.map((b) => {
    const { pc, ...rest } = b;
    return layout === "pc" && pc ? { ...rest, ...pc } : rest;
  });
}

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
function apiKey() {
  loadEnvLocal();
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY missing from .env.local");
  return key;
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
const wavRate = (wav) => wav.readUInt32LE(24);
const wavSeconds = (wav) => (wav.length - 44) / (wavRate(wav) * 2);

/**
 * The read's direction. Written in Egyptian Arabic on purpose: with an English instruction, or
 * none, the model reads Arabic as a formal newsreader, which is nothing like a colleague teaching.
 * The last sentence asks for a real stop between paragraphs — that stop is where the take is cut.
 */
const TEACHER =
  "اقرأ الكلام ده بالعامية المصرية، بصوت مدرّس هادي وواضح بيشرح لزميله في العيادة خطوة خطوة. نفس الصوت ونفس السرعة ونفس النبرة من أول كلمة لآخر كلمة. سرعة عادية ومريحة، ووقفة صغيرة بعد كل جملة. من غير نبرة إعلانات ولا نشرة أخبار. وبين كل فقرة والتانية اسكت ثانية ونص كاملة قبل ما تكمّل";

async function gemini(model, body, key) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const detail = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, attempt * 5000)); continue; }
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  throw new Error("Gemini kept refusing after 4 attempts.");
}

async function synthTake(text, voice, model, key) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = await gemini(model, {
      contents: [{ parts: [{ text: `${TEACHER}:\n\n${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }, key);
    const inline = body?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (inline?.data) {
      const rate = Number((String(inline.mimeType || "").match(/rate=(\d+)/) || [])[1] || 24000);
      return pcmToWav(Buffer.from(inline.data, "base64"), rate);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw new Error("Gemini returned no audio after 3 attempts.");
}

/** Every silence in a WAV, as ffmpeg hears it (the filter reports on stderr, also on success). */
function silences(file, minSeconds) {
  const log = String(spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=-38dB:d=${minSeconds}`, "-f", "null", "-"], { encoding: "utf8" }).stderr || "");
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? Infinity }));
}

/** How much of the take a line should fill: its letters, plus a breath for each punctuation mark. */
function spokenWeight(text) {
  const letters = (text.match(/[\u0621-\u064A]/g) || []).length;
  const marks = (text.match(/[.،,:؟?!]/g) || []).length;
  return letters + 6 * marks;
}

/**
 * Where the take is cut into its lines. Among all the pauses, pick one per line break so that each
 * piece is about as long as its text says it should be, preferring the long pauses (a paragraph
 * break is longer than a breath inside a sentence). Plain dynamic programming over the pauses.
 */
function chooseCuts(pauses, total, weights) {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0);
  const expect = weights.map((w) => (total * w) / sum);
  const m = pauses.length;
  if (m < n - 1) throw new Error(`The take has ${m} pauses but ${n} lines — record it again.`);
  const len = (p) => p.end - p.start;
  const piece = (from, to, i) => ((to - from - expect[i]) ** 2) / Math.max(expect[i], 1);
  // best[i][j]: cheapest way to end line i at pause j.
  const best = Array.from({ length: n - 1 }, () => new Array(m).fill(Infinity));
  const back = Array.from({ length: n - 1 }, () => new Array(m).fill(-1));
  for (let j = 0; j < m; j++) best[0][j] = piece(0, pauses[j].start, 0) - 3 * len(pauses[j]);
  for (let i = 1; i < n - 1; i++) {
    for (let j = i; j < m; j++) {
      for (let k = i - 1; k < j; k++) {
        const cost = best[i - 1][k] + piece(pauses[k].end, pauses[j].start, i) - 3 * len(pauses[j]);
        if (cost < best[i][j]) { best[i][j] = cost; back[i][j] = k; }
      }
    }
  }
  let end = -1, low = Infinity;
  for (let j = n - 2; j < m; j++) {
    const cost = best[n - 2][j] + piece(pauses[j].end, total, n - 1);
    if (cost < low) { low = cost; end = j; }
  }
  const cuts = [];
  for (let i = n - 2, j = end; i >= 0; j = back[i][j], i--) cuts.unshift(pauses[j]);
  return cuts;
}

const voName = (n) => `vo-${String(n).padStart(2, "0")}.wav`;

async function recordVoice(beats, voDir) {
  const key = apiKey();
  const voice = arg("voice", "Charon");
  const model = arg("model", "gemini-2.5-flash-preview-tts");
  fs.mkdirSync(voDir, { recursive: true });
  const takeFile = path.join(voDir, "take.wav");
  if (!(has("reuse-take") && fs.existsSync(takeFile))) {
    console.log(`Voice: ${voice} (${model}), one take of ${beats.length} lines`);
    fs.writeFileSync(takeFile, await synthTake(beats.map((b) => b.say).join("\n\n"), voice, model, key));
  }
  const take = fs.readFileSync(takeFile);
  const rate = wavRate(take), total = wavSeconds(take);
  const pcm = take.subarray(44);
  const all = silences(takeFile, 0.25);
  const inner = all.filter((p) => p.start > 0.05 && p.end < total - 0.05);
  // The quiet before the first word and after the last one is not part of any line.
  const lead = all.find((p) => p.start <= 0.05), trail = all.find((p) => p.end >= total - 0.05);
  const begin = lead ? Math.max(0, lead.end - 0.08) : 0, finish = trail ? Math.min(total, trail.start + 0.2) : total;
  const cuts = chooseCuts(inner, total, beats.map((b) => spokenWeight(b.say)));
  // Each line keeps a little of the quiet around it, so no word is clipped.
  const edges = [begin, ...cuts.flatMap((c) => [Math.min(c.start + 0.12, c.end), Math.max(c.end - 0.08, c.start)]), finish];
  beats.forEach((b, i) => {
    const from = Math.floor(edges[2 * i] * rate) * 2, to = Math.floor(edges[2 * i + 1] * rate) * 2;
    fs.writeFileSync(path.join(voDir, voName(b.n)), pcmToWav(pcm.subarray(from, to), rate));
    const gap = i < cuts.length ? `  | then ${(cuts[i].end - cuts[i].start).toFixed(2)}s pause` : "";
    console.log(`  ${voName(b.n)}  ${((to - from) / 2 / rate).toFixed(2)}s  ${b.say.slice(0, 44)}${gap}`);
  });
  console.log(`Take: ${total.toFixed(1)}s, ${inner.length} pauses`);
  writeTimings(beats, voDir);
}

/** Has the model transcribe each cut line; a wrong cut shows as a line holding its neighbour's words. */
async function checkVoice(beats, voDir) {
  const key = apiKey();
  const model = arg("check-model", "gemini-flash-latest");
  const words = (s) => s.replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\u0621-\u064A\s]/g, " ").split(/\s+/).filter(Boolean);
  let worst = 1;
  for (const b of beats) {
    const wav = fs.readFileSync(path.join(voDir, voName(b.n)));
    const body = await gemini(model, {
      contents: [{ parts: [{ text: "اكتب بالحرف الكلام المنطوق في التسجيل ده، بالعربي زي ما اتقال، من غير أي إضافة أو شرح." }, { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } }] }],
      generationConfig: { temperature: 0 },
    }, key);
    const heard = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(" ").trim();
    const want = words(b.say), got = new Set(words(heard));
    const hit = want.filter((w) => got.has(w)).length / Math.max(want.length, 1);
    worst = Math.min(worst, hit);
    console.log(`${String(b.n).padStart(2)}  ${(hit * 100).toFixed(0).padStart(3)}%  script: ${b.say}\n          heard:  ${heard}`);
  }
  console.log(`\nLowest match: ${(worst * 100).toFixed(0)}%`);
}

/** The breaths inside one cut line, longest first is not the order: they are returned in time order. */
function innerPauses(file, seconds) {
  return silences(file, 0.3)
    .filter((p) => p.start > 0.05 && p.end < seconds - 0.05)
    .map((p) => ({ start: Number(p.start.toFixed(2)), end: Number(p.end.toFixed(2)) }));
}

/**
 * Where each sentence after the first starts inside a line. A line of S sentences has S-1 stops
 * between them; they are taken to be its S-1 longest pauses (a comma's breath is shorter than a
 * full stop's). [] when the voice did not pause that often — the caller falls back to an even split.
 */
function sentenceStarts(say, pauses) {
  const sentences = say.split(/[.؟?!]+/).filter((s) => s.trim()).length;
  if (sentences < 2 || pauses.length < sentences - 1) return [];
  return [...pauses].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, sentences - 1).sort((a, b) => a.start - b.start).map((p) => p.end);
}

/** timings.json is always rebuilt from the WAVs on disk, so it cannot go stale. */
function writeTimings(beats, voDir) {
  const lines = beats.map((b) => {
    const full = path.join(voDir, voName(b.n));
    if (!fs.existsSync(full)) throw new Error(`No narration for beat ${b.n} — run with --voice-only first.`);
    const seconds = Number(wavSeconds(fs.readFileSync(full)).toFixed(2));
    const pauses = innerPauses(full, seconds);
    return { n: b.n, file: voName(b.n), seconds, pauses, starts: sentenceStarts(b.say, pauses) };
  });
  fs.writeFileSync(path.join(voDir, "timings.json"), JSON.stringify({ lines }, null, 2));
  console.log(`Narration: ${lines.reduce((a, l) => a + l.seconds, 0).toFixed(1)}s over ${lines.length} lines`);
  return lines;
}

/* --- timeline ------------------------------------------------------------------------------ */

function buildTimeline(beats, lines, framesDir) {
  const scenes = [];
  let t = 0;
  for (const b of beats) {
    const line = lines.find((l) => l.n === b.n);
    const kind = b.card ? "card" : "step";
    const spoken = LEAD[kind] + line.seconds / TEMPO + TAIL[kind];
    const sc = { n: b.n, start: t, lead: LEAD[kind], vo: line.file, voSeconds: line.seconds / TEMPO };
    if (b.card) {
      // Where each sentence of the line starts, for the recap rows.
      Object.assign(sc, { card: b.card, dur: spoken, cues: line.starts.map((s) => LEAD.card + s / TEMPO) });
    } else {
      const shots = b.shots.map((s) => {
        const png = path.join(framesDir, `${s.frame}.png`);
        if (!fs.existsSync(png)) throw new Error(`Missing frame ${png}`);
        const meta = JSON.parse(fs.readFileSync(path.join(framesDir, `${s.frame}.json`), "utf8"));
        return { src: pathToFileURL(path.resolve(png)).href, box: meta.box, act: s.act || "look", caption: s.caption || "", spot: s.spot !== false, w: s.w || 1, min: MIN_SHOT[s.act || "look"] };
      });
      // A shot with "cue": k starts as sentence k+1 of the line starts, a touch early so the
      // picture is there first. No shot is squeezed below its minimum, so a late cue pushes the
      // ones after it. Without cues (or when the voice did not pause), shots share by weight.
      const cued = b.shots.some((s) => s.cue) && b.shots.every((s, i) => i === 0 || !s.cue || line.starts[s.cue - 1] !== undefined);
      if (b.shots.some((s) => s.cue) && !cued) console.warn(`Beat ${b.n}: not enough pauses for its cues — shots split evenly instead.`);
      let dur;
      if (cued) {
        shots.forEach((s, i) => {
          const floor = i === 0 ? 0 : shots[i - 1].at + shots[i - 1].min;
          const want = b.shots[i].cue ? LEAD.step + line.starts[b.shots[i].cue - 1] / TEMPO - 0.18 : floor;
          s.at = i === 0 ? 0 : Math.max(want, floor);
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
  // The lines go in untouched: no per-line levelling, or the one take would stop sounding like one.
  for (const s of scenes) add(path.join(voDir, s.vo), Math.round((s.start + s.lead) * 1000), `aresample=48000,aformat=channel_layouts=stereo,atempo=${TEMPO}`);
  for (const s of scenes) for (const shot of s.shots || []) {
    if (shot.act === "tap") add(click, Math.round((s.start + shot.at + shot.dur - TAP_BEFORE_END) * 1000), "volume=0.35");
  }
  const n = inputs.length / 2;
  const mix = Array.from({ length: n }, (_, i) => `[a${i}]`).join("") + `amix=inputs=${n}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(2)}[out]`;
  const graph = path.join(work, "audio-graph.txt");
  fs.writeFileSync(graph, [...filters, mix].join(";\n"));
  const raw = path.join(work, "narration-raw.wav");
  // ffmpeg 7+: "-/opt file" reads the option's value from a file.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-/filter_complex", graph, "-map", "[out]", "-t", total.toFixed(2), "-ar", "48000", raw]);
  // Loudness: measure the whole track once, then apply ONE fixed gain. A normaliser that rides the
  // level up and down makes a steady voice sound as if it keeps changing.
  const report = String(spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr || "");
  const measured = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));
  const gain = Math.min(-16 - Number(measured.input_i), -1.5 - Number(measured.input_tp));
  console.log(`Sound: ${measured.input_i} LUFS, peak ${measured.input_tp} dB -> one gain of ${gain.toFixed(1)} dB`);
  const out = path.join(work, "narration.wav");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, "-ar", "48000", out]);
  return out;
}

/* --- film ---------------------------------------------------------------------------------- */

async function main() {
  const lessonFile = arg("lesson");
  const voDir = arg("vo");
  const layoutName = arg("layout", "phone");
  const layout = LAYOUTS[layoutName];
  if (!lessonFile || !voDir) throw new Error("Pass --lesson <json> and --vo <dir>.");
  if (!layout) throw new Error(`Unknown --layout "${layoutName}" (phone or pc).`);
  const lesson = JSON.parse(fs.readFileSync(lessonFile, "utf8"));
  const beats = beatsFor(lesson, layoutName);
  if (has("voice-only")) return recordVoice(beats, voDir);
  if (has("check-voice")) return checkVoice(beats, voDir);

  const framesDir = arg("frames"), outFile = arg("out");
  const fps = Number(arg("fps", 30));
  if (!framesDir || !outFile) throw new Error("Pass --frames <dir> and --out <file.mp4>.");
  const lines = writeTimings(beats, voDir);
  const { scenes, total } = buildTimeline(beats, lines, framesDir);
  console.log(`${layoutName}: ${scenes.length} beats, ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`);
  if (has("show")) {
    for (const l of lines) console.log("line", l.n, l.seconds, "pauses", l.pauses.map((p) => `${p.start}-${p.end}`).join(" "), "| sentences at", l.starts.join(" "));
    for (const s of scenes) console.log(s.n, s.start.toFixed(2), s.dur.toFixed(2), s.card || (s.shots || []).map((x) => `${(s.start + x.at).toFixed(2)}+${x.dur.toFixed(2)}`).join(" "));
  }

  const font = (file) => pathToFileURL(path.join(ROOT, "src/fonts", file)).href;
  const config = {
    layout: layoutName, pointer: layout.pointer,
    lesson: { title: lesson.title, question: lesson.question, length: lesson.length, steps: lesson.steps, tip: lesson.tip },
    scenes, total,
    fonts: [
      { family: "Cairo", url: font("cairo-arabic-wght.woff2"), weight: "200 1000" },
      { family: "Cairo", url: font("cairo-latin-wght.woff2"), weight: "200 1000" },
      { family: "Montserrat", url: font("montserrat-latin-wght.woff2"), weight: "500 700" },
    ],
  };
  const work = path.join(path.dirname(path.resolve(outFile)), `.lesson-work-${layoutName}`);
  fs.mkdirSync(work, { recursive: true });

  const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT);
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: 1 });
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
