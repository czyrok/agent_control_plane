import { marked } from "marked"
import { notifyQuestion } from "../infrastructure/ntfy.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import { COMMENT_SOURCE } from "../repositories/plane-work-item-repository.ts"
import * as questionRepository from "../repositories/question-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import { waitForAnswer, wakeWaiters } from "../services/question-waiter-service.ts"
import type { Question, WorkItemWorkspace } from "../shared/types.ts"

type QuestionItem = { itemKey: string; itemName: string; url: string }

function describeItem(link: WorkItemWorkspace): QuestionItem {
  return { itemKey: link.itemKey, itemName: link.itemName, url: planeProjectService.workItemUrl(link.itemKey) }
}

export async function askOperator(
  workspace: string,
  question: string,
  waitMilliseconds: number,
): Promise<Question | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  const latest = questionRepository.findLatestByWorkspace(workspace)
  if (latest && latest.answer === null) return waitForAnswer(latest.id, waitMilliseconds)

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await planeWorkItemRepository.addComment(
    link.itemId,
    await marked.parse(`**Question from the agent**\n\n${question}`),
    id,
  )
  questionRepository.insert({
    id,
    itemId: link.itemId,
    workspace,
    createdAt,
    answer: null,
    answeredAt: null,
    deliveredAt: null,
  })
  await planeWorkItemRepository.setState(link.itemId, await planeProjectService.stateIdByKey("waiting"))
  const item = describeItem(link)
  notifyQuestion({ itemKey: item.itemKey, itemName: item.itemName, url: item.url, question }).catch((error) =>
    console.error(error),
  )
  return waitForAnswer(id, waitMilliseconds)
}

export async function awaitAnswer(workspace: string, waitMilliseconds: number): Promise<Question | undefined> {
  const latest = questionRepository.findLatestByWorkspace(workspace)
  return latest && waitForAnswer(latest.id, waitMilliseconds)
}

export function takePendingAnswer(workspace: string): { id: string; itemKey: string; answer: string } | undefined {
  const question = questionRepository.findOldestUndelivered(workspace)
  if (!question?.answer) return undefined
  return {
    id: question.id,
    itemKey: workItemWorkspaceRepository.findByItemId(question.itemId)?.itemKey ?? "",
    answer: question.answer,
  }
}

export function acknowledgeAnswer(workspace: string, id: string): void {
  if (questionRepository.findById(id)?.workspace !== workspace) return
  questionRepository.markDelivered(id)
}

export async function syncQuestionAnswers(): Promise<void> {
  for (const question of questionRepository.findUnanswered()) {
    const asked = Date.parse(question.createdAt)
    const reply = (await planeWorkItemRepository.listComments(question.itemId)).find(
      (comment) => comment.externalSource !== COMMENT_SOURCE && Date.parse(comment.createdAt) > asked,
    )
    if (!reply) continue
    questionRepository.setAnswer(question.id, reply.text)
    wakeWaiters(question.id)
    await planeWorkItemRepository.setState(question.itemId, await planeProjectService.stateIdByKey("in_progress"))
  }
}

export function listWaiting(): { name: string; url: string }[] {
  return questionRepository.findUnanswered().flatMap((question) => {
    const link = workItemWorkspaceRepository.findByItemId(question.itemId)
    return link ? [{ name: `${link.itemKey} ${link.itemName}`, url: planeProjectService.workItemUrl(link.itemKey) }] : []
  })
}
