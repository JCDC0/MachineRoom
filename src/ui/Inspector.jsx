import { useEffect, useMemo, useState } from 'react'
import { basename, visibleText } from '../model/paths.js'
import { agentContext } from './agentContext.js'
import { orchestratorEntry, orchestratorId } from './agentStrip.js'
import { isOrchestratorAgent } from './agentList.js'
import { chatLines, normalizeChat } from './orchestratorChat.js'
import { OPEN_CHAT_EVENT } from './transportOrchestrators.js'
import {
  CONTEXT_NOT_REPORTED,
  agentStateWord,
  breadcrumbRows,
  cutPath,
  effortForAgent,
  explorerRows,
  formatBytes,
  formatTime,
  gitGraphRows,
  inspectTarget,
  internetStatus,
  previewLines,
  touchRows,
} from './inspector.js'
import { shortSha } from './repository.js'

function Row({ label, children }) {
  return (
    <div className="mr-inspector-row">
      <dt>{label}</dt>
      <dd className="mono">{children}</dd>
    </div>
  )
}

function sameAgent(agent, id) {
  const wanted = String(id ?? '').toLowerCase()
  if (!wanted) return false
  return (
    String(agent?.key ?? '').toLowerCase() === wanted ||
    String(agent?.id ?? '').toLowerCase() === wanted
  )
}

function titleOf(target, lane, tree) {
  if (!target) return ''
  if (target.kind === 'agent') return lane?.name || lane?.key || target.id
  if (target.kind === 'internet') return 'INTERNET'
  if (target.kind === 'git') return 'Source control'
  if (target.kind === 'folder') {
    return target.id === '' ? tree?.rootName || 'Project' : basename(target.id)
  }
  return basename(target.id) || target.id
}

