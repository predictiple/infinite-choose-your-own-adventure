#!/usr/bin/env bun
/**
 * Regenerate a director session scene as audio + transcript + teaser files.
 *
 * Usage:
 *   bun .opencode/skills/director-regenerator/scripts/regenerate.ts <scene-json-file>
 *
 * Input JSON format (array of segments):
 * [
 *   { "type": "pause", "duration": 1.0 },
 *   { "type": "dialogue", "voice": "isaac", "character": "Isaac", "text": "..." },
 *   { "type": "narration", "text": "..." }
 * ]
 *
 * Dramatic pauses: after each dialogue segment, the script analyzes the text
 * for emotional weight and inserts a proportional silence for natural pacing.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import os from "os";

// ─── Configuration ───────────────────────────────────────────────────────────

const PIPER = "piper";
const SOX = "/usr/bin/sox";
const WORK_DIR = process.cwd();
const SAMPLE_RATE = 22050;

function resolveModelFile(name: string): string {
  const projectPath = join(process.cwd(), "piper", name);
  if (existsSync(projectPath)) return projectPath;
  return join(os.homedir(), "piper", name);
}

const VOICE_MODELS: Record<string, { model: string; config: string; name: string }> = {
  isaac: {
    model: resolveModelFile("isaac_1-0_4800.onnx"),
    config: resolveModelFile("isaac_1-0_4800.onnx.json"),
    name: "Isaac",
  },
  talla: {
    model: resolveModelFile("talla_1-0_3900.onnx"),
    config: resolveModelFile("talla_1-0_3900.onnx.json"),
    name: "Talla Keyali",
  },
};

// ─── Dramatic Pause Engine ────────────────────────────────────────────────────

const DRAMA_PATTERNS: [RegExp, number][] = [
  [/\b43\s*million\b/i,                     4.0],
  [/\bkill(ing|ed|s|er)?\b/i,                3.5],
  [/\bd(ea|ie)d\b/i,                         3.5],
  [/\bdeath\b/i,                             3.5],
  [/\bburn(s|t|ing)?\b/i,                    3.0],
  [/\bfire\b/i,                              2.5],
  [/\bexplosion\b/i,                         2.5],
  [/\bcollaps(e|ed)\b/i,                     2.5],
  [/\bdestroy(ed)?\b/i,                      2.5],
  [/\bwar\b/i,                               2.0],
  [/\bfriend\b/i,                            3.5],
  [/\bgoodbye\b/i,                           4.0],
  [/\bsever(ed|ing)?\b/i,                    3.5],
  [/\blove(d)?\b/i,                          3.0],
  [/\bsorry\b/i,                             2.5],
  [/\balone\b/i,                             2.5],
  [/\blonely\b/i,                            2.5],
  [/\bafraid\b/i,                            2.5],
  [/\bcry(ing)?\b/i,                         2.5],
  [/\bglad\b/i,                              2.5],
  [/\blying\b/i,                             3.0],
  [/\btruth\b/i,                             2.5],
  [/\bconfess/i,                             3.0],
  [/\bsecret\b/i,                            2.5],
  [/\bbetray(ed|al)?\b/i,                    3.0],
  [/\btrap\b/i,                              2.5],
  [/\bbeautiful\b/i,                         2.0],
  [/\bnebula\b/i,                            2.0],
  [/\bstars?\b/i,                            2.0],
  [/\bhope\b/i,                              2.0],
  [/\blight\b/i,                             2.0],
  [/\bresponsibili(ty|ties)\b/i,             2.5],
  [/\bacountab(le|ility)\b/i,                2.5],
  [/\bprotocol\b/i,                          2.0],
  [/\bhumanity\b/i,                          2.0],
  [/\bbelongs?\b/i,                          2.0],
  [/\bendur(e|es|ed)\b/i,                    2.0],
];

function computePause(text: string, isEndingNarration: boolean): number {
  if (isEndingNarration) return 5.0;
  let maxWeight = 0;
  for (const [pattern, weight] of DRAMA_PATTERNS) {
    if (pattern.test(text)) {
      if (weight > maxWeight) maxWeight = weight;
    }
  }
  if (maxWeight >= 3.0) return maxWeight;
  if (maxWeight > 0) return Math.max(2.5, maxWeight);
  return 2.0;
}

// ─── Segment Type ────────────────────────────────────────────────────────────

interface PauseSegment { type: "pause"; duration: number }
interface DialogueSegment { type: "dialogue"; voice: string; character?: string; text: string }
interface NarrationSegment { type: "narration"; text: string }
type Segment = PauseSegment | DialogueSegment | NarrationSegment;

interface SceneData {
  scene: string;
  title: string;
  teaser: string;
  segments: Segment[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}:${min}:${s}`;
}

function createSilence(durationSec: number, outputPath: string): void {
  const result = spawnSync("ffmpeg", [
    "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
    "-t", String(durationSec),
    "-acodec", "pcm_s16le",
    "-ar", String(SAMPLE_RATE),
    "-ac", "1",
    "-y", outputPath,
  ], { stdio: "ignore", timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg silence generation failed (exit ${result.status})`);
  }
}

function synthesizeDialogue(text: string, voiceKey: string, outputPath: string): void {
  const voice = VOICE_MODELS[voiceKey];
  if (!voice) {
    throw new Error(`Unknown voice: ${voiceKey}. Available: ${Object.keys(VOICE_MODELS).join(", ")}`);
  }
  const result = spawnSync(PIPER, [
    "--model", voice.model,
    "--config", voice.config,
    "--output-file", outputPath,
  ], {
    input: text,
    stdio: ["pipe", "ignore", "pipe"],
    timeout: 120_000,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().slice(0, 200) || "unknown error";
    throw new Error(`piper failed (exit ${result.status}): ${stderr}`);
  }
}

function concatenateWavs(inputFiles: string[], outputPath: string): void {
  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }
  const result = spawnSync(SOX, [...inputFiles, outputPath], {
    stdio: "ignore",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`sox concatenation failed (exit ${result.status})`);
  }
}

function getFileSizeMb(path: string): string {
  const stats = existsSync(path) ? readFileSync(path).length : 0;
  return (stats / (1024 * 1024)).toFixed(1);
}

// ─── Scene Builder ───────────────────────────────────────────────────────────

function buildScene(sceneData: SceneData): string {
  const timestamp = getTimestamp();
  const tempDir = join(WORK_DIR, `.tmp_${randomUUID().slice(0, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  const segmentFiles: string[] = [];
  let segIndex = 0;

  const allNonPause = sceneData.segments.filter(s => s.type !== "pause") as (DialogueSegment | NarrationSegment)[];

  console.log(`\nBuilding scene ${sceneData.scene}: ${sceneData.title}`);

  for (let s = 0; s < sceneData.segments.length; s++) {
    const seg = sceneData.segments[s];

    switch (seg.type) {
      case "pause": {
        const outPath = join(tempDir, `seg_${String(segIndex).padStart(3, "0")}.wav`);
        createSilence(seg.duration, outPath);
        segmentFiles.push(outPath);
        console.log(`  [pause]      ${seg.duration}s`);
        segIndex++;
        break;
      }

      case "dialogue": {
        const voice = VOICE_MODELS[seg.voice];
        const charName = seg.character || voice?.name || seg.voice;
        const outPath = join(tempDir, `seg_${String(segIndex).padStart(3, "0")}.wav`);
        const preview = seg.text.length > 70 ? seg.text.slice(0, 70) + "..." : seg.text;
        console.log(`  [dialogue]   ${charName} (pause: ${computePause(seg.text, false).toFixed(1)}s)`);
        synthesizeDialogue(seg.text, seg.voice, outPath);
        segmentFiles.push(outPath);
        segIndex++;

        const pauseDuration = computePause(seg.text, false);
        if (pauseDuration > 0) {
          const silencePath = join(tempDir, `seg_${String(segIndex).padStart(3, "0")}.wav`);
          createSilence(pauseDuration, silencePath);
          segmentFiles.push(silencePath);
          segIndex++;
        }
        break;
      }

      case "narration": {
        const preview = seg.text.length > 70 ? seg.text.slice(0, 70) + "..." : seg.text;
        const idxInNonPause = allNonPause.indexOf(seg);
        const isEndingNarration = idxInNonPause === allNonPause.length - 1;
        console.log(`  [narration]  ${preview} (pause: ${computePause(seg.text, isEndingNarration).toFixed(1)}s)`);

        if (isEndingNarration) {
          const silencePath = join(tempDir, `seg_${String(segIndex).padStart(3, "0")}.wav`);
          createSilence(5.0, silencePath);
          segmentFiles.push(silencePath);
          segIndex++;
        }
        break;
      }
    }
  }

  const outputWav = join(WORK_DIR, `recording_${timestamp}_s${sceneData.scene}.wav`);
  if (segmentFiles.length > 0) {
    console.log(`\n  Concatenating ${segmentFiles.length} segments with sox...`);
    concatenateWavs(segmentFiles, outputWav);
    console.log(`  -> ${outputWav} (${getFileSizeMb(outputWav)} MB)`);
  } else {
    console.log("  (no audio segments to concatenate)");
  }

  const transcriptLines: string[] = [];
  transcriptLines.push(`# Scene ${sceneData.scene}: ${sceneData.title}`);
  transcriptLines.push("");

  for (const seg of sceneData.segments) {
    switch (seg.type) {
      case "narration":
        transcriptLines.push(`*${seg.text}*`);
        transcriptLines.push("");
        break;
      case "dialogue": {
        const voice = VOICE_MODELS[seg.voice];
        const charName = seg.character || voice?.name || seg.voice;
        transcriptLines.push(`**${charName}**: ${seg.text}`);
        transcriptLines.push("");
        break;
      }
    }
  }

  const transcriptPath = join(WORK_DIR, `recording_${timestamp}_s${sceneData.scene}.md`);
  writeFileSync(transcriptPath, transcriptLines.join("\n"));
  console.log(`  -> ${transcriptPath}`);

  const teaserPath = join(WORK_DIR, `recording_${timestamp}_s${sceneData.scene}_teaser.md`);
  writeFileSync(teaserPath, sceneData.teaser + "\n");
  console.log(`  -> ${teaserPath}`);

  for (const f of segmentFiles) {
    try { rmSync(f, { force: true }); } catch { }
  }
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { }

  return outputWav;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: bun .opencode/skills/director-regenerator/scripts/regenerate.ts <scene-json-file>");
    console.error("       bun .opencode/skills/director-regenerator/scripts/regenerate.ts <scene-json-file> [scene-json-file-2 ...]");
    process.exit(1);
  }

  for (const jsonPath of args) {
    if (!existsSync(jsonPath)) {
      console.error(`File not found: ${jsonPath}`);
      process.exit(1);
    }

    const raw = readFileSync(jsonPath, "utf-8");
    const sceneData: SceneData = JSON.parse(raw);

    if (!sceneData.scene || !sceneData.title || !sceneData.teaser || !sceneData.segments) {
      console.error(`Invalid scene data in ${jsonPath}: must have scene, title, teaser, segments`);
      process.exit(1);
    }

    buildScene(sceneData);
  }
}

main();
