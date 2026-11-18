import { database } from "../infrastructure/database.ts"
import type { Question } from "../shared/types.ts"

type Row = {
  id: string
  item_id: string
  workspace: string
  created_at: string
  answer: string | null
  answered_at: string | null
}

const statements = {
  insert: database.prepare(
    "INSERT INTO questions (id, item_id, workspace, created_at, answer, answered_at) VALUES (?, ?, ?, ?, ?, ?)",
  ),
  selectById: database.prepare("SELECT * FROM questions WHERE id = ?"),
  selectUnanswered: database.prepare("SELECT * FROM questions WHERE answer IS NULL ORDER BY created_at"),
  updateAnswer: database.prepare("UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?"),
}

function toQuestion(row: Row): Question {
  return {
    id: row.id,
    itemId: row.item_id,
    workspace: row.workspace,
    createdAt: row.created_at,
    answer: row.answer,
    answeredAt: row.answered_at,
  }
}

export function insert(question: Question): void {
  statements.insert.run(
    question.id,
    question.itemId,
    question.workspace,
    question.createdAt,
    question.answer,
    question.answeredAt,
  )
}

export function findById(id: string): Question | undefined {
  const row = statements.selectById.get(id) as Row | undefined
  return row && toQuestion(row)
}

export function findUnanswered(): Question[] {
  return (statements.selectUnanswered.all() as Row[]).map(toQuestion)
}

export function setAnswer(id: string, answer: string): void {
  statements.updateAnswer.run(answer, new Date().toISOString(), id)
}
