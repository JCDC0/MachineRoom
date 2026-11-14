import { checkCommandLines, checkCommandProblem, DEFAULT_MINUTES } from './run.js'

export const QUEUE_TASK_LIMIT = 20
export const QUEUE_TASK_TEXT_LIMIT = 4000
export const QUEUE_SUBJECT_LIMIT = 72

const SEPARATOR = '---'

export function parseQueue(text) {
  const tasks = []
  const lines = String(text ?? '').split(/\r?\n/)
  let current = []
  const flush = () => {
    const task = current.join('\n').trim()
    current = []
    if (task !== '') tasks.push(task)
  }
  for (const line of lines) {
    if (line.trim() === SEPARATOR) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  if (tasks.length > QUEUE_TASK_LIMIT) throw new Error(`A queue holds at most ${QUEUE_TASK_LIMIT} tasks.`)
  for (const task of tasks) {
    if (task.length > QUEUE_TASK_TEXT_LIMIT) throw new Error(`Write each task in 1 to ${QUEUE_TASK_TEXT_LIMIT} characters.`)
  }
  return tasks
}

export function commitAuthorFor(harness, model = '') {
  const author = harness?.commitAuthor
  const label = String(author?.label ?? '').trim()
  const address = String(author?.address ?? '').trim()
  if (label === '' || address === '') return null
  return { label, address, model: String(model ?? '').trim() }
}

export function commitTrailer(author) {
  const label = String(author?.label ?? '').trim()
  const address = String(author?.address ?? '').trim()
  if (label === '' || address === '') return ''
  const model = String(author?.model ?? '').trim()
  return `Co-Authored-By: ${label}${model === '' ? '' : ` (${model})`} <${address}>`
}

export function commitMessage(task, index, count, lane, author = null) {
  const first = String(task ?? '').split(/\r?\n/)[0].trim()
  const subject = (first === '' ? `Task ${index}` : first).slice(0, QUEUE_SUBJECT_LIMIT)
  const body = `Task ${index} of ${count}, run by MachineRoom on the ${lane} lane.`
  const trailer = commitTrailer(author)
  return `${subject}\n\n${body}${trailer === '' ? '' : `\n\n${trailer}`}`
}

export function parseQueueArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).map((value) => String(value))
  if (!args.some((arg) => arg === '--queue' || arg.startsWith('--queue='))) return null
  const options = { lane: '', briefs: [], project: '', queue: '', test: '', dryRun: false, minutes: DEFAULT_MINUTES }
  const testLines = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const named = (name) => arg === `--${name}` || arg.startsWith(`--${name}=`)
    const valueOf = (name, problem) => {
      const raw = arg === `--${name}` ? args[index + 1] : arg.slice(name.length + 3)
      if (arg === `--${name}`) index += 1
      if (typeof raw !== 'string' || raw === '') throw new Error(problem)
      return raw
    }
    if (named('queue')) {
      options.queue = valueOf('queue', '--queue needs a file.')
      continue
    }
    if (named('project')) {
      options.project = valueOf('project', '--project needs a folder.')
      continue
    }
    if (named('test')) {
      const value = valueOf('test', '--test needs a command.')
      const problem = checkCommandProblem(value)
      if (problem !== '') throw new Error(problem)
      testLines.push(...checkCommandLines(value))
      continue
    }
    if (named('minutes')) {
      const value = valueOf('minutes', '--minutes needs a whole number of minutes, one or more.')
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error('--minutes needs a whole number of minutes, one or more.')
      options.minutes = Number(value)
      continue
    }
    if (arg === '--task' || arg.startsWith('--task=')) {
      throw new Error('--queue runs the tasks in the queue file, not one task. Drop --task.')
    }
    if (arg === '--task-file' || arg.startsWith('--task-file=')) {
      throw new Error('--queue runs the tasks in the queue file, not one task file. Drop --task-file.')
    }
    if (arg === '--allow-dirty') {
      throw new Error('--queue needs a clean start, so it does not take --allow-dirty.')
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--force') {
      options.force = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg === '') continue
    if (!options.lane) options.lane = arg
    else options.briefs.push(arg)
  }
  if (!options.lane) throw new Error('Name a lane to run, for example opencode.')
  if (!options.project) throw new Error('--queue needs --project <folder>.')
  if (!options.queue) throw new Error('--queue needs a file.')
  if (options.briefs.length > 0) throw new Error('A queue takes no brief id. Name the lane and the queue file only.')
  options.test = testLines.join('\n')
  if (options.test !== '') {
    const problem = checkCommandProblem(options.test)
    if (problem !== '') throw new Error(problem)
  }
  return options
}

