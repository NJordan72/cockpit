import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PaneNode } from '@shared/config'
import type { MenuItem } from '@shared/ipc'
import {
  checkPrompt,
  feedbackPrompt,
  MERGE_LABEL,
  stripHtmlComments,
  threadPlace,
  type Feedback,
  type MergeMethod,
  type PrAct,
  type PrCheck,
  type PrDetail,
  type PrNote,
  type PrRef,
  type PrThread
} from '@shared/prs'
import { Markdown } from '../activity/Markdown'
import { webPanes } from '../web/registry'
import { PrPaneContext } from './context'
import {
  ago,
  feedbackKey,
  handOffChoices,
  hunkTail,
  sortThreads,
  startsOpen,
  timeline,
  type HandOffTarget
} from './model'

/** How often the pull request is read again while the pane is on screen. */
const REFRESH_MS = 60_000

type Tab = 'conversation' | 'threads' | 'checks'

interface Props {
  pane: PaneNode & { pr: PrRef }
  focused: boolean
  visible: boolean
  onFocus: () => void
  onTitle: (title: string) => void
}

const REVIEW_LABEL = {
  approved: 'approved',
  changes: 'changes requested',
  required: 'review required'
}

const VERDICT_LABEL = {
  approved: 'approved',
  changes: 'requested changes',
  commented: 'reviewed',
  dismissed: 'review dismissed'
}

const STATE_LABEL = { open: 'Open', closed: 'Closed', merged: 'Merged' }

const NOT_SENT = "That pane isn't running an agent any more, so nothing was sent"

const openLink = (href: string): void => window.cockpit.web.openExternal(href)

function Note({ note, label }: { note: PrNote; label?: string }): React.JSX.Element {
  const text = stripHtmlComments(note.body)
  return (
    <div className="pr-note">
      <div className="pr-note-head">
        <span className="pr-author">{note.author}</span>
        {note.bot && <span className="pr-tag">bot</span>}
        {label && <span className="pr-verdict">{label}</span>}
        <span className="pr-when">{ago(note.at)}</span>
      </div>
      {text ? <Markdown text={text} onLink={openLink} /> : null}
    </div>
  )
}

