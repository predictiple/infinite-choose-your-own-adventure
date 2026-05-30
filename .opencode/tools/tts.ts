import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const TOGGLE_FILE = path.join(os.homedir(), ".config", "opencode", "tts-toggle")
const RECORD_TOGGLE = path.join(os.tmpdir(), "opencode-record")
const LOCK_DIR = path.join(os.homedir(), ".config", "opencode", "tts-lock")
const PIPER_BIN = "piper"
const AGENT_DIRS = [
  path.join(process.cwd(), ".opencode", "agents"),
  path.join(os.homedir(), ".config", "opencode", "agents"),
  path.join(os.homedir(), ".opencode", "agents"),
]

function resolveModelPath(modelFile: string): string | null {
  const projectPath = path.join(process.cwd(), "piper", modelFile)
  if (fs.existsSync(projectPath)) return projectPath
  const homePath = path.join(os.homedir(), "piper", modelFile)
  if (fs.existsSync(homePath)) return homePath
  return null
}

interface VoiceConfig {
  model: string
  speaker?: number
  extraArgs: string[]
}

function findAgentByVoice(voiceName: string): Record<string, unknown> | null {
  for (const baseDir of AGENT_DIRS) {
    try {
      for (const file of fs.readdirSync(baseDir)) {
        if (!file.endsWith(".md")) continue
        const agentName = file.slice(0, -3)
        const fm = parseFrontmatter(agentName)
        if (fm?.voice === voiceName) return fm
      }
    } catch {}
  }
  return null
}

function resolveVoiceConfig(voiceName: string): VoiceConfig | null {
  const fm = findAgentByVoice(voiceName)
  if (!fm) return null
  const piper = fm.piper
  if (typeof piper !== "object" || !piper) return null
  const model = (piper as Record<string, unknown>).model
  if (typeof model !== "string") return null
  const speaker = (piper as Record<string, unknown>).speaker
  return {
    model,
    speaker: typeof speaker === "number" ? speaker : undefined,
    extraArgs: agentPiperArgs(fm),
  }
}

function parseFrontmatter(agentName: string): Record<string, unknown> | null {
  for (const baseDir of [
    path.join(process.cwd(), ".opencode", "agents"),
    path.join(os.homedir(), ".config", "opencode", "agents"),
    path.join(os.homedir(), ".opencode", "agents"),
  ]) {
    try {
      const content = fs.readFileSync(path.join(baseDir, `${agentName}.md`), "utf-8")
      const m = content.match(/^---\n([\s\S]*?)\n---/)
      if (!m) continue
      const fm: Record<string, unknown> = {}
      for (const line of m[1].split("\n")) {
        const kv = line.match(/^(\w[\w-]*?):\s*(.*)/)
        if (!kv) continue
        const val = kv[2].trim()
        if (val === "") continue
        if (/^[{[]/.test(val)) {
          try { fm[kv[1]] = JSON.parse(val) } catch { fm[kv[1]] = val }
        } else {
          fm[kv[1]] = val.replace(/^"|"$/g, "")
        }
      }
      return fm
    } catch {}
  }
  return null
}

function agentVoiceFromProfile(fm: Record<string, unknown> | null): string | null {
  if (!fm) return null
  const v = fm["voice"]
  return typeof v === "string" ? v : null
}

function agentPiperArgs(fm: Record<string, unknown> | null): string[] {
  if (!fm) return []
  const piper = fm["piper"]
  if (!piper || typeof piper !== "object") return []
  const args: string[] = []
  const map: Record<string, string> = {
    sentence_silence: "--sentence_silence",
    length_scale: "--length_scale",
    noise_scale: "--noise_scale",
    noise_w: "--noise_w",
    volume: "--volume",
  }
  for (const [key, flag] of Object.entries(map)) {
    const val = (piper as Record<string, unknown>)[key]
    if (typeof val === "number" || typeof val === "string") {
      args.push(flag, String(val))
    }
  }
  return args
}

function resolveExtraArgs(defaults: string[], fm: Record<string, unknown> | null): string[] {
  const overrides = agentPiperArgs(fm)
  if (overrides.length === 0) return defaults
  const merged = new Map<string, string>()
  for (let i = 0; i < defaults.length; i += 2) {
    merged.set(defaults[i], defaults[i + 1])
  }
  for (let i = 0; i < overrides.length; i += 2) {
    merged.set(overrides[i], overrides[i + 1])
  }
  const result: string[] = []
  for (const [k, v] of merged) result.push(k, v)
  return result
}

function agentPauseMs(fm: Record<string, unknown> | null): number {
  const raw = fm?.["tts_pause"]
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.min(raw, 120000))
  return 10000
}

function resolveVoice(agent: string, fm: Record<string, unknown> | null, explicitVoice?: string): string {
  if (explicitVoice && findAgentByVoice(explicitVoice)) return explicitVoice
  const profileVoice = agentVoiceFromProfile(fm)
  if (profileVoice && findAgentByVoice(profileVoice)) return profileVoice
  const base = agent.replace(/-voice$/, "")
  if (findAgentByVoice(base)) return base
  return "talla"
}

async function acquireLock(agentName: string, maxWaitMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const stat = fs.statSync(LOCK_DIR)
      if (Date.now() - stat.mtimeMs > 120000) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true })
      }
    } catch {}
    try {
      fs.mkdirSync(LOCK_DIR)
      fs.writeFileSync(path.join(LOCK_DIR, "owner"), agentName)
      return true
    } catch {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150))
    }
  }
  return false
}

