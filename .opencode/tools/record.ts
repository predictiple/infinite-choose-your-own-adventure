import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

const TOGGLE = path.join(os.tmpdir(), "opencode-record")

function pcmPath(projectDir: string) {
  return path.join(projectDir, ".opencode", "record.pcm")
}

function timestampSuffix(scene?: string) {
  const base = new Date().toISOString().slice(0, 19).replace("T", "_")
  return scene ? `${base}_${scene}` : base
}

function readCharactersPrefix(projectDir: string): string {
  const p = path.join(projectDir, ".opencode", "characters")
  try {
    const raw = fs.readFileSync(p, "utf-8")
    const unique = [...new Set(raw.trim().split("\n").filter(Boolean))]
    unique.sort()
    return unique.join("-")
  } catch {
    return "recording"
  }
}

function charactersLogPath(projectDir: string) {
  return path.join(projectDir, ".opencode", "characters")
}

function wavPath(projectDir: string, ts: string, prefix: string) {
  return path.join(projectDir, `${prefix}_${ts}.wav`)
}

function transcriptMdPath(projectDir: string, ts: string, prefix: string) {
  return path.join(projectDir, `${prefix}_${ts}.md`)
}

function teaserMdPath(projectDir: string, ts: string, prefix: string) {
  return path.join(projectDir, `${prefix}_${ts}_teaser.md`)
}

function transcriptLogPath(projectDir: string) {
  return path.join(projectDir, ".opencode", "transcript.jsonl")
}

function compileTranscript(projectDir: string): string {
  const logPath = transcriptLogPath(projectDir)
  let entries: { agent: string; text: string; ts: number }[]
  try {
    const raw = fs.readFileSync(logPath, "utf-8")
    entries = raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
  } catch { return "" }

  const lines: string[] = [`# Recording Transcript — ${new Date().toISOString().slice(0, 10)}`, ""]
  for (const e of entries) {
    if (e.agent === "narration") {
      lines.push(`*${e.text}*`, "")
    } else {
      lines.push(`**${e.agent}**: ${e.text}`, "")
    }
  }
  return lines.join("\n")
}

// ─── Dramatic Pause Engine ───────────────────────────────────────────────────

/** Keywords mapped to additional silence after an utterance. */
const DRAMA_PATTERNS: [RegExp, number][] = [
  [/\b43\s*million\b/i,         4.0],
  [/\bkill(ing|ed|s|er)?\b/i,   3.5],
  [/\bd(ea|ie)d\b/i,            3.5],
  [/\bdeath\b/i,                 3.5],
  [/\bgoodbye\b/i,               4.0],
  [/\bfriend\b/i,                3.5],
  [/\bsever(ed|ing)?\b/i,       3.5],
  [/\bburn(s|t|ing)?\b/i,       3.0],
  [/\blove(d)?\b/i,              3.0],
  [/\blying\b/i,                 3.0],
  [/\bconfess/i,                 3.0],
  [/\bbetray(ed|al)?\b/i,       3.0],
  [/\bsorry\b/i,                 2.5],
  [/\balone\b/i,                 2.5],
  [/\blonely\b/i,                2.5],
  [/\bafraid\b/i,                2.5],
  [/\bcry(ing)?\b/i,             2.5],
  [/\btruth\b/i,                 2.5],
  [/\bsecret\b/i,                2.5],
  [/\bexplosion\b/i,             2.5],
  [/\bdestroy(ed)?\b/i,         2.5],
  [/\bresponsible\b/i,           2.5],
  [/\baccountab(le|ility)\b/i,   2.5],
  [/\bfire\b/i,                  2.5],
  [/\bwar\b/i,                   2.0],
  [/\bbeautiful\b/i,             2.0],
  [/\bnebula\b/i,                2.0],
  [/\bstars?\b/i,                2.0],
  [/\bhope\b/i,                  2.0],
  [/\bglad\b/i,                  2.5],
];

function computePause(text: string, isEndingNarration: boolean): number {
  if (isEndingNarration) return 5.0;
  let maxWeight = 0;
  for (const [pattern, weight] of DRAMA_PATTERNS) {
    if (pattern.test(text) && weight > maxWeight) maxWeight = weight;
  }
  if (maxWeight >= 3.0) return maxWeight;
  if (maxWeight > 0) return Math.max(2.5, maxWeight);
  return 2.0;
}