export async function runQueue({ tasks, runTask, runTests, git, author = null } = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  const branch = String(git?.branch ?? '')
  const lane = String(git?.lane ?? '')
  const results = []
  if (list.length === 0) return { branch, results }
  if (typeof runTask !== 'function') throw new Error('A queue needs a task runner.')
  if (branch === '') throw new Error('A queue needs a branch name.')
  if (lane === '') throw new Error('A queue needs a lane name.')
  if (await git.exists(branch)) throw new Error(`The branch ${branch} already exists. Pick another name or delete it first.`)
  if (String(await git.status()).trim() !== '') throw new Error('The project has uncommitted changes. A queue needs a clean start.')
  await git.create(branch)
  const head = async () => (typeof git.head === 'function' ? String(await git.head()).trim() : '')
  const currentBranch = async () => (typeof git.currentBranch === 'function' ? String(await git.currentBranch()).trim() : '')
  let stopped = false
  for (let offset = 0; offset < list.length; offset += 1) {
    const number = offset + 1
    const task = list[offset]
    if (stopped) {
      results.push({ number, task, status: 'not run' })
      continue
    }
    const startHead = await head()
    const startBranch = (await currentBranch()) || branch
    const run = await runTask(task, number)
    if (run?.killed === true) {
      results.push({ number, task, status: 'failed: lane killed' })
      stopped = true
      continue
    }
    if (run?.code !== 0) {
      results.push({ number, task, status: `failed: lane exit ${run?.code ?? 'none'}` })
      stopped = true
      continue
    }
    const backupLane = typeof run?.backupLane === 'string' ? run.backupLane.trim() : ''
    const expectedBranch = backupLane === '' ? startBranch : `${startBranch}-on-${backupLane}`
    const onBranch = typeof git.currentBranch === 'function' ? String(await git.currentBranch()).trim() : expectedBranch
    const onBackupBranch = backupLane !== '' && onBranch.endsWith(`-on-${backupLane}`)
    if (onBranch !== expectedBranch && !onBackupBranch) {
      results.push({ number, task, status: `failed: the lane left the queue branch for ${onBranch === '' ? 'no branch' : onBranch}` })
      stopped = true
      continue
    }
    if (typeof runTests === 'function') {
      const tests = await runTests(task, number)
      if (tests?.ok !== true) {
        results.push({ number, task, status: 'failed: tests' })
        stopped = true
        continue
      }
    }
    const endHead = await head()
    const moved = startHead !== '' && endHead !== '' && endHead !== startHead
    if (String(await git.status()).trim() === '') {
      results.push(moved
        ? { number, task, status: 'committed', sha: endHead }
        : { number, task, status: 'no change' })
      continue
    }
    await git.add()
    const taskAuthor = run !== null && typeof run === 'object' && Object.hasOwn(run, 'author') ? run.author : author
    const sha = String(await git.commit(commitMessage(task, number, list.length, lane, taskAuthor)))
    results.push({ number, task, status: 'committed', sha })
  }
  return { branch, results }
}

export function formatQueueSummary({ branch, results, tests, worktree } = {}) {
  const name = String(branch ?? '')
  const folder = String(worktree ?? '').trim()
  const lines = [`branch: ${name}`]
  for (const result of Array.isArray(results) ? results : []) {
    const sha = result?.sha ? ` ${String(result.sha)}` : ''
    lines.push(`${result?.number}. ${result?.status}${sha}`)
  }
  lines.push(`tests: ${tests ? String(tests) : 'none, the project has no tests'}`)
  lines.push(folder
    ? `The worktree ${folder} stays on ${name}.`
    : `The project stays on ${name}. Run git switch - to go back.`)
  return lines
}