function releaseLock(): void {
  try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }) } catch {}
}

export default tool({
  description: "Speak text aloud using Piper text-to-speech. Synthesizes speech and plays through speakers. Detects voice from the calling agent's profile (voice: field in frontmatter) or uses explicit voice arg.",
  args: {
    text: tool.schema.string().describe("Text to speak aloud"),
    voice: tool.schema.string().optional().describe("Override voice (default: resolved from agent profile or talla)"),
    character: tool.schema.string().optional().describe("Character name for transcript instead of agent name"),
    silent: tool.schema.boolean().optional().describe("If true, write to recording file without audible playback"),
  },
  async execute(args, context) {
    const toggle = fs.existsSync(TOGGLE_FILE) ? fs.readFileSync(TOGGLE_FILE, "utf-8").trim() : ""
    if (toggle === "off") return "TTS muted"

    const fm = parseFrontmatter(context.agent)
    const voice = resolveVoice(context.agent, fm, args.voice)
    const config = resolveVoiceConfig(voice)
    if (!config) return `Voice "${voice}" not found`

    const modelPath = resolveModelPath(config.model)

    if (!modelPath) {
      return `Model not found: ${config.model} (checked project piper/ and ~/piper/)`
    }

    let line = args.text
      .replace(/\n/g, ". ")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/__[^_]+__/g, "")
      .replace(/\*[^*]+\*/g, "")
      .replace(/_[^_]+_/g, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\bMr\./g, "Mister")
      .replace(/\bMrs\./g, "Misses")
      .replace(/\bMs\./g, "Miz")
      .replace(/\bDr\./g, "Doctor")
      .replace(/\bProf\./g, "Professor")
      .replace(/\bSt\./g, "Saint")
      .replace(/\bJr\./g, "Junior")
      .replace(/\bSr\./g, "Senior")
      .replace(/\bvs\./g, "versus")
      .replace(/\bCapt\./g, "Captain")
      .replace(/\bLt\./g, "Lieutenant")
      .replace(/\bSgt\./g, "Sergeant")
      .replace(/\bCol\./g, "Colonel")
      .replace(/\bGen\./g, "General")
      .replace(/\bRev\./g, "Reverend")
      .replace(/\bGov\./g, "Governor")
      .replace(/\.{3,}/g, ". . . . . . . . . . . . . . . . . . ")
      .replace(/\s+/g, " ")
      .trim()
    if (!line) return "Nothing to speak"
    if (!/[.!?]$/.test(line)) line += "."

    const recordingProject: string | null = (() => {
      try { return fs.readFileSync(RECORD_TOGGLE, "utf-8").trim() || null } catch { return null }
    })()
    const recordPath = recordingProject ? path.join(recordingProject, ".opencode", "record.pcm") : null
    const transcriptPath = recordingProject ? path.join(recordingProject, ".opencode", "transcript.jsonl") : null
    const charactersPath = recordingProject ? path.join(recordingProject, ".opencode", "characters") : null
    if (transcriptPath) {
      const entry = JSON.stringify({agent: args.character || context.agent, text: line, ts: Date.now()}) + "\n"
      fs.appendFileSync(transcriptPath, entry)
    }
    if (charactersPath) fs.appendFileSync(charactersPath, voice + "\n")

    const locked = await acquireLock(context.agent, 30000)
    if (!locked) return "Another agent is speaking, try again later"

    return new Promise((resolve) => {
      try {
        const extraArgs = resolveExtraArgs(config.extraArgs, fm)
        const piperArgs = ["-m", modelPath, "--output_raw", ...extraArgs]
        if (config.speaker !== undefined) piperArgs.push("-s", String(config.speaker))

        const playProc = args.silent ? null : spawn("play", [
          "-t", "raw", "-r", "22050",
          "-e", "signed", "-b", "16", "-c", "1",
          "-q", "-",
        ], { stdio: ["pipe", "ignore", "ignore"] })

        const piperProc = spawn(PIPER_BIN, piperArgs, {
          stdio: ["pipe", "pipe", "ignore"],
        })

        context.abort.addEventListener("abort", () => {
          piperProc?.kill()
          playProc?.kill()
          releaseLock()
        })

        piperProc.stdout.on("data", (chunk) => {
          if (playProc?.stdin && !playProc.stdin.destroyed) playProc.stdin.write(chunk)
          if (recordPath) fs.appendFileSync(recordPath, chunk)
        })
        piperProc.on("close", () => {
          if (playProc?.stdin && !playProc.stdin.destroyed) playProc.stdin.end()
          if (recordPath) {
            const silence = Buffer.alloc(88200)
            fs.appendFileSync(recordPath, silence)
          }
          if (args.silent) {
            setTimeout(() => {
              releaseLock()
              resolve(`Recorded ${line.length} chars (${voice}, silent)`)
            }, agentPauseMs(fm))
          }
        })
        if (playProc) {
          playProc.on("close", () => {
            setTimeout(() => {
              releaseLock()
              resolve(`Spoke ${line.length} chars (${voice})`)
            }, agentPauseMs(fm))
          })
          playProc.on("error", () => { releaseLock(); resolve("Playback failed - install sox") })
        } else {
          piperProc.on("error", () => { releaseLock(); resolve("Piper process failed") })
        }

        if (piperProc?.stdin && !piperProc.stdin.destroyed) {
          piperProc.stdin.write(line + "\n")
          piperProc.stdin.end()
        }
      } catch (err) {
        releaseLock()
        resolve(`TTS error: ${err.message}`)
      }
    })
  },
})
