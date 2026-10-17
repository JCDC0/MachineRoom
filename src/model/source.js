import { makeTree } from './paths.js'
import { buildActivities, orderAgents } from './pipeline.js'

export function parseFrames(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function prepare({ frames, agentsFile, treeFile }) {
  const agents = orderAgents(agentsFile.agents)
  const tree = makeTree(treeFile)
  const activities = buildActivities(frames, { agents, tree })
  return { frames, agents, tree, activities }
}
