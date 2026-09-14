/**
 * Synthesises the promo reel narration from docs/marketing/promo-reel-script.md.
 *
 *   node scripts/make-promo-voice.mjs --out <dir> [--voice Charon]
 *
 * One WAV per table row, named vo-00.wav .. vo-18.wav, plus timings.json holding the
 * measured duration of each line. The clip lengths are cut to match these, not the other
 * way round — a voice line that runs long must not get clipped mid-word.
 *
 * Reads GEMINI_API_KEY from .env.local, same key the assistant uses.
 */
import fs from "node:fs";
import path from "node:path";

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

/** Pulls the narration column out of the script's markdown table, in order. */
function readLines() {
  const md = fs.readFileSync("docs/marketing/promo-reel-script.md", "utf8");
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // | n | time | screen | narration |  ->  ["", n, time, screen, narration, ""]
    // | n | time | screen | narration (EN) | subtitle (AR) |  ->  7 cells with the empty ends
    if (cells.length < 7) continue;
    if (!/^\d+$/.test(cells[1])) continue;
    rows.push({ n: Number(cells[1]), time: cells[2], screen: cells[3], text: cells[4], subtitle: cells[5] });
  }
  if (!rows.length) throw new Error("No table rows found in the script.");
  return rows;
}

const MODEL = "gemini-2.5-flash-preview-tts";

async function synth(text, voice, apiKey) {
  // Steering the read: the model follows a plain instruction prefix, and without one it
  // drifts to a formal MSA newsreader cadence that sounds nothing like a dentist talking.
  const prompt = `Read this in a warm, confident, matter-of-fact voice, at a normal speaking pace, like someone explaining their own product to a colleague. Do not sound like an advertisement:\n\n${text}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, attempt * 4000));
        continue;
      }
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
    }
    const body = await res.json();
    const inline = body?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) { await new Promise((r) => setTimeout(r, attempt * 3000)); continue; }
    const rate = Number((String(inline.mimeType || "").match(/rate=(\d+)/) || [])[1] || 24000);
    return pcmToWav(Buffer.from(inline.data, "base64"), rate);
  }
  throw new Error("Gemini returned no audio after 4 attempts.");
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const outDir = args[args.indexOf("--out") + 1];
  if (!outDir || outDir.startsWith("--")) throw new Error("Pass --out <dir>.");
  const voice = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "Charon";
  const only = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY missing from .env.local");

  fs.mkdirSync(outDir, { recursive: true });
  const rows = readLines().filter((r) => only === null || r.n === only);
  console.log(`Voice: ${voice} — ${rows.length} line(s)`);

  const timings = [];
  for (const row of rows) {
    const name = `vo-${String(row.n).padStart(2, "0")}.wav`;
    const dest = path.join(outDir, name);
    const wav = await synth(row.text, voice, key);
    fs.writeFileSync(dest, wav);
    // 44-byte header, 16-bit mono: duration falls straight out of the payload size.
    const rate = wav.readUInt32LE(24);
    const seconds = (wav.length - 44) / (rate * 2);
    timings.push({ n: row.n, file: name, seconds: Number(seconds.toFixed(2)), screen: row.screen, text: row.text, subtitle: row.subtitle });
    console.log(`  ${name}  ${seconds.toFixed(2)}s  ${row.screen}`);
  }

  if (only === null) {
    fs.writeFileSync(path.join(outDir, "timings.json"), JSON.stringify({ voice, lines: timings }, null, 2));
    const total = timings.reduce((a, b) => a + b.seconds, 0);
    console.log(`\nTotal narration: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