// ─── Audio Post-Processing ───────────────────────────────────────────────────

interface SilenceRegion {
  start: number
  end: number
  duration: number
}

function getWavDuration(wav: string): number {
  const r = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    wav,
  ], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 })
  return parseFloat(r.stdout.toString().trim())
}

function detectSilence(wav: string): SilenceRegion[] {
  const r = spawnSync("ffmpeg", [
    "-i", wav,
    "-af", "silencedetect=noise=-30dB:d=0.3",
    "-f", "null",
    "-",
  ], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 })
  const output = r.stderr.toString()
  const regions: SilenceRegion[] = []
  let currentStart: number | null = null
  for (const line of output.split("\n")) {
    const sm = line.match(/silence_start:\s+([\d.]+)/)
    const em = line.match(/silence_end:\s+([\d.]+)/)
    if (sm) currentStart = parseFloat(sm[1])
    if (em && currentStart !== null) {
      const end = parseFloat(em[1])
      regions.push({ start: currentStart, end, duration: end - currentStart })
      currentStart = null
    }
  }
  return regions
}

function getNonSilenceRegions(silences: SilenceRegion[], totalDuration: number): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = []
  let cursor = 0
  for (const s of silences) {
    if (s.start > cursor) regions.push({ start: cursor, end: s.start })
    cursor = s.end
  }
  if (cursor < totalDuration) regions.push({ start: cursor, end: totalDuration })
  return regions
}

interface TranscriptEntry {
  agent: string
  text: string
  ts: number
}

function readTranscriptLog(projectDir: string): TranscriptEntry[] {
  const logPath = transcriptLogPath(projectDir)
  if (!fs.existsSync(logPath)) return []
  try {
    const raw = fs.readFileSync(logPath, "utf-8")
    return raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
  } catch { return [] }
}

/**
 * Apply dramatic pauses to a WAV file based on the transcript log.
 *
 * Steps:
 *  1. Parse transcript entries
 *  2. Detect silence gaps in the WAV to find utterance boundaries
 *  3. If gaps can't be found, estimate positions from text length
 *  4. For each utterance, compute a dramatic pause from its text content
 *  5. Split the WAV, pad each segment with trailing silence, and reassemble
 */
