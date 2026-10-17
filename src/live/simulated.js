import { orderAgents } from '../model/pipeline.js'
import { parseFrames } from '../model/source.js'

const START_DELAY_MS = 400

export function openSimulated({ frames, onFrame, onStatus, idleCapMs = 2500, speed = 1, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const times = frames.map((frame) => Date.parse(frame.createdAt))
  let index = 0
  let timer = null
  let closed = false

  function step() {
    if (closed) return
    onFrame(frames[index])
    index += 1
    if (index >= frames.length) {
      onStatus('finished')
      return
    }
    const gap = Math.min(Math.max(times[index] - times[index - 1], 0), idleCapMs) / speed
    timer = setTimer(step, gap)
  }

  onStatus('connecting')
  timer = setTimer(() => {
    if (frames.length === 0) {
      onStatus('finished')
      return
    }
    onStatus('live')
    step()
  }, START_DELAY_MS)

  return {
    close() {
      closed = true
      clearTimer(timer)
    },
  }
}

export async function loadDemo(base = `${import.meta.env.BASE_URL}fixtures/`) {
  const [run, agentsFile] = await Promise.all([
    fetch(`${base}sandbox-run.jsonl`).then((response) => response.text()),
    fetch(`${base}agents.json`).then((response) => response.json()),
  ])
  return {
    frames: parseFrames(run),
    agents: orderAgents(agentsFile.agents),
    rootName: agentsFile.projectRoot,
  }
}
