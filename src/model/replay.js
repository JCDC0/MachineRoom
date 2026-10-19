import { parseFrames, prepare } from './source.js'

async function fetchOk(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

export function replayFiles(recording = null) {
  if (!recording) return { run: 'fixtures/sandbox-run.jsonl', agents: 'fixtures/agents.json', tree: 'fixtures/sandbox-tree.json' }
  const stem = `recordings/${recording}`
  return { run: `${stem}-run.jsonl`, agents: `${stem}-agents.json`, tree: `${stem}-tree.json` }
}

export async function loadReplay({ base = import.meta.env.BASE_URL, recording = null } = {}) {
  const files = replayFiles(recording)
  try {
    const [run, agents, tree] = await Promise.all([
      fetchOk(`${base}${files.run}`).then((response) => response.text()),
      fetchOk(`${base}${files.agents}`).then((response) => response.json()),
      fetchOk(`${base}${files.tree}`).then((response) => response.json()),
    ])
    return prepare({ frames: parseFrames(run), agentsFile: agents, treeFile: tree })
  } catch (error) {
    if (!recording) throw error
    throw new Error(`The recording ${recording} could not be loaded. Make it with npm run run-recording -- <position>, then open the page again.`)
  }
}
