/**
 * Joins the walkthrough's parts into one video, with a title card in front of each.
 *
 *   node scripts/concat-promo.mjs --out <file.mp4> --parts <a.mp4,b.mp4,...> [--titles "<t1|t2|...>"]
 *
 * Parts are recorded and verified one at a time — a missed click costs one part, not fifteen
 * minutes — and stitched here. Every input is re-encoded to one shared profile before the join:
 * the concat demuxer with stream copy demands identical codec parameters, and a part rebuilt
 * later with a different encoder setting would otherwise fail the join, or worse, play with
 * drifting audio.
 *
 * Title cards are rendered by make-promo-subs.py's sibling function (same font, same Arabic
 * shaping) as 2.5-second stills: in a twelve-part video, a card is how a dentist skipping ahead
 * knows where they are.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
function run(bin, args) { execFileSync(bin, args, { stdio: ["ignore", "ignore", "pipe"] }); }

const out = arg("out");
const parts = (arg("parts") || "").split(",").map((s) => s.trim()).filter(Boolean);
const titles = (arg("titles") || "").split("|").map((s) => s.trim());
if (!out || !parts.length) throw new Error("Pass --out and --parts.");
for (const p of parts) if (!fs.existsSync(p)) throw new Error(`Missing part: ${p}`);

const work = path.join(path.dirname(path.resolve(out)), ".concat-work");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const pieces = [];
parts.forEach((p, i) => {
  const title = titles[i];
  if (title) {
    const png = path.join(work, `card-${i}.png`);
    run("python", ["scripts/make-promo-subs.py", "--card", title, "--out-file", png]);
    const card = path.join(work, `card-${i}.mp4`);
    // A still with silent audio, so every piece carries the same two streams.
    run("ffmpeg", [
      "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-t", "2.5", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", card,
    ]);
    pieces.push(card);
  }
  const norm = path.join(work, `part-${i}.mp4`);
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", p,
    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", norm,
  ]);
  pieces.push(norm);
});

const list = path.join(work, "list.txt");
fs.writeFileSync(list, pieces.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);

const mb = fs.statSync(out).size / 1e6;
console.log(`${out}  ·  ${parts.length} parts  ·  ${mb.toFixed(1)} MB`);
