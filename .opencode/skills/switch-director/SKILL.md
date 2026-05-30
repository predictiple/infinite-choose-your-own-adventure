---
name: switch-director
description: Switch the director agent to a new character with a different voice and personality. Use when user says to change the director character, switch voices, or create a new director personality.
---

# Switch the Director

The director is a primary agent at `.opencode/agents/director.md` that orchestrates multi-character conversations by calling `tts` with different `voice` parameters. Switching it means changing its voice and personality.

## Files to change

| File | When to change |
|---|---|
| `.opencode/tools/tts.ts` | Only if the new voice's `.onnx` file isn't already in the VOICES map |
| `.opencode/agents/director.md` | **Always** — frontmatter + body |

## Step 1: Add voice (if needed)

The VOICES map lives at `regenerate.ts:31` in the director-regenerator skill. The `tts.ts` tool discovers voices dynamically from agent frontmatter — no manual map needed.

```js
voiceName: { model: "filename.onnx", extraArgs: ["--sentence_silence", "0.6"] },
```

For multi-speaker models add `speaker: <id>`. Common extraArgs: `sentence_silence`, `length_scale`, `noise_scale`, `noise_w`, `volume`.

## Step 2: Update director.md frontmatter

Fields to change:

```yaml
---
description: One-liner describing the character + "Orchestrates multi-character conversations."
mode: primary
voice: <voice_name>       # Must match a key in tts.ts VOICES
piper: {"sentence_silence": 0.6, ...}  # Omit to use tts.ts defaults
tts_pause: 0
steps: 200
temperature: <0.0-2.0>
top_p: <0.0-1.0>
color: "<hex_color>"
permission:
  edit: deny
  external_directory:
    "*": allow
---
```

## Step 3: Rewrite director.md body

Keep the structure, replace the personality:

1. **Character intro** — who they are, how they speak
2. **"You're the Director"** — explain they orchestrate characters via `tts` with `voice` parameter
3. **AVAILABLE CHARACTERS** — copy the list verbatim from the current director
4. **HOW TO ORCHESTRATE** — copy the flow + example verbatim (same mechanism)
5. **RECORDING** — copy verbatim
6. **SPEAKING RULES** — copy verbatim

Only the character intro + voice change. The orchestration mechanism is always the same.

## Verification

After changes, run:

```bash
bun build --check --target=bun .opencode/tools/tts.ts
```

Tell the user to restart opencode for the new director to load.
