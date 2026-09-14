/**
 * Cuts the promo reel together from one continuous screen take plus the synthesised narration.
 *
 *   node scripts/assemble-promo.mjs --rec <rec dir> --vo <vo dir> --out <file.mp4>
 *
 * The narration is the master clock, not the script's guide timings: each beat's video is cut to
 * that beat's measured voice length, so a line that ran long is never clipped mid-word. Where a
 * voice line outlasts the footage recorded for it, the final frame is held rather than letting
 * the cut run on into the next page's navigation.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FFMPEG = "ffmpeg";
/** A breath between lines. Also covers the crossfade, so cuts never land on a syllable. */
const GAP = 0.35;
const XFADE = 0.25;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function run(args) {
  execFileSync(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
}

function main() {
  const recDir = arg("rec");
  const voDir = arg("vo");
  const outFile = arg("out");
  if (!recDir || !voDir || !outFile) throw new Error("Pass --rec, --vo and --out.");

  const { video, cuts } = JSON.parse(fs.readFileSync(path.join(recDir, "cuts.json"), "utf8"));
  const { lines } = JSON.parse(fs.readFileSync(path.join(voDir, "timings.json"), "utf8"));
  if (!fs.existsSync(video)) throw new Error(`Master take missing: ${video}`);

  const work = path.join(recDir, "segments");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const segments = [];
  for (const line of lines) {
    const cut = cuts.find((c) => c.n === line.n);
    if (!cut) throw new Error(`No footage recorded for beat ${line.n}`);

    const want = line.seconds + GAP;
    const have = (cut.endMs - cut.startMs) / 1000;
    const take = Math.min(want, have);
    const holdFor = want - take; // frames to freeze on the end, when the voice outlasts the shot

    const vPath = path.join(work, `seg-${String(line.n).padStart(2, "0")}.mp4`);
    const filters = [
      "scale=1920:1080:force_original_aspect_ratio=decrease",
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
      "fps=30",
    ];
    // tpad clones the last frame; without it a short shot would simply end early and the
    // concatenated audio would drift out of sync with every beat that follows.
    if (holdFor > 0.05) filters.push(`tpad=stop_mode=clone:stop_duration=${holdFor.toFixed(2)}`);

    run([
      "-y", "-loglevel", "error",
      "-ss", (cut.startMs / 1000).toFixed(2),
      "-t", take.toFixed(2),
      "-i", video,
      "-vf", filters.join(","),
      "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      vPath,
    ]);

    // The matching audio: the line, then silence across the gap.
    const aPath = path.join(work, `seg-${String(line.n).padStart(2, "0")}.wav`);
    run([
      "-y", "-loglevel", "error",
      "-i", path.join(voDir, line.file),
      "-af", `apad=pad_dur=${GAP}`,
      "-ar", "48000", "-ac", "2",
      aPath,
    ]);

    segments.push({ n: line.n, video: vPath, audio: aPath, seconds: want });
    console.log(`  beat ${String(line.n).padStart(2)}  ${want.toFixed(2)}s${holdFor > 0.05 ? `  (held ${holdFor.toFixed(2)}s)` : ""}`);
  }

  const listFile = (key) => {
    const f = path.join(work, `${key}.txt`);
    fs.writeFileSync(f, segments.map((s) => `file '${s[key].replace(/\\/g, "/")}'`).join("\n"));
    return f;
  };

  const vConcat = path.join(work, "video.mp4");
  const aConcat = path.join(work, "audio.wav");
  run(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile("video"), "-c", "copy", vConcat]);
  run(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile("audio"), "-c", "copy", aConcat]);

  // Baseline H.264 + AAC in an mp4 with faststart: what WhatsApp will accept without re-encoding
  // it into mush, and what plays on an iPhone as well as an Android.
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  run([
    "-y", "-loglevel", "error",
    "-i", vConcat, "-i", aConcat,
    "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-preset", "medium", "-crf", "21",
    "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    "-shortest",
    outFile,
  ]);

  const total = segments.reduce((a, b) => a + b.seconds, 0);
  const mb = fs.statSync(outFile).size / 1e6;
  console.log(`\n${outFile}`);
  console.log(`${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}  ·  ${mb.toFixed(1)} MB`);
  if (XFADE) { /* reserved: crossfades need a filter_complex rebuild, hard cuts read fine at this pace */ }
}

main();
