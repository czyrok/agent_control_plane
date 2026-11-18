import * as questionRepository from "../repositories/question-repository.ts"
import type { Question } from "../shared/types.ts"

const waiters = new Map<string, Set<() => void>>()

export function wakeWaiters(id: string): void {
  for (const wake of [...(waiters.get(id) ?? [])]) wake()
}

export function waitForAnswer(id: string, milliseconds: number): Promise<Question | undefined> {
  const current = questionRepository.findById(id)
  if (!current || current.answer !== null) return Promise.resolve(current)

  return new Promise((resolve) => {
    const questionWaiters = waiters.get(id) ?? new Set<() => void>()
    waiters.set(id, questionWaiters)
    const wake = () => {
      clearTimeout(timeout)
      questionWaiters.delete(wake)
      if (questionWaiters.size === 0) waiters.delete(id)
      resolve(questionRepository.findById(id))
    }
    const timeout = setTimeout(wake, milliseconds)
    questionWaiters.add(wake)
  })
}
