/**
 * Example: function/tool calling, OpenAI-compatible.
 *
 * Defines one tool, lets the model decide to call it, then feeds a fabricated
 * tool result back for a final answer. Run:
 * ```sh
 * SKAILAR_API_KEY=skl_live_... \
 * SKAILAR_BASE_URL=http://localhost:8080 \
 * SKAILAR_MODEL=gpt-5-mini \
 * bun run examples/tool-calling.ts
 * ```
 */

import Skailar, { type ChatMessage, type Tool } from "../src/index";

/** The single tool exposed to the model in this example. */
const weatherTool: Tool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
};

/**
 * Run one round of tool calling end to end.
 *
 * @returns A promise that resolves once the final answer is printed.
 */
async function main(): Promise<void> {
  const client = new Skailar({
    baseURL: process.env.SKAILAR_BASE_URL ?? "https://api.skailar.com",
  });
  const model = process.env.SKAILAR_MODEL ?? "claude-sonnet-4-6";

  const messages: ChatMessage[] = [
    { role: "user", content: "What's the weather in Paris? Use the tool." },
  ];

  const first = await client.chat.completions.create({
    model,
    messages,
    tools: [weatherTool],
    tool_choice: "auto",
    max_tokens: 200,
  });

  const toolCalls = first.choices[0]?.message.tool_calls ?? [];
  if (toolCalls.length === 0) {
    console.log("Model answered without a tool call:", first.choices[0]?.message.content);
    return;
  }

  messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
  for (const tc of toolCalls) {
    console.log(`Model requested ${tc.function.name}(${tc.function.arguments})`);
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify({ city: "Paris", temperature_c: 18, condition: "Cloudy" }),
    });
  }

  const second = await client.chat.completions.create({ model, messages, max_tokens: 200 });
  console.log("Final answer:", second.choices[0]?.message.content);
}

void main();