function addDramaticPauses(wav: string, projectDir: string): void {
  const entries = readTranscriptLog(projectDir)
  if (entries.length < 2) return // nothing to space out

  const duration = getWavDuration(wav)
  if (duration < 1) return

  const silences = detectSilence(wav)
  const speechRegions = getNonSilenceRegions(silences, duration)

  // Map speech regions to transcript entries
  type SpeechSegment = { start: number; end: number; agent: string; text: string }
  let segments: SpeechSegment[]

  if (speechRegions.length >= 1 && Math.abs(speechRegions.length - entries.length) <= 2) {
    // Good match — map sequentially
    const count = Math.min(speechRegions.length, entries.length)
    segments = []
    for (let i = 0; i < count; i++) {
      segments.push({ ...speechRegions[i], agent: entries[i].agent, text: entries[i].text })
    }
  } else {
    // Fallback: estimate utterance boundaries from text length
    const totalChars = entries.reduce((s, e) => s + e.text.length, 0)
    const secPerChar = duration / totalChars
    let cursor = 0
    segments = entries.map(e => {
      const segDuration = e.text.length * secPerChar
      const seg = { start: cursor, end: cursor + segDuration, agent: e.agent, text: e.text }
      cursor += segDuration
      return seg
    })
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pauses_"))

  try {
    const chunkFiles: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const isEndingNarration = seg.agent === "narration" && i === segments.length - 1

      // Extract this segment from the WAV
      const rawChunk = path.join(tmpDir, `raw_${i}.wav`)
      const segLen = seg.end - seg.start
      const trim = spawnSync("sox", [wav, rawChunk, "trim", String(seg.start), String(segLen)], {
        stdio: "ignore", timeout: 60_000,
      })
      if (trim.status !== 0) continue

      // Pad with trailing dramatic silence
      const pause = computePause(seg.text, isEndingNarration)
      const padded = path.join(tmpDir, `pad_${i}.wav`)
      const pad = spawnSync("sox", [rawChunk, padded, "pad", "0", String(pause)], {
        stdio: "ignore", timeout: 60_000,
      })
      if (pad.status !== 0) continue

      chunkFiles.push(padded)
    }

    if (chunkFiles.length > 1) {
      // Reassemble
      const tmpOut = wav + ".paused"
      const concat = spawnSync("sox", [...chunkFiles, tmpOut], {
        stdio: "ignore", timeout: 120_000,
      })
      if (concat.status === 0) {
        fs.unlinkSync(wav)
        fs.renameSync(tmpOut, wav)
      }
    }
  } finally {
    // Cleanup temp files
    for (const f of fs.readdirSync(tmpDir)) {
      try { fs.unlinkSync(path.join(tmpDir, f)) } catch {}
    }
    try { fs.rmdirSync(tmpDir) } catch {}
  }
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export default tool({
  description: "Toggle audio recording of TTS output to a WAV file. Call once to start recording, again to stop.",
  args: {
    action: tool.schema.enum(["start", "stop"]).optional().describe("Override: 'start' or 'stop'. If omitted, toggles."),
    scene: tool.schema.string().optional().describe("Scene path for hierarchy. Examples: '1', '1-1', '1-2', '1-2-1', '2'. Appended to filenames."),
    summary: tool.schema.string().optional().describe("Brief 1-paragraph teaser for this scene, written to a separate _teaser.md file"),
  },
  async execute(args, context) {
    const projectDir = context.directory
    const pcm = pcmPath(projectDir)
    const isActive = fs.existsSync(TOGGLE)

    if (args.action === "stop" || (!args.action && isActive)) {
      try { fs.unlinkSync(TOGGLE) } catch {}
      const ts = timestampSuffix(args.scene)
      const prefix = readCharactersPrefix(projectDir)

      // Save transcript
      const md = compileTranscript(projectDir)
      if (md) {
        const mdPath = transcriptMdPath(projectDir, ts, prefix)
        fs.writeFileSync(mdPath, md)
      }

      // Save teaser
      if (args.summary) {
        const teaser = `# Teaser — Scene ${args.scene || "?"}\n\n${args.summary}\n`
        fs.writeFileSync(teaserMdPath(projectDir, ts, prefix), teaser)
      }

      // Convert PCM to WAV
      if (!fs.existsSync(pcm)) return md ? "Transcript saved (no audio)" : "No audio recorded"
      const data = fs.readFileSync(pcm)
      try { fs.unlinkSync(pcm) } catch {}

      const sampleRate = 22050
      const bitsPerSample = 16
      const numChannels = 1
      const dataSize = data.length

      const wav = Buffer.alloc(44 + dataSize)
      wav.write("RIFF", 0)
      wav.writeUInt32LE(36 + dataSize, 4)
      wav.write("WAVE", 8)
      wav.write("fmt ", 12)
      wav.writeUInt32LE(16, 16)
      wav.writeUInt16LE(1, 20)
      wav.writeUInt16LE(numChannels, 22)
      wav.writeUInt32LE(sampleRate, 24)
      wav.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28)
      wav.writeUInt16LE(numChannels * bitsPerSample / 8, 32)
      wav.writeUInt16LE(bitsPerSample, 34)
      wav.write("data", 36)
      wav.writeUInt32LE(dataSize, 40)
      data.copy(wav, 44)

      const out = wavPath(projectDir, ts, prefix)
      fs.writeFileSync(out, wav)
      const dur = (dataSize / sampleRate / (bitsPerSample / 8)).toFixed(1)

      // ── Post-process: add dramatic pauses ──
      try {
        addDramaticPauses(out, projectDir)
      } catch (e) {
        console.error("Dramatic pause processing failed:", e)
      }

      // Clean up
      try { fs.unlinkSync(transcriptLogPath(projectDir)) } catch {}
      try { fs.unlinkSync(charactersLogPath(projectDir)) } catch {}

      const parts = [md ? "Transcript saved" : "", args.summary ? "Teaser saved" : "", `WAV saved to ${path.basename(out)} (${dur}s) — dramatic pauses applied`]
      return parts.filter(Boolean).join(" + ")
    }

    // Start recording
    fs.mkdirSync(path.join(projectDir, ".opencode"), { recursive: true })
    fs.writeFileSync(pcm, "")
    fs.writeFileSync(transcriptLogPath(projectDir), "")
    fs.writeFileSync(charactersLogPath(projectDir), "")
    fs.writeFileSync(TOGGLE, projectDir)
    return "Recording started — all TTS audio will be captured"
  },
})
