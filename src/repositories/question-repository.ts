import { database } from "../infrastructure/database.ts"
import type { Question } from "../shared/types.ts"

type Row = {
  id: string
  item_id: string
  workspace: string
  created_at: string
  answer: string | null
  answered_at: string | null
  delivered_at: string | null
}

const statements = {
  insert: database.prepare(
    "INSERT INTO questions (id, item_id, workspace, created_at, answer, answered_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ),
  selectById: database.prepare("SELECT * FROM questions WHERE id = ?"),
  selectUnanswered: database.prepare(
    "SELECT * FROM questions WHERE answer IS NULL AND superseded_at IS NULL ORDER BY created_at",
  ),
  updateSuperseded: database.prepare("UPDATE questions SET superseded_at = ? WHERE id = ? AND answer IS NULL"),
  updateAnswer: database.prepare("UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?"),
  selectLatestByWorkspace: database.prepare("SELECT * FROM questions WHERE workspace = ? ORDER BY created_at DESC LIMIT 1"),
  selectOldestUndelivered: database.prepare(
    "SELECT * FROM questions WHERE workspace = ? AND answer IS NOT NULL AND delivered_at IS NULL ORDER BY created_at ASC LIMIT 1",
  ),
  updateDelivered: database.prepare(
    "UPDATE questions SET delivered_at = ? WHERE id = ? AND answer IS NOT NULL AND delivered_at IS NULL",
  ),
}

function toQuestion(row: Row): Question {
  return {
    id: row.id,
    itemId: row.item_id,
    workspace: row.workspace,
    createdAt: row.created_at,
    answer: row.answer,
    answeredAt: row.answered_at,
    deliveredAt: row.delivered_at,
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
    question.deliveredAt,
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

export function markSuperseded(id: string): void {
  statements.updateSuperseded.run(new Date().toISOString(), id)
}

export function findLatestByWorkspace(workspace: string): Question | undefined {
  const row = statements.selectLatestByWorkspace.get(workspace) as Row | undefined
  return row && toQuestion(row)
}

export function findOldestUndelivered(workspace: string): Question | undefined {
  const row = statements.selectOldestUndelivered.get(workspace) as Row | undefined
  return row && toQuestion(row)
}

export function markDelivered(id: string): void {
  statements.updateDelivered.run(new Date().toISOString(), id)
}
