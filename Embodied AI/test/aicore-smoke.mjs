import { OrchestrationClient } from "@sap-ai-sdk/orchestration";
const model = process.argv[2] || "anthropic--claude-4.8-opus";
const client = new OrchestrationClient({ promptTemplating: { model: { name: model, params: { max_tokens: 200, temperature: 0.2 } } } }, { resourceGroup: "default" });
const t0 = Date.now();
try {
  const res = await client.chatCompletion({ messages: [
    { role: "system", content: "Responde SOLO con JSON: {\"ok\": true, \"modelo\": string, \"sum\": number}" },
    { role: "user", content: "Di qué modelo eres y calcula 21+21." }
  ] });
  console.log("model:", model, "| finish:", res.getFinishReason(), "| ms:", Date.now() - t0);
  console.log("content:", res.getContent());
  console.log("usage:", JSON.stringify(res.getTokenUsage()));
} catch (e) {
  console.log("ERROR:", e.message?.slice(0, 300)); console.log("cause status:", e.cause?.response?.status, JSON.stringify(e.cause?.response?.data || "").slice(0, 300));
}
