import { parseFrames, prepare } from './source.js'

async function fetchOk(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

export async function loadReplay(base = `${import.meta.env.BASE_URL}fixtures/`) {
  const [run, agents, tree] = await Promise.all([
    fetchOk(`${base}sandbox-run.jsonl`).then((response) => response.text()),
    fetchOk(`${base}agents.json`).then((response) => response.json()),
    fetchOk(`${base}sandbox-tree.json`).then((response) => response.json()),
  ])
  return prepare({ frames: parseFrames(run), agentsFile: agents, treeFile: tree })
}
