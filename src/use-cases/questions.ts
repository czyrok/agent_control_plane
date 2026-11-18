import { marked } from "marked"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import { COMMENT_SOURCE } from "../repositories/plane-work-item-repository.ts"
import * as questionRepository from "../repositories/question-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { WorkItemWorkspace } from "../shared/types.ts"

export type QuestionItem = { itemKey: string; itemName: string; url: string }

function describeItem(link: WorkItemWorkspace): QuestionItem {
  return { itemKey: link.itemKey, itemName: link.itemName, url: planeProjectService.workItemUrl(link.itemKey) }
}

export async function postQuestion(id: string, workspace: string, question: string): Promise<QuestionItem | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  if (questionRepository.findById(id)) return describeItem(link)

  const createdAt = new Date().toISOString()
  await planeWorkItemRepository.addComment(
    link.itemId,
    await marked.parse(`**Question from the agent**\n\n${question}`),
    id,
  )
  questionRepository.insert({ id, itemId: link.itemId, workspace, createdAt, answer: null, answeredAt: null })
  await planeWorkItemRepository.setState(link.itemId, await planeProjectService.stateIdByKey("waiting"))
  return describeItem(link)
}

export function readQuestion(id: string): { answered: boolean; answer: string | null } | undefined {
  const question = questionRepository.findById(id)
  return question && { answered: question.answer !== null, answer: question.answer }
}

export async function syncQuestionAnswers(): Promise<void> {
  for (const question of questionRepository.findUnanswered()) {
    const asked = Date.parse(question.createdAt)
    const reply = (await planeWorkItemRepository.listComments(question.itemId)).find(
      (comment) => comment.externalSource !== COMMENT_SOURCE && Date.parse(comment.createdAt) > asked,
    )
    if (!reply) continue
    questionRepository.setAnswer(question.id, reply.text)
    await planeWorkItemRepository.setState(question.itemId, await planeProjectService.stateIdByKey("in_progress"))
  }
}

export function listWaiting(): { name: string; url: string }[] {
  return questionRepository.findUnanswered().flatMap((question) => {
    const link = workItemWorkspaceRepository.findByItemId(question.itemId)
    return link ? [{ name: `${link.itemKey} ${link.itemName}`, url: planeProjectService.workItemUrl(link.itemKey) }] : []
  })
}
