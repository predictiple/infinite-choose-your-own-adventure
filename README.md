# Infinite Choose-Your-Own-Adventure

You are a movie director! Your actors are AI agents with distinct
voices, personalities, and backstories. The **`director`** is your
assistant director: you tell it the scene you want, and it calls the actors,
records the audio, and writes the transcript.

It works like a radio play. You guide the action, suggest dialogue, or sit
back and watch the characters interact. Every scene branches — pick a path
and see where it goes, then rewind and try another branch. Each branch
produces its own WAV file, formatted transcript, and teaser summary that
you can share or re-render later.

Uses the still-excellent [Piper TTS](https://github.com/rhasspy/piper)
for speech synthesis.

## System Overview

- **`director`** (`.opencode/agents/director.md`) orchestrates conversations between voiced agents
- **tts tool** (`.opencode/tools/tts.ts`) synthesizes speech via [Piper TTS](https://github.com/rhasspy/piper)
- **record tool** (`.opencode/tools/record.ts`) captures audio, transcripts, and teasers
- **log tool** (`.opencode/tools/log.ts`) writes narration to transcript
- **Director Regenerator skill** (`.opencode/skills/director-regenerator/`) re-renders scenes to clean audio files
- **Add Character skill** (`.opencode/skills/add-character/`) adds new voiced agents
- **Switch Director skill** (`.opencode/skills/switch-director/`) changes the director's voice/personality

### Session Flow

```
 User              `director`          Tools             TTS Voice
  │                    │                  │                  │
  │  "start a scene"   │                  │                  │
  │───────────────────>│                  │                  │
  │                    │                  │                  │
  │                    │  record(start)   │                  │
  │                    │─────────────────>│                  │
  │                    │                  │                  │
  │                    │  log("Bridge...")│                  │
  │                    │─────────────────>│                  │
  │                    │                  │                  │
  │                    │  tts(voice=talla)│                  │
  │                    │────────────────────────────────────>│━ Talla speaks
  │                    │                  │                  │
  │                    │  log("Isaac...") │                  │
  │                    │─────────────────>│                  │
  │                    │                  │                  │
  │                    │  tts(voice=isaac)│                  │
  │                    │────────────────────────────────────>│━ Isaac speaks
  │                    │                  │                  │
  │                    │  tts(voice=talla)│                  │
  │                    │────────────────────────────────────>│━ Talla speaks
  │                    │                  │                  │
  │                    │  record(stop)    │                  │
  │                    │─────────────────>│                  │
  │                    │                  │                  │
  │  daniel4500-isaac_1.wav               │                  │
  │  daniel4500-isaac_1.md                │                  │
  │  daniel4500-isaac_1_teaser.md         │                  │
```

## Cool Features

- **Silent mode** — Pass `silent: true` on any `tts` call to write audio to
  the recording WAV without playing through speakers. Use it to record a scene
  without disturbance, or batch-render dialogue silently.

- **Dramatic pauses** — The `record` tool post-processes WAV files with
  content-aware silence. Keywords like *kill*, *death*, *goodbye*, *love*,
  *betrayal*, *confess*, *explosion* trigger 2–4 seconds of trailing silence.
  The audio is split per-utterance, padded, and reassembled so the pacing
  matches the emotional weight.

- **Per-agent voice tuning** — Each agent profile can set Piper parameters
  (`sentence_silence`, `length_scale`, `noise_scale`, `noise_w`, `volume`)
  in its frontmatter. Characters can speak faster, slower, or with different
  cadences without changing voice models.

- **Lock & queue** — A filesystem mutex ensures only one agent speaks at a
  time. If Isaac and Talla are both triggered simultaneously, the second
  waits for the first to finish — no overlapping audio.

- **Abbreviation expansion** — TTS preprocesses text to expand titles
  (*Mr.* → Mister, *Dr.* → Doctor, *Capt.* → Captain, *Sgt.* → Sergeant)
  and ellipsis (`...`) into extended pauses for more natural speech.

- **Voice discovery from frontmatter** — Add a new character with a new
  `.onnx` model by dropping the files in `piper/` and setting `voice:` +
  `piper.model:` in the agent's markdown. No code changes needed.

- **Scene recording with branching** — Each call to `record(stop)` produces
  three files per scene: a `.wav` (audio), a `.md` (formatted transcript with
  narration and dialogue), and a `_teaser.md` (one-paragraph summary). The
  `scene` parameter supports hierarchical paths like `1`, `1-1`, `1-2`, `1-2-1`,
  or `2` — so every branch of a choose-your-own-adventure session produces its
  own playable, shareable scene files. The `director` automatically ends
  the scene when the conversation reaches a natural conclusion — a decision
  point, a dramatic pause, or a transition — then presents 4 auto-generated
  proposals for the next scene. Pick one, or describe your own — the `director`
  adapts.

```
Branching session example:

                         record(scene="1")
                         ┌──────────────────────────┐
                         │ Scene 1: On the Bridge   │
                         │ *_1.wav + *_1.md + teaser│
                         └────────────┬─────────────┘
                                      │
               ┌──────────────────────┼──────────────────┐
               │ "Follow Talla"       │                  │ "Stay put"
               │                      │                  │
    record(scene="1-1")               │    record(scene="1-2")
    ┌────────────────────────┐        │    ┌─────────────────────────┐
    │ Scene 1-1: Turbolift   │        │    │ Scene 1-2: Observation  │
    │ *_1-1.wav / .md / teas │        │    │ Lounge                  │
    └───────────┬────────────┘        │    │ *_1-2.wav / .md / teas  │
                │                     │    └────────────┬────────────┘
       ┌────────┼────────┐           ...                │
       │"Go up" │"Down"  │                    ┌─────────┼─────────┐
       │        │        │                    │"Investigate"│"Ignore"
  sc="1-1-1"  sc="1-1-2"              sc="1-2-1"     sc="1-2-2"
```

Each node generates a self-contained trio of files:
`{characters}_{timestamp}_{scene}.wav`,
`{characters}_{timestamp}_{scene}.md`,
`{characters}_{timestamp}_{scene}_teaser.md`.

## Prerequisites

- [opencode](https://opencode.ai)
- [Piper TTS](https://github.com/rhasspy/piper)
- [sox](http://sox.sourceforge.net/)
- [ffmpeg](https://ffmpeg.org/)
- [bun](https://bun.sh/)

All executables must be available on your system's search path.

## Setup

### YOLO: Let OpenCode install it

If you have opencode and prerequisites already installed, copy and paste this
prompt into opencode:

```text
1. git clone https://github.com/predictiple/infinite-choose-your-own-adventure.git && cd infinite-choose-your-own-adventure
2. npm install
3. Confirm setup succeeded.
```

### Manual install

#### 1. Clone and install dependencies

```bash
git clone https://github.com/predictiple/infinite-choose-your-own-adventure.git
cd infinite-choose-your-own-adventure
bun install
```

Voice model files are included in `piper/` and are loaded automatically
from the project directory.

## Sample Session

A sample 7-scene conversation between Daniel Plainview (1898 oil baron)
and Isaac (Kaylon android from 2421) is included in the `sample/` folder
with transcripts, teasers, and audio files.

<img alt="Daniel Plainview and Isaac" src="sample/daniel-isaac.jpg" width="400">

See [sample/README.md](sample/README.md) for the full scene list.

## Usage

### Start a session

Open this project in opencode and chat with the `director`:

```
/agent director
```

Describe your scene setup and character names to the `director`, who then orchestrates the conversation.

### Record a scene

Recording is **on by default** during `director` sessions — every scene is
captured automatically. You can toggle it manually:

```
/record on   # start capturing TTS audio
/record off  # stop and save WAV + transcript + teaser
```

or just tell the `director`: "stop recording".

### Re-render a scene

Extract dialogue from a conversation transcript, format as JSON,
and run:

```bash
bun .opencode/skills/director-regenerator/scripts/regenerate.ts scene1.json
```

or just ask the `director` to do it: "regenerate scenes".

Re-rendering is done without audible playback, so that it's faster.

### Mute/unmute TTS

```
/tts off     # mute all speech
/tts on      # re-enable speech
```

or just tell the `director` to do it, e.g. "silence audio". This
doesn't affect recording.

## Project Structure

```
piper/
├── isaac_1-0_4800.onnx         # Isaac voice model
├── isaac_1-0_4800.onnx.json
├── talla_1-0_3900.onnx         # Talla voice model
└── talla_1-0_3900.onnx.json
sample/
├── README.md                   # Sample recording catalog
├── daniel-isaac.jpg
└── daniel4500-isaac_*.md       # Scene transcripts and teasers
.opencode/
├── agents/
│   ├── director.md     # Orchestrator (text-only)
│   ├── isaac.md        # Kaylon android
│   └── talla.md        # Xelayan security chief
├── tools/
│   ├── tts.ts           # Piper TTS synthesis
│   ├── record.ts        # Audio recording + dramatic pauses
│   └── log.ts           # Transcript logging
├── commands/
│   ├── tts.md           # /tts on|off
│   └── record.md        # /record on|off
├── skills/
│   ├── add-character/       # Add new voiced agents
│   ├── switch-director/     # Change director voice
│   └── director-regenerator/ # Re-render scenes to audio
└── package.json        # Dependency: @opencode-ai/plugin
```

## License

MIT
