import { env } from "./env.ts"

export async function notifyQuestion(question: {
  itemKey: string
  itemName: string
  url: string
  question: string
}): Promise<void> {
  if (!process.env.NTFY_URL) return
  const email = process.env.NOTIFICATION_EMAIL
  const response = await fetch(env("NTFY_URL"), {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${env("NTFY_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: env("NTFY_TOPIC"),
      title: `Question on ${question.itemKey}`,
      message: `${question.itemName}\n\n${question.question}\n${question.url}`,
      tags: ["question"],
      click: question.url,
      actions: [{ action: "view", label: "Answer", url: question.url }],
      ...(email ? { email } : {}),
    }),
  })
  if (!response.ok) throw new Error(`ntfy: ${response.status}`)
}
