import { ladderFromOrchestrators } from './ladderForm.js'

export function ladderFromAnswer(answer) {
  const list = Array.isArray(answer)
    ? answer
    : answer && typeof answer === 'object' && Array.isArray(answer.orchestrators)
      ? answer.orchestrators
      : null
  if (list === null) return null
  return ladderFromOrchestrators(list)
}
