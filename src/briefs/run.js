export const UNATTENDED_NOTE = 'You are running unattended in a one-shot command started for the owner, who may be away. Nobody can answer a question. If something blocks you, stop, leave the branch as it is, and say why in your report.'

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g

export function unattendedPrompt(prompt) {
  return `${prompt}\n\n${UNATTENDED_NOTE}`
}

function expandBin(bin, env) {
  return String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') throw new Error(`The environment variable ${name} is not set.`)
    return value
  })
}

export function commandFor({ lane, prompt, env = {}, usageFile, title }) {
  if (!lane || typeof lane !== 'object') throw new Error('There is no lane to run.')
  const cli = lane.cli
  if (!cli) throw new Error(`The lane ${lane.name ?? 'this one'} has no command line, so the runner cannot start it.`)
  const harness = cli.harness
  if (harness !== 'hermes' && harness !== 'opencode') throw new Error(`The runner does not know the ${harness} command line.`)
  const file = expandBin(cli.bin, env)
  const reasoning = lane.reasoning ? String(lane.reasoning) : ''
  if (harness === 'hermes') {
    const args = ['-z', prompt, '-m', cli.model, '--provider', cli.provider]
    if (reasoning) args.push('--reasoning', reasoning)
    if (usageFile) args.push('--usage-file', usageFile)
    return { file, args, cwd: lane.worktree }
  }
  const model = reasoning ? `${cli.model}#${reasoning}` : cli.model
  return { file, args: ['run', '--model', model, '--auto', '--title', title, prompt], cwd: lane.worktree }
}

export const DEFAULT_MINUTES = 100

export function parseRunArgs(argv) {
  const args = (Array.isArray(argv) ? argv : []).map((value) => String(value))
  const briefs = []
  let lane = ''
  let dryRun = false
  let minutes = DEFAULT_MINUTES
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--minutes' || arg.startsWith('--minutes=')) {
      const value = arg === '--minutes' ? args[index + 1] : arg.slice('--minutes='.length)
      if (arg === '--minutes') index += 1
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1) throw new Error('--minutes needs a whole number of minutes, one or more.')
      minutes = Number(value)
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`)
    if (arg === '') continue
    if (!lane) lane = arg
    else briefs.push(arg)
  }
  if (!lane) throw new Error('Name a lane to run, for example hermes.')
  if (briefs.length === 0) throw new Error('Name at least one brief id.')
  return { lane, briefs, dryRun, minutes }
}
