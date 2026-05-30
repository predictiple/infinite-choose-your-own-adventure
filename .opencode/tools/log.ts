import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"

export default tool({
  description: "Append narrative text, scene descriptions, or stage direction to the recording transcript without speaking it aloud. Use for narration that should appear in the transcript but not be spoken via TTS.",
  args: {
    text: tool.schema.string().describe("Narrative text to add to the transcript"),
  },
  async execute(args, context) {
    const projectDir = context.directory
    const transcriptPath = path.join(projectDir, ".opencode", "transcript.jsonl")
    const line = JSON.stringify({
      agent: "narration",
      text: args.text,
      ts: Date.now(),
    }) + "\n"
    fs.appendFileSync(transcriptPath, line)
    return "Logged to transcript"
  },
})
