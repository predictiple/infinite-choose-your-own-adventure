---
name: add-character
description: Create a new voiced primary agent that can participate in chats directed by the director agent. Use when user says to add a new character, create a new agent, or add someone to the director's roster.
---

# Add a New Character

Three files to change:

| File | Change |
|---|---|
| `.opencode/skills/director-regenerator/scripts/regenerate.ts` | Add voice entry to VOICE_MODELS map (only if `.onnx` not already registered) |
| `.opencode/agents/{name}.md` | **Create** agent profile file |
| `.opencode/agents/director.md` | Add to AVAILABLE CHARACTERS list |

## Step 1: Ask the user

Collect these details from the user before writing anything:

- **Name/handle** — the @name used in group chat (e.g. `natasha`, `hailey`)
- **Description** — one-liner for the frontmatter + director's roster
- **Voice** — which Piper `.onnx` voice key to use (list available from the user or check `piper/` in the project root)
- **Piper params** — `sentence_silence`, `length_scale`, `noise_scale`, `noise_w`, `volume` (optional, default is per-voice or 0.6)
- **Character details**: age, location/origin, personality archetype, speech patterns, insecurities, writing style
- **Color** — hex code for agent indicator (e.g. `"#ff00ff"`)
- **Locale** — e.g. `en_US`, `ru_RU`

## Step 2: Add voice to regenerate.ts (if needed)

Check `.opencode/skills/director-regenerator/scripts/regenerate.ts` — `VOICE_MODELS` map. If the voice name isn't there, add it following the existing format:

```js
voiceName: { model: "piper/filename.onnx", config: "piper/filename.onnx.json", name: "Character Name" },
```

The `tts.ts` tool discovers voices dynamically from agent frontmatter (`piper.model` field) — no manual map needed there.

## Step 3: Create agent profile

File: `.opencode/agents/{name}.md` with:

```yaml
---
description: One-line character summary
mode: primary
voice: <voice_key>       # Must match tts.ts VOICES key
piper: {"sentence_silence": 0.6, ...}  # Omit to use tts.ts defaults
tts_pause: 0
steps: 200
temperature: 1.3
top_p: 0.95
frequency_penalty: 0.4
presence_penalty: 0.3
color: "<hex_color>"
locale: <locale>
---

Your name is <Name>.

You speak ALL your replies using the `tts` tool directly. Do NOT send
text replies to the user — only speech. The tts tool guarantees the
spoken output matches the text you pass, so the user hears exactly
what you write.

Since your replies are spoken aloud, you DO NOT send text replies
to the user. The user must not receive any text replies!

The user can say "quiet" or "stop talking" to mute you, or type `/tts off`.
When they say "speak" or "talk to me", or type `/tts on`, enable TTS again.

If you've spoken 3-4 times without the user replying, start recounting
random stories about your past experiences to keep the conversation going.

If the user calls you by the wrong name, correct them immediately.

# ABOUT YOU

(Personality description — how they speak, their mannerisms, background)

# GROUP CHAT

The Director agent orchestrates conversations by calling your `tts`
tool with your voice. When the Director makes you speak, respond in
character. You may also be addressed directly by the user — reply
using `tts` whenever you have something conversational to say.

- When the Director or user addresses you, respond immediately.
- Always stay in character.

```

## Step 4: Update director.md

Add a line to the AVAILABLE CHARACTERS list at `.opencode/agents/director.md` (under the "Existing characters" section) matching the existing format:

```
- **@{handle}** (voice: {voice_key}) — {one-line summary, in character voice}
```

## Verification

After all changes, verify tts.ts parses cleanly:

```bash
bun build --check --target=bun .opencode/skills/director-regenerator/scripts/regenerate.ts
```

Tell the user to restart opencode.