export default function Inspector({
  target = null,
  live = false,
  bridge = false,
  client = null,
  lanes = [],
  working = null,
  costs = null,
  liveRuns = null,
  tasks = null,
  log = null,
  orchestrator = null,
  family = [],
  tree = null,
  touches = [],
  webAgents = [],
  onClose = () => {},
  onSelect = () => {},
  onOpenPath = () => {},
}) {
  const item = inspectTarget(target)
  const roster = Array.isArray(lanes) ? lanes : []
  const lane = useMemo(() => roster.find((agent) => sameAgent(agent, item?.id)) ?? null, [roster, item?.id])
  const subOrchestrator = String(item?.id ?? '').toLowerCase().startsWith('sub-')
  const orchestratorAgent = subOrchestrator || isOrchestratorAgent(lane ?? { key: item?.id, name: item?.id })
  const orchestratorRow = orchestratorAgent ? orchestratorEntry(orchestrator, item?.id) : null
  const agentInput =
    item?.kind === 'agent'
      ? orchestratorAgent
        ? {
            ...(lane ?? {}),
            key: item.id,
            name: lane?.name || item.id,
            orchestrator: true,
            ...(orchestratorRow
              ? {
                  contextTokens: orchestratorRow.contextTokens,
                  contextWindow: orchestratorRow.contextWindow,
                  autocompact: orchestratorRow.autocompact,
                }
              : {}),
          }
        : item.id
      : null
  const context = agentContext({
    agent: agentInput,
    working,
    lanes: roster,
    costs,
    liveRuns,
    tasks,
    log,
    orchestrator: subOrchestrator ? null : orchestrator,
  })
  const stateWord = agentStateWord({
    status: lane?.status ?? context.status,
    openCalls: lane?.openCalls,
    tool: lane?.tool,
    label: context.command,
  })
  const effort = effortForAgent({
    key: context.key || item?.id,
    harness: context.harness,
    family,
    orchestrators: orchestrator,
  })

  const [preview, setPreview] = useState(null)
  const [connection, setConnection] = useState(null)
  const [chat, setChat] = useState(null)
  const [git, setGit] = useState(null)
  const [gitError, setGitError] = useState('')

  useEffect(() => {
    if (item?.kind !== 'file' || !bridge || !client || typeof client.fileInfo !== 'function') {
      setPreview(null)
      return undefined
    }
    let active = true
    setPreview({ loading: true, info: null, error: '' })
    client
      .fileInfo({ path: item.id })
      .then((info) => {
        if (!active) return
        setPreview({ loading: false, info: info && typeof info === 'object' ? info : null, error: '' })
      })
      .catch((failure) => {
        if (!active) return
        setPreview({ loading: false, info: null, error: failure?.message || 'The bridge refused the preview.' })
      })
    return () => {
      active = false
    }
  }, [item?.kind, item?.id, bridge, client])

  useEffect(() => {
    if (item?.kind !== 'internet' || !bridge || !client || typeof client.network !== 'function') {
      setConnection(null)
      return undefined
    }
    let active = true
    async function read() {
      try {
        const answer = await client.network()
        if (active) setConnection(answer?.online === true)
      } catch {
        if (active) setConnection(null)
      }
    }
    function onOffline() {
      if (active) setConnection(false)
    }
    read()
    const timer = setInterval(read, 30000)
    const unsubscribe = client.subscribe?.((notice) => {
      if (notice?.topic === 'network') read()
    })
    window.addEventListener('online', read)
    window.addEventListener('offline', onOffline)
    return () => {
      active = false
      clearInterval(timer)
      if (typeof unsubscribe === 'function') unsubscribe()
      window.removeEventListener('online', read)
      window.removeEventListener('offline', onOffline)
    }
  }, [item?.kind, bridge, client])

  useEffect(() => {
    if (item?.kind !== 'git' || !bridge || !client || typeof client.gitState !== 'function') {
      setGit(null)
      setGitError('')
      return undefined
    }
    let active = true
    let ticket = 0
    async function read() {
      ticket += 1
      const mine = ticket
      try {
        const answer = await client.gitState()
        if (!active || mine !== ticket) return
        setGit(answer && typeof answer === 'object' ? answer : null)
        setGitError('')
      } catch (failure) {
        if (!active || mine !== ticket) return
        setGit(null)
        setGitError(failure?.message || 'The bridge refused the source control read.')
      }
    }
    read()
    const timer = setInterval(read, 10000)
    const unsubscribe = client.subscribe?.((notice) => {
      if (notice?.topic === 'git') read()
    })
    return () => {
      active = false
      clearInterval(timer)
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [item?.kind, bridge, client])

  useEffect(() => {
    if (item?.kind !== 'agent' || !orchestratorAgent || !bridge || !client || typeof client.orchestrator !== 'function') {
      setChat(null)
      return undefined
    }
    let active = true
    const id = orchestratorId(item.id)
    async function read() {
      try {
        const answer = await client.orchestrator(id === 'orchestrator' ? undefined : id)
        if (active) setChat({ chat: normalizeChat(answer), error: '' })
      } catch (failure) {
        if (active) setChat({ chat: null, error: failure?.message || 'Could not read the chat.' })
      }
    }
    read()
    const timer = setInterval(read, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [item?.kind, item?.id, orchestratorAgent, bridge, client])

  const folderRows = useMemo(
    () => (item?.kind === 'folder' ? explorerRows(item.id, tree ?? {}) : []),
    [item?.kind, item?.id, tree]
  )
  const crumbs = useMemo(
    () => (item?.kind === 'folder' ? breadcrumbRows(item.id, tree?.rootName ?? '') : []),
    [item?.kind, item?.id, tree?.rootName]
  )
  const touchList = touchRows(touches)
  const previewText = previewLines(preview?.info)
  const chatList = chat?.chat ? chatLines(chat.chat, 6) : []
  const webNames = (Array.isArray(webAgents) ? webAgents : []).map((key) => {
    const found = roster.find((agent) => sameAgent(agent, key))
    return found?.name || String(key)
  })
  const gitReady = item?.kind === 'git' && git?.git === true
  const graphRows = gitReady ? gitGraphRows(git.commits) : []
  const graphWidth = Math.max(1, ...graphRows.map((row) => row.width))
  const changeRows = gitReady && Array.isArray(git.changes) ? git.changes : []
  const changeCount = gitReady ? Number(git.changeCount ?? changeRows.length) || 0 : 0
  const branchText = gitReady
    ? git.detached === true || !git.branch
      ? `Detached at ${shortSha(git.head) || 'HEAD'}`
      : git.branch
    : ''

  if (!item) return null

  function openChat() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
    const detail = { id: orchestratorId(context.key || item.id) }
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent(OPEN_CHAT_EVENT, { detail }))
    }
    onClose()
  }

  return (
    <aside className={`mr-inspector is-${item.kind}`} aria-label="Inspector" role="region">
      <header className="mr-inspector-head">
        <p className="mr-inspector-kind mono">{item.kind}</p>
        <h2 className="mr-inspector-title">{titleOf(item, lane, tree)}</h2>
        <button type="button" className="mr-inspector-close mono" onClick={onClose} aria-label="Close inspector">
          Close
        </button>
      </header>

      <div className="mr-inspector-body">
        {item.kind === 'agent' && !context.empty && (
          <>
            <dl className="mr-inspector-rows">
              <Row label="State">
                <span className={`mr-inspector-state is-${stateWord.word}`}>{stateWord.word}</span>
                {stateWord.word === 'working' && stateWord.tool !== '' && (
                  <span className="mr-inspector-tool">{` · ${stateWord.tool}`}</span>
                )}
                {stateWord.word === 'working' && stateWord.command !== '' && (
                  <span className="mr-inspector-command">{` · ${stateWord.command}`}</span>
                )}
              </Row>
              <Row label="Harness">{context.harness}</Row>
              <Row label="Model">{context.model}</Row>
              <Row label="Effort">{effort}</Row>
              <Row label="Task">{context.task}</Row>
              <Row label="Context">
                {context.isOrchestrator
                  ? context.context
                    ? `${context.context.percent}% · ${context.context.tokens} of ${context.context.window} tokens`
                    : 'not reported'
                  : CONTEXT_NOT_REPORTED}
              </Row>
              {live && <Row label="Cost">{context.cost}</Row>}
              <Row label="Tokens">{context.tokens}</Row>
            </dl>

            <h3 className="mr-inspector-subtitle mono">Last 12 log lines</h3>
            <ol className="mr-inspector-log" aria-label="Recent log lines">
              {context.log.length === 0 ? (
                <li className="mr-inspector-note mono">No log lines.</li>
              ) : (
                context.log.map((line, index) => (
                  <li className={`mr-inspector-log-line is-${line.tone} mono`} key={`${index}-${line.text}`}>
                    {line.text}
                  </li>
                ))
              )}
            </ol>

            {orchestratorAgent && bridge && (
              <section className="mr-inspector-chat" aria-label="Orchestrator chat">
                <h3 className="mr-inspector-subtitle mono">Chat</h3>
                {chat?.error && <p className="mr-inspector-error mono">{chat.error}</p>}
                {!chat?.error && chatList.length === 0 && (
                  <p className="mr-inspector-note mono">Nothing said yet.</p>
                )}
                <ol className="mr-inspector-chat-list">
                  {chatList.map((line) => (
                    <li className={`mr-inspector-chat-line is-${line.from}`} key={line.id}>
                      <span className="mr-inspector-chat-from mono">{line.from}</span>
                      <p className="mr-inspector-chat-text mono">{line.text}</p>
                    </li>
                  ))}
                </ol>
                <button type="button" className="mr-inspector-action mono" onClick={openChat}>
                  Open chat
                </button>
              </section>
            )}
          </>
        )}

        {item.kind === 'folder' && (
          <>
            <nav className="mr-inspector-crumbs" aria-label="Folder path">
              {crumbs.map((crumb, index) => (
                <span className="mr-inspector-crumb" key={crumb.path}>
                  {index > 0 && <span className="mr-inspector-crumb-sep">/</span>}
                  <button
                    type="button"
                    className="mr-inspector-crumb-btn mono"
                    onClick={() => onOpenPath(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
            {folderRows.length === 0 ? (
              <p className="mr-inspector-note mono">This folder is empty.</p>
            ) : (
              <ul className="mr-inspector-explorer" aria-label="Folder contents">
                {folderRows.map((row) => (
                  <li className={`mr-inspector-entry is-${row.kind}`} key={`${row.kind}-${row.path}`}>
                    <button
                      type="button"
                      className="mr-inspector-entry-btn mono"
                      onClick={() => (row.kind === 'dir' ? onOpenPath(row.path) : onSelect({ kind: 'file', id: row.path }))}
                    >
                      <span className="mr-inspector-entry-name">{row.kind === 'dir' ? `${row.name}/` : row.name}</span>
                      <span className="mr-inspector-entry-kind">{` ${row.kind}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {item.kind === 'file' && (
          <>
            <p className="mr-inspector-path mono">{visibleText(item.id)}</p>
            <dl className="mr-inspector-rows">
              <Row label="Size">{preview?.info ? formatBytes(preview.info.size) : 'not reported'}</Row>
              <Row label="Last change">{preview?.info ? formatTime(preview.info.modified) : 'not reported'}</Row>
            </dl>

            <h3 className="mr-inspector-subtitle mono">Touched this session</h3>
            {touchList.length === 0 ? (
              <p className="mr-inspector-note mono">No agent touched this file this session.</p>
            ) : (
              <ul className="mr-inspector-touches" aria-label="Touched this session">
                {touchList.map((touch, index) => (
                  <li className={`mr-inspector-touch is-${touch.mode} mono`} key={`${touch.key}-${touch.time}-${index}`}>
                    <span className="mr-inspector-touch-agent">
                      {roster.find((agent) => sameAgent(agent, touch.key))?.name || touch.key}
                    </span>
                    <span className="mr-inspector-touch-mode">{touch.mode}</span>
                    <span className="mr-inspector-touch-time">{formatTime(touch.time, '')}</span>
                  </li>
                ))}
              </ul>
            )}

            {bridge && preview?.loading && <p className="mr-inspector-note mono">Reading the file.</p>}
            {bridge && preview?.error && <p className="mr-inspector-error mono">{preview.error}</p>}
            {bridge && preview?.info && (
              <>
                <h3 className="mr-inspector-subtitle mono">Preview</h3>
                {previewText.notice && <p className="mr-inspector-note mono">{previewText.notice}</p>}
                {previewText.text !== '' && <pre className="mr-inspector-pre">{previewText.text}</pre>}
              </>
            )}
          </>
        )}

        {item.kind === 'internet' && (
          <>
            <dl className="mr-inspector-rows">
              <Row label="Connection">{internetStatus(connection)}</Row>
            </dl>
            <h3 className="mr-inspector-subtitle mono">On the web now</h3>
            {webNames.length === 0 ? (
              <p className="mr-inspector-note mono">No agents on the web now.</p>
            ) : (
              <ul className="mr-inspector-web" aria-label="Agents on the web">
                {webNames.map((name, index) => (
                  <li className="mr-inspector-web-agent mono" key={`${name}-${index}`}>
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {item.kind === 'git' && (
          <>
            {gitError && <p className="mr-inspector-error mono">{gitError}</p>}
            {git?.git === false && <p className="mr-inspector-note mono">This folder is not a git repository.</p>}
            {gitReady && (
              <>
                <dl className="mr-inspector-rows">
                  <Row label="Branch">{branchText}</Row>
                </dl>
                <h3 className="mr-inspector-subtitle mono">{`Changes ${changeCount}`}</h3>
                {changeRows.length === 0 ? (
                  <p className="mr-inspector-note mono">No uncommitted changes.</p>
                ) : (
                  <ul className="mr-inspector-changes" aria-label="Changes">
                    {changeRows.map((change, index) => (
                      <li className="mr-inspector-change" key={`${change.path}-${index}`}>
                        <button
                          type="button"
                          className="mr-inspector-change-btn mono"
                          onClick={() => onSelect({ kind: 'file', id: change.path })}
                          disabled={change.status === 'D'}
                        >
                          <span className="mr-inspector-change-path">{cutPath(change.path)}</span>
                          <span className="mr-inspector-change-status">{change.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <h3 className="mr-inspector-subtitle mono">Graph</h3>
                {graphRows.length === 0 ? (
                  <p className="mr-inspector-note mono">No commits.</p>
                ) : (
                  <ol className="mr-inspector-graph" aria-label="Commit graph">
                    {graphRows.map((row) => (
                      <li className="mr-inspector-graph-row" key={row.sha}>
                        <svg
                          className="mr-inspector-graph-svg"
                          width={graphWidth * 12}
                          height={24}
                          viewBox={`0 0 ${graphWidth * 12} 24`}
                          aria-hidden="true"
                        >
                          {row.edges.map((edge, index) => (
                            <line
                              key={`${edge.kind}-${index}`}
                              className={`mr-inspector-graph-edge is-${edge.kind}`}
                              x1={edge.from * 12 + 6}
                              y1={edge.kind === 'bottom' ? 12 : 0}
                              x2={edge.to * 12 + 6}
                              y2={edge.kind === 'top' ? 12 : 24}
                            />
                          ))}
                          <circle
                            className="mr-inspector-graph-dot"
                            cx={row.lane * 12 + 6}
                            cy={12}
                            r={3}
                            fill={row.sha === git.head ? '#e5ff00' : '#ffffff'}
                          />
                        </svg>
                        <span className="mr-inspector-graph-subject">{row.subject}</span>
                        {row.refs.map((ref) => (
                          <span
                            className={`mr-inspector-graph-ref${ref === git.branch ? ' is-current' : ''}`}
                            key={ref}
                          >
                            {ref}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ol>
                )}
                {git.truncated === true && (
                  <p className="mr-inspector-note mono">Showing the newest 200 commits.</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