/** A pull request: its feedback, which can be answered here or handed to an agent, and its checks. */
export function PrPane({ pane, focused, visible, onFocus, onTitle }: Props): React.JSX.Element {
  const api = window.cockpit
  const env = useContext(PrPaneContext)
  const { id } = pane
  const { repo, number } = pane.pr
  const ref = useMemo(() => ({ repo, number }), [repo, number])
  const rootRef = useRef<HTMLDivElement>(null)
  /** The last good read, kept when a later one fails. */
  const [pr, setPr] = useState<PrDetail | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  /** Only the newest read applies, so a slow poll can't undo what an action just showed. */
  const reads = useRef(0)
  const [loading, setLoading] = useState(false)
  /** What's running, shown in place of the error line. */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  /** Threads the user opened or closed, overriding startsOpen. */
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [showResolved, setShowResolved] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [draft, setDraft] = useState('')
  const titleRef = useRef(onTitle)
  useEffect(() => {
    titleRef.current = onTitle
  })

  const load = useCallback(() => {
    const n = ++reads.current
    return api.prs.view(ref).then((r) => {
      if (n !== reads.current) return
      if (r.ok) {
        setPr(r.pr)
        setReadError(null)
        titleRef.current(r.pr.title)
      } else setReadError(r.error)
    })
  }, [api, ref])

  const refresh = (): void => {
    setLoading(true)
    void load().finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => {
    if (!visible) return
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => {
      clearInterval(timer)
    }
  }, [visible, load])

  // Cmd+R and focus requests reach the pane the way they reach a web pane.
  useEffect(() => {
    webPanes.set(id, {
      focus: () => rootRef.current?.focus(),
      reload: () => void load()
    })
    return () => {
      webPanes.delete(id)
    }
  }, [id, load])

  useEffect(() => {
    const root = rootRef.current
    if (focused && visible && root && !root.contains(document.activeElement)) root.focus()
  }, [focused, visible])

  const act = async (label: string, a: PrAct): Promise<boolean> => {
    setBusy(label)
    setError(null)
    try {
      const r = await api.prs.act(ref, a)
      if (r.ok) {
        await load()
        return true
      }
      if (!('cancelled' in r)) setError(r.error)
      return false
    } finally {
      setBusy(null)
    }
  }

  const chooseTarget = async (pr: PrDetail): Promise<HandOffTarget | null> => {
    const groups = handOffChoices(pr, pane.cwd, env.sessions, env.tasks)
    const flat = groups.flat()
    const items: MenuItem[] = groups.flatMap((g, i) => [
      ...(i > 0 ? [{ type: 'separator' } as const] : []),
      ...g.map((c): MenuItem => ({ id: String(flat.indexOf(c)), label: c.label }))
    ])
    const chosen = await api.menu(items)
    return chosen === null ? null : (flat[Number(chosen)]?.target ?? null)
  }

  const sendFeedback = async (pr: PrDetail, items: Feedback[], clear: boolean): Promise<void> => {
    if (items.length === 0) return
    const target = await chooseTarget(pr)
    if (!target) return
    if (!(await env.handOff(feedbackPrompt(pr, items), target))) {
      setError(NOT_SENT)
      return
    }
    if (clear) setSelected(new Set())
  }

  const sendCheck = async (pr: PrDetail, check: PrCheck): Promise<void> => {
    const target = await chooseTarget(pr)
    if (!target) return
    let log: string | null = null
    if (check.jobId !== null) {
      setBusy('Reading the log…')
      const r = await api.prs.log(ref, check.jobId)
      setBusy(null)
      if (r.ok) log = r.log
    }
    if (!(await env.handOff(checkPrompt(pr, check, log), target))) setError(NOT_SENT)
  }

  /** A resolved thread leaves the list, so it leaves the selection too. */
  const resolve = async (thread: PrThread, resolved: boolean): Promise<void> => {
    const ok = await act(resolved ? 'Resolving…' : 'Unresolving…', {
      type: 'resolve',
      threadId: thread.id,
      resolved
    })
    if (ok && resolved) {
      setSelected((s) => {
        const next = new Set(s)
        next.delete(feedbackKey({ kind: 'thread', thread }))
        return next
      })
    }
  }

  const merge = async (pr: PrDetail): Promise<void> => {
    const chosen = await api.menu(pr.mergeMethods.map((m) => ({ id: m, label: MERGE_LABEL[m] })))
    if (chosen) await act('Merging…', { type: 'merge', method: chosen as MergeMethod })
  }

  const toggle = (key: string): void => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const sendReply = async (thread: PrThread, andResolve: boolean): Promise<void> => {
    const text = reply
    if (!text.trim() || busy !== null) return
    if (!(await act('Replying…', { type: 'reply', threadId: thread.id, body: text }))) return
    setReply('')
    setReplyTo(null)
    if (andResolve) await resolve(thread, true)
  }

  const submit = async (a: PrAct, label: string): Promise<void> => {
    if (busy !== null) return
    if (await act(label, a)) setDraft('')
  }
  const keep = (e: React.MouseEvent): void => {
    // Buttons leave the keyboard where it was.
    e.preventDefault()
  }

  if (!pr) {
    return (
      <div className="pr-pane" ref={rootRef} tabIndex={-1} onMouseDown={onFocus}>
        <p className="pr-empty">{readError ?? `Reading ${repo}#${String(number)}…`}</p>
        {readError && (
          <p className="pr-empty">
            <button type="button" tabIndex={-1} onClick={refresh}>
              Try again
            </button>
          </p>
        )}
      </div>
    )
  }

  const threads = sortThreads(pr.threads)
  const unresolved = threads.filter((t) => !t.resolved)
  const resolvedCount = threads.length - unresolved.length
  const shownThreads = showResolved ? threads : unresolved
  const items = timeline(pr)
  const failing = pr.checks.filter((c) => c.state === 'failing').length
  const pending = pr.checks.filter((c) => c.state === 'pending').length
  const shown: Tab = tab ?? (unresolved.length > 0 ? 'threads' : 'conversation')
  // Only what's on screen counts, so a ticked thread that got resolved isn't sent.
  const onScreen: Feedback[] = [
    ...shownThreads.map((thread): Feedback => ({ kind: 'thread', thread })),
    ...items
  ]
  const chosen = onScreen.filter((f) => selected.has(feedbackKey(f)))
  const isOpen = pr.state === 'open'
  const canReview = isOpen && !pr.mine

  const checkbox = (f: Feedback): React.JSX.Element => (
    <input
      type="checkbox"
      tabIndex={-1}
      aria-label="Select to send to an agent"
      checked={selected.has(feedbackKey(f))}
      onChange={() => {
        toggle(feedbackKey(f))
      }}
    />
  )

  const toAgent = (f: Feedback): React.JSX.Element => (
    <button
      type="button"
      tabIndex={-1}
      className="pr-small"
      title="Send this to an agent"
      onMouseDown={keep}
      onClick={() => void sendFeedback(pr, [f], false)}
    >
      → Agent
    </button>
  )

  const threadView = (t: PrThread): React.JSX.Element => {
    const f: Feedback = { kind: 'thread', thread: t }
    const opened = expanded.get(t.id) ?? startsOpen(t)
    return (
      <li key={t.id} className={`pr-thread${t.resolved ? ' resolved' : ''}`}>
        <div className="pr-item-head">
          {checkbox(f)}
          <button
            type="button"
            tabIndex={-1}
            className="pr-place"
            aria-expanded={opened}
            onClick={() => {
              setExpanded((m) => new Map(m).set(t.id, !opened))
            }}
          >
            {opened ? '▾' : '▸'} {threadPlace(t)}
          </button>
          {t.outdated && <span className="pr-tag">outdated</span>}
          {t.resolved && <span className="pr-tag">resolved</span>}
          {!opened && t.comments[0] && (
            <span className="pr-peek">
              {t.comments[0].author}: {stripHtmlComments(t.comments[0].body).split('\n')[0]}
            </span>
          )}
          <span className="pr-item-actions">
            {toAgent(f)}
            {(t.resolved ? t.canUnresolve : t.canResolve) && (
              <button
                type="button"
                tabIndex={-1}
                className="pr-small"
                onMouseDown={keep}
                onClick={() => void resolve(t, !t.resolved)}
              >
                {t.resolved ? 'Unresolve' : 'Resolve'}
              </button>
            )}
            {t.comments[0] && (
              <button
                type="button"
                tabIndex={-1}
                className="pr-small"
                title="Open on GitHub"
                onMouseDown={keep}
                onClick={() => {
                  const url = t.comments[0]?.url
                  api.prs.open(url && url.length > 0 ? url : pr.url)
                }}
              >
                ↗
              </button>
            )}
          </span>
        </div>
        {opened && (
          <div className="pr-item-body">
            {t.hunk && (
              <pre className="pr-hunk">
                {hunkTail(t.hunk).map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : undefined
                    }
                  >
                    {line || ' '}
                  </div>
                ))}
              </pre>
            )}
            {t.comments.map((c) => (
              <Note key={c.id} note={c} />
            ))}
            {t.canReply &&
              (replyTo === t.id ? (
                <div className="pr-compose">
                  <textarea
                    autoFocus
                    rows={3}
                    placeholder="Reply"
                    value={reply}
                    onChange={(e) => {
                      setReply(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.metaKey) {
                        e.preventDefault()
                        void sendReply(t, false)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setReplyTo(null)
                        rootRef.current?.focus()
                      }
                    }}
                  />
                  <div className="pr-compose-actions">
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={!reply.trim() || busy !== null}
                      onClick={() => void sendReply(t, false)}
                    >
                      Reply
                    </button>
                    {t.canResolve && !t.resolved && (
                      <button
                        type="button"
                        tabIndex={-1}
                        disabled={!reply.trim() || busy !== null}
                        onClick={() => void sendReply(t, true)}
                      >
                        Reply and resolve
                      </button>
                    )}
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        setReplyTo(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  className="pr-small pr-reply"
                  onClick={() => {
                    setReplyTo(t.id)
                    setReply('')
                  }}
                >
                  Reply
                </button>
              ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <div
      className={`pr-pane${focused ? ' focused' : ''}`}
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={onFocus}
    >
      <header className="pr-head">
        <div className="pr-title">
          <span className={`pr-state ${pr.draft && isOpen ? 'draft' : pr.state}`}>
            {pr.draft && isOpen ? 'Draft' : STATE_LABEL[pr.state]}
          </span>
          <span className="pr-title-text">
            <span className="pr-number">#{pr.number}</span> {pr.title}
          </span>
          <span className="pr-head-actions">
            <button
              type="button"
              tabIndex={-1}
              title="Read it again"
              disabled={loading}
              onMouseDown={keep}
              onClick={refresh}
            >
              {loading ? '…' : '⟳'}
            </button>
            <button
              type="button"
              tabIndex={-1}
              title="Open on GitHub"
              onMouseDown={keep}
              onClick={() => {
                api.prs.open(pr.url)
              }}
            >
              ↗
            </button>
            {isOpen && pr.draft && pr.canUpdate && (
              <button
                type="button"
                tabIndex={-1}
                disabled={busy !== null}
                onClick={() => void act('Marking it ready…', { type: 'ready' })}
              >
                Ready for review
              </button>
            )}
            {isOpen && !pr.draft && pr.mergeMethods.length > 0 && (
              <button
                type="button"
                tabIndex={-1}
                disabled={busy !== null || pr.mergeable === 'conflicts'}
                title={pr.mergeable === 'conflicts' ? 'It has conflicts with its base' : undefined}
                onClick={() => void merge(pr)}
              >
                Merge ▾
              </button>
            )}
            {isOpen && pr.canUpdate && (
              <button
                type="button"
                tabIndex={-1}
                disabled={busy !== null}
                onClick={() => void act('Closing…', { type: 'close' })}
              >
                Close
              </button>
            )}
            {pr.state === 'closed' && pr.canUpdate && (
              <button
                type="button"
                tabIndex={-1}
                disabled={busy !== null}
                onClick={() => void act('Reopening…', { type: 'reopen' })}
              >
                Reopen
              </button>
            )}
          </span>
        </div>
        <div className="pr-meta">
          <span>
            {pr.author} wants {pr.branch} in {pr.base}
          </span>
          {pr.review && <span>{REVIEW_LABEL[pr.review]}</span>}
          {pr.checks.length > 0 && (
            <span className={failing ? 'bad' : pending ? 'wait' : 'good'}>
              {failing
                ? `${String(failing)} failing`
                : pending
                  ? `${String(pending)} pending`
                  : 'checks pass'}
            </span>
          )}
          {pr.mergeable === 'conflicts' && <span className="bad">conflicts</span>}
          <span>{repo}</span>
        </div>
      </header>
      <nav className="pr-tabs">
        {(
          [
            ['threads', `Threads ${String(unresolved.length)}`],
            ['conversation', `Conversation ${String(items.length)}`],
            ['checks', `Checks${failing ? ` · ${String(failing)} failing` : ''}`]
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            tabIndex={-1}
            className={`activity-chip${shown === t ? ' on' : ''}`}
            aria-pressed={shown === t}
            onClick={() => {
              setTab(t)
            }}
          >
            {label}
          </button>
        ))}
        {shown === 'threads' && resolvedCount > 0 && (
          <button
            type="button"
            tabIndex={-1}
            className="pr-small pr-tabs-end"
            onClick={() => {
              setShowResolved((s) => !s)
            }}
          >
            {showResolved ? 'Hide resolved' : `Show ${String(resolvedCount)} resolved`}
          </button>
        )}
      </nav>
      {(busy ?? error ?? readError) && (
        <div className={`pr-status${!busy ? ' error' : ''}`}>
          {busy ?? error ?? `Couldn't read it again: ${readError ?? ''}`}
        </div>
      )}
      {pr.partial && (
        <div className="pr-status">
          GitHub has more comments, reviews, or threads than Cockpit reads. Open it on GitHub to see
          them all.
        </div>
      )}
      <div className="pr-body">
        {shown === 'threads' &&
          (shownThreads.length === 0 ? (
            <p className="pr-empty">
              {threads.length === 0 ? 'No review threads' : 'Every thread is resolved'}
            </p>
          ) : (
            <ol className="pr-list">{shownThreads.map(threadView)}</ol>
          ))}
        {shown === 'conversation' && (
          <>
            {stripHtmlComments(pr.body) && (
              <div className="pr-description">
                <Markdown text={stripHtmlComments(pr.body)} onLink={openLink} />
              </div>
            )}
            <ol className="pr-list">
              {items.map((item) => (
                <li key={item.note.id} className="pr-thread">
                  <div className="pr-item-head">
                    {checkbox(item)}
                    <span className="pr-item-kind">
                      {item.kind === 'review' ? `Review` : 'Comment'}
                    </span>
                    <span className="pr-item-actions">
                      {toAgent(item)}
                      <button
                        type="button"
                        tabIndex={-1}
                        className="pr-small"
                        title="Open on GitHub"
                        onMouseDown={keep}
                        onClick={() => {
                          api.prs.open(item.note.url || pr.url)
                        }}
                      >
                        ↗
                      </button>
                    </span>
                  </div>
                  <div className="pr-item-body">
                    <Note
                      note={item.note}
                      label={item.kind === 'review' ? VERDICT_LABEL[item.note.verdict] : undefined}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <div className="pr-compose">
              <textarea
                rows={4}
                placeholder={
                  canReview
                    ? 'Comment, or a review to go with Approve or Request changes'
                    : 'Comment'
                }
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey && draft.trim()) {
                    e.preventDefault()
                    void submit({ type: 'comment', body: draft }, 'Commenting…')
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    rootRef.current?.focus()
                  }
                }}
              />
              <div className="pr-compose-actions">
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={!draft.trim() || busy !== null}
                  onClick={() => void submit({ type: 'comment', body: draft }, 'Commenting…')}
                >
                  Comment
                </button>
                {canReview && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={busy !== null}
                      onClick={() =>
                        void submit(
                          { type: 'review', verdict: 'approve', body: draft },
                          'Approving…'
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={!draft.trim() || busy !== null}
                      title="Needs a comment"
                      onClick={() =>
                        void submit(
                          { type: 'review', verdict: 'changes', body: draft },
                          'Requesting changes…'
                        )
                      }
                    >
                      Request changes
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
        {shown === 'checks' &&
          (pr.checks.length === 0 ? (
            <p className="pr-empty">No checks on the latest commit</p>
          ) : (
            <ol className="pr-list">
              {pr.checks.map((c, i) => (
                <li key={`${c.name}:${String(i)}`} className="pr-check">
                  <span className={`pr-dot ${c.state}`} title={c.state} />
                  <span className="pr-check-name">
                    {c.workflow && c.workflow !== c.name ? `${c.workflow} / ` : ''}
                    {c.name}
                  </span>
                  <span className="pr-when">{c.state}</span>
                  <span className="pr-item-actions">
                    {c.state === 'failing' && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="pr-small"
                        title="Send it to an agent with the end of its log"
                        disabled={busy !== null}
                        onMouseDown={keep}
                        onClick={() => void sendCheck(pr, c)}
                      >
                        → Agent
                      </button>
                    )}
                    {c.url && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="pr-small"
                        title="Open its details"
                        onMouseDown={keep}
                        onClick={() => {
                          if (c.url) openLink(c.url)
                        }}
                      >
                        ↗
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          ))}
      </div>
      {chosen.length > 0 && (
        <footer className="pr-send">
          <span>{chosen.length} selected</span>
          <button
            type="button"
            tabIndex={-1}
            className="pr-primary"
            onMouseDown={keep}
            onClick={() => void sendFeedback(pr, chosen, true)}
          >
            Send to an agent ▾
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setSelected(new Set())
            }}
          >
            Clear
          </button>
        </footer>
      )}
    </div>
  )
}
