---
name: director-regenerator
description: Regenerate director session scenes into audio WAV files, transcripts, and teaser files using piper TTS CLI directly (no speaker playback). Use when the user asks to recreate, re-render, re-synthesize, or export director session recordings to files, or when they want clean recordings without audio playback.
---

# Director Session Regenerator

Regenerate director conversations as WAV + transcript + teaser files using piper TTS CLI directly to disk (no speaker playback). Creates **clean audio files** with **dramatic pauses** — silence between utterances is computed from the emotional weight of the dialogue, not a flat value.

Supports all director scene path formats: linear (`1`, `2`), branched (`1.2`, `1.2.1`), and replay (`1-r`, `2-r`). Each produces a distinct filename.

## Prerequisites

- `piper`, `sox`, `ffmpeg`, `bun` on your system path
- Voice model ONNX files in the project's `piper/` directory (or `~/piper/`)

## Workflow

### 1. Collect scene data from conversation

Extract all dialogue and narration segments from the director's conversation. Each scene needs:

- **scene** — the hierarchical scene path (e.g. `"1"`, `"1.2"`, `"3.1.1"`, `"2-r"`)
- **title** — short descriptive name
- **teaser** — one-paragraph summary (spoiler-light, hooks interest)
- **segments** — ordered list of all dialogue turns, narration blocks, and pauses

### 2. Format as JSON

Build one JSON file per scene:

```json
{
  "scene": "1.2",
  "title": "The Analysis",
  "teaser": "Isaac and Talla discuss the implications of synthetic consciousness...",
  "segments": [
    { "type": "dialogue", "voice": "isaac", "text": "Your emotional response is inefficient but... instructive." },
    { "type": "dialogue", "voice": "talla", "text": "I'll take that as a compliment, Issac." },
    { "type": "pause", "duration": 1.0 },
    { "type": "narration", "text": "Talla crosses her arms, a smug grin spreading across her face." }
  ]
}
```

Segment types:
| Type | Fields | Audio | Transcript |
|------|--------|-------|------------|
| `"pause"` | `duration` (seconds) | Silence gap | Skipped |
| `"dialogue"` | `voice`, `text`, optional `character` | Piper TTS + dramatic pause | `**Character**: text` |
| `"narration"` | `text` | Last narration gets 5s closing silence | `*text*` (italic) |

### 3. Run the script

```bash
bun .opencode/skills/director-regenerator/scripts/regenerate.ts path/to/scene1.json
```

Pass multiple JSON files — each builds independently. The script logs the computed pause for each segment.

### 4. Output files

Written to the current project directory. All scene paths produce distinct filenames:

| Scene `"1"` | Scene `"1.2"` | Scene `"1-r"` |
|---|---|---|
| `recording_TIMESTAMP_s1.wav` | `recording_TIMESTAMP_s1.2.wav` | `recording_TIMESTAMP_s1-r.wav` |
| `recording_TIMESTAMP_s1.md` | `recording_TIMESTAMP_s1.2.md` | `recording_TIMESTAMP_s1-r.md` |
| `recording_TIMESTAMP_s1_teaser.md` | `recording_TIMESTAMP_s1.2_teaser.md` | `recording_TIMESTAMP_s1-r_teaser.md` |

## Dramatic Pauses

The silence after each utterance is computed dynamically from the dialogue text, not a flat value. This gives the audio a natural, cinematic rhythm.

### Keyword → Pause Map

| Keywords | Pause | When |
|----------|-------|------|
| *(no keywords)* | **2.0s** | Default between speakers |
| `beautiful`, `hope`, `war`, `stars`, `nebula` | **2.5s** | Moderate emotional weight |
| `sorry`, `alone`, `cry`, `afraid`, `truth`, `secret`, `destroy`, `fire`, `explosion` | **2.5s** | Tension / vulnerability |
| `love`, `lying`, `confess`, `betray`, `burn` | **3.0s** | High drama |
| `friend`, `sever` | **3.5s** | Deep connection / loss |
| `kill`, `dead`, `death` | **3.5s** | Death / violence |
| `goodbye` | **4.0s** | Farewell |
| `43 million` | **4.0s** | Existential weight |
| *(ending narration)* | **5.0s** | Scene close |

When multiple keywords match, the **highest weight** wins.

### Explicit pauses

Manual `"pause"` segments are inserted as-is alongside the automatic dramatic pauses after each dialogue.

## Supported Voices

| Voice Key | Character | Model File |
|-----------|-----------|------------|
| `isaac` | Isaac | `isaac_1-0_4800.onnx` |
| `talla` | Talla Keyali | `talla_1-0_3900.onnx` |

For voices not listed, add them to `VOICE_MODELS` in `scripts/regenerate.ts`.

## Adding New Voices

1. Place `.onnx` and `.onnx.json` in the project's `piper/` directory (or `~/piper/`)
2. Add entry to `VOICE_MODELS` in `scripts/regenerate.ts`
3. Use the new voice key in your JSON segments
