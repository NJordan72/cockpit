import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PaneNode } from '@shared/config'
import type { MenuItem } from '@shared/ipc'
import {
  formatReviewPrompt,
  startsCollapsed,
  type DiffFile,
  type DiffFileStatus,
  type DiffHunk,
  type ReviewComment,
  type ReviewDiff,
  type ReviewRef
} from '@shared/review'
import { splitPath } from '../activity/model'
import { PrPaneContext } from '../prs/context'
import type { HandOffTarget } from '../prs/model'
import { webPanes } from '../web/registry'
import { buildLineExcerpt, resolveLineRange, reviewHandOffChoices, soleAgentInDir } from './model'

/** Refresh the diff periodically while the pane is visible. */
const REFRESH_MS = 5_000

const STATUS_LETTER: Record<DiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: '?'
}

const NOT_SENT = "That pane isn't running an agent any more, so nothing was sent"

interface LineSelection {
  file: string
  hunkIndex: number
  anchorIdx: number
  endIdx: number
}

interface PendingSend {
  paneId: string
  paneLabel: string
  prompt: string
  commentIds: string[]
}

interface Props {
  pane: PaneNode & { review: ReviewRef }
  focused: boolean
  visible: boolean
  /** Optional repo-relative file path to scroll into view. */
  focusFile?: string | null
  onFocus: () => void
  onTitle: (title: string, branch?: string) => void
}

const newCommentId = (): string => `rc-${crypto.randomUUID().slice(0, 8)}`

const inside = (cwd: string, dir: string): boolean => cwd === dir || cwd.startsWith(`${dir}/`)

/**
 * Diff review pane: shows changes since merge-base with the remote's default
 * branch plus uncommitted/untracked files, lets the user click lines (or
 * Shift-click a range) to draft comments, and sends all comments to the task's
 * agent as one prompt.
 */
export function ReviewPane({
  pane,
  focused,
  visible,
  focusFile,
  onFocus,
  onTitle
}: Props): React.JSX.Element {
  const api = window.cockpit
  const env = useContext(PrPaneContext)
  const { id } = pane
  const { dir } = pane.review
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLElement>>(new Map())

  const [diff, setDiff] = useState<ReviewDiff | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showFiles, setShowFiles] = useState(true)
  /** User's explicit collapse overrides by file path. */
  const [collapsed, setCollapsed] = useState<ReadonlyMap<string, boolean>>(new Map())
  /** Draft comments collected in this pane. */
  const [comments, setComments] = useState<ReviewComment[]>([])
  /** Currently open inline comment composer selection. */
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  /** Queued send waiting for a busy agent pane to finish its current turn. */
  const [pending, setPending] = useState<PendingSend | null>(null)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const reads = useRef(0)
  const titleRef = useRef(onTitle)
  useEffect(() => {
    titleRef.current = onTitle
  })

  const load = useCallback(() => {
    const n = ++reads.current
    return api.review.diff(dir).then((r) => {
      if (n !== reads.current) return
      if (r.ok) {
        setDiff(r.diff)
        setReadError(null)
        const label = r.diff.branch ?? dir.split('/').filter(Boolean).pop() ?? dir
        titleRef.current(label, r.diff.branch ?? undefined)
      } else {
        setReadError(r.error)
      }
    })
  }, [api, dir])

  const refresh = useCallback((): void => {
    setLoading(true)
    void load().finally(() => {
      setLoading(false)
    })
  }, [load])

  // Refresh when visible and on a short interval while visible.
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

  // Refresh when any session in this directory changes state (e.g. agent finishes editing).
  const dirSessionKey = useMemo(
    () =>
      env.sessions
        .filter((s) => inside(s.cwd, dir))
        .map((s) => `${s.id}:${s.status}:${String(s.since)}`)
        .join('|'),
    [env.sessions, dir]
  )
  const prevSessionKey = useRef(dirSessionKey)
  useEffect(() => {
    if (prevSessionKey.current !== dirSessionKey) {
      prevSessionKey.current = dirSessionKey
      if (visible) void load()
    }
  }, [dirSessionKey, visible, load])

  // Register with webPanes so Cmd+R reloads the diff and focus requests land here.
  useEffect(() => {
    webPanes.set(id, {
      focus: () => rootRef.current?.focus(),
      reload: () => refresh()
    })
    return () => {
      webPanes.delete(id)
    }
  }, [id, refresh])

  useEffect(() => {
    const root = rootRef.current
    if (focused && visible && root && !root.contains(document.activeElement)) root.focus()
  }, [focused, visible])

  // Scroll to a requested file if provided.
  const scrollToFile = useCallback((filePath: string) => {
    setCollapsed((prev) => {
      const next = new Map(prev)
      next.set(filePath, false)
      return next
    })
    requestAnimationFrame(() => {
      fileRefs.current.get(filePath)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const lastFocusedFile = useRef<string | null>(null)
  useEffect(() => {
    if (!focusFile || !diff || focusFile === lastFocusedFile.current) return
    const match =
      diff.files.find((f) => f.path === focusFile) ??
      diff.files.find((f) => focusFile.endsWith(`/${f.path}`) || f.path.endsWith(`/${focusFile}`))
    if (!match) return
    lastFocusedFile.current = focusFile
    const frame = requestAnimationFrame(() => scrollToFile(match.path))
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [focusFile, diff, scrollToFile])

  const deliverNow = useCallback(
    async (target: HandOffTarget, prompt: string, commentIds: readonly string[]): Promise<void> => {
      setNotice(null)
      const ok = await env.handOff(prompt, target)
      if (!ok) {
        setNotice({ kind: 'error', text: NOT_SENT })
        return
      }
      const sent = new Set(commentIds)
      setComments((prev) => prev.filter((c) => !sent.has(c.id)))
      setPending(null)
      setNotice({
        kind: 'info',
        text: `Sent ${String(commentIds.length)} comment${commentIds.length === 1 ? '' : 's'} to agent.`
      })
    },
    [env]
  )

  // Flush queued send as soon as the target agent stops working.
  useEffect(() => {
    if (!pending) return
    const session = env.sessions.find((s) => s.id === pending.paneId)
    if (session?.status === 'working') return
    let cancelled = false
    const item = pending
    queueMicrotask(() => {
      if (cancelled) return
      if (!session || session.status === 'exited') {
        setPending(null)
        setNotice({ kind: 'error', text: NOT_SENT })
        return
      }
      setPending(null)
      void deliverNow({ kind: 'pane', paneId: item.paneId }, item.prompt, item.commentIds)
    })
    return () => {
      cancelled = true
    }
  }, [pending, env.sessions, deliverNow])

  const sendToTarget = useCallback(
    async (target: HandOffTarget): Promise<void> => {
      if (comments.length === 0) return
      const prompt = formatReviewPrompt(comments, {
        branch: diff?.branch ?? pane.review.branch ?? null,
        base: diff?.base ?? null
      })
      if (!prompt) return
      const ids = comments.map((c) => c.id)
      if (target.kind === 'pane') {
        const session = env.sessions.find((s) => s.id === target.paneId)
        if (session?.status === 'working') {
          setPending({
            paneId: session.id,
            paneLabel: session.title ?? session.name,
            prompt,
            commentIds: ids
          })
          setNotice(null)
          return
        }
      }
      await deliverNow(target, prompt, ids)
    },
    [comments, diff, pane.review.branch, env.sessions, deliverNow]
  )

  const chooseTarget = useCallback(async (): Promise<HandOffTarget | null> => {
    const groups = reviewHandOffChoices(
      diff?.root ?? dir,
      diff?.branch ?? pane.review.branch ?? null,
      env.sessions,
      env.tasks
    )
    const flat = groups.flat()
    const items: MenuItem[] = groups.flatMap((g, i) => [
      ...(i > 0 ? [{ type: 'separator' } as const] : []),
      ...g.map((c): MenuItem => ({ id: String(flat.indexOf(c)), label: c.label }))
    ])
    const chosen = await api.menu(items)
    return chosen === null ? null : (flat[Number(chosen)]?.target ?? null)
  }, [api, diff, dir, pane.review.branch, env.sessions, env.tasks])

  const sendDefault = async (): Promise<void> => {
    if (comments.length === 0) return
    const sole = soleAgentInDir(diff?.root ?? dir, env.sessions, env.tasks)
    if (sole) {
      await sendToTarget({ kind: 'pane', paneId: sole.id })
      return
    }
    const target = await chooseTarget()
    if (target) await sendToTarget(target)
  }

  const sendPickTarget = async (): Promise<void> => {
    if (comments.length === 0) return
    const target = await chooseTarget()
    if (target) await sendToTarget(target)
  }

  const isFileCollapsed = (file: DiffFile): boolean =>
    collapsed.get(file.path) ?? startsCollapsed(file)

  const toggleFile = (file: DiffFile): void => {
    const cur = isFileCollapsed(file)
    setCollapsed((prev) => {
      const next = new Map(prev)
      next.set(file.path, !cur)
      return next
    })
  }

  const onLineClick = (
    filePath: string,
    hunkIndex: number,
    lineIdx: number,
    shiftKey: boolean
  ): void => {
    if (shiftKey && selection?.file === filePath && selection.hunkIndex === hunkIndex) {
      setSelection({ ...selection, endIdx: lineIdx })
      return
    }
    setSelection({ file: filePath, hunkIndex, anchorIdx: lineIdx, endIdx: lineIdx })
    setDraftBody('')
  }

  const saveDraftComment = (file: DiffFile, hunk: DiffHunk): void => {
    if (selection?.file !== file.path) return
    const body = draftBody.trim()
    if (!body) return
    const range = resolveLineRange(hunk.lines, selection.anchorIdx, selection.endIdx)
    if (!range) return
    const excerpt = buildLineExcerpt(hunk.lines, selection.anchorIdx, selection.endIdx)
    setComments((prev) => [
      ...prev,
      {
        id: newCommentId(),
        path: file.path,
        startLine: range.startLine,
        endLine: range.endLine,
        side: range.side,
        excerpt,
        body
      }
    ])
    setSelection(null)
    setDraftBody('')
    setNotice(null)
  }

  const deleteComment = (commentId: string): void => {
    setComments((prev) => prev.filter((c) => c.id !== commentId))
    if (editingId === commentId) setEditingId(null)
  }

  const saveEdit = (commentId: string): void => {
    const body = editBody.trim()
    if (!body) return
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body } : c)))
    setEditingId(null)
    setEditBody('')
  }

  const commentsByFile = useMemo(() => {
    const map = new Map<string, ReviewComment[]>()
    for (const c of comments) {
      const list = map.get(c.path)
      if (list) list.push(c)
      else map.set(c.path, [c])
    }
    return map
  }, [comments])

  const fileSet = useMemo(() => new Set(diff?.files.map((f) => f.path) ?? []), [diff])
  const orphanComments = useMemo(
    () => (diff ? comments.filter((c) => !fileSet.has(c.path)) : []),
    [diff, comments, fileSet]
  )

  const soleAgent = useMemo(
    () => soleAgentInDir(diff?.root ?? dir, env.sessions, env.tasks),
    [diff?.root, dir, env.sessions, env.tasks]
  )

  const openFileInEditor = (relPath: string): void => {
    const base = diff?.root ?? dir
    api.editor.openFile(`${base}/${relPath}`)
  }

  const sendLabel =
    comments.length > 0
      ? `Send to ${soleAgent ? (soleAgent.title ?? soleAgent.name) : 'agent'} (${String(comments.length)})`
      : 'Send to agent'

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={`review-pane${focused ? ' focused' : ''}`}
      onMouseDown={onFocus}
    >
      <header className="review-head">
        <div className="review-title">
          <span className="review-branch" title={diff?.root ?? dir}>
            {diff?.branch ?? pane.review.branch ?? 'Diff'}
          </span>
          {diff?.base && (
            <span
              className="review-base"
              title={diff.mergeBase ? `merge-base ${diff.mergeBase}` : undefined}
            >
              vs {diff.base}
            </span>
          )}
          {diff && (
            <span className="review-stats">
              <span>
                {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
              </span>
              {diff.totalAdded > 0 && <span className="added">+{diff.totalAdded}</span>}
              {diff.totalRemoved > 0 && <span className="removed">−{diff.totalRemoved}</span>}
            </span>
          )}
          <div className="review-head-actions">
            <button
              type="button"
              tabIndex={-1}
              className={showFiles ? 'on' : undefined}
              title="Toggle file list"
              onClick={() => setShowFiles((s) => !s)}
            >
              Files
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={loading}
              title="Refresh diff (Cmd+R)"
              onClick={refresh}
            >
              ⟳
            </button>
            <div className="review-send-group">
              <button
                type="button"
                tabIndex={-1}
                className="review-send-btn"
                disabled={comments.length === 0}
                title={
                  comments.length === 0
                    ? 'Click any diff line to add a comment'
                    : 'Send all draft comments as one prompt'
                }
                onClick={() => void sendDefault()}
              >
                {sendLabel}
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="review-send-pick"
                disabled={comments.length === 0}
                aria-label="Choose agent pane"
                title="Choose which agent pane to send to"
                onClick={() => void sendPickTarget()}
              >
                ▾
              </button>
            </div>
          </div>
        </div>
        <div className="review-meta">
          <span className="review-dir">{diff?.root ?? dir}</span>
          <span className="review-hint">Click a line to comment · Shift+click for a range</span>
        </div>
      </header>

      {pending && (
        <div className="review-banner wait">
          <span>
            Queued {pending.commentIds.length}{' '}
            {pending.commentIds.length === 1 ? 'comment' : 'comments'} for {pending.paneLabel}{' '}
            (waiting until idle)…
          </span>
          <div className="review-banner-actions">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                const item = pending
                setPending(null)
                void deliverNow({ kind: 'pane', paneId: item.paneId }, item.prompt, item.commentIds)
              }}
            >
              Send now
            </button>
            <button type="button" tabIndex={-1} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className={`review-banner ${notice.kind}`}>
          <span>{notice.text}</span>
          <button type="button" tabIndex={-1} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {readError && <div className="review-banner error">{readError}</div>}

      {!diff && !readError ? (
        <p className="review-empty">Reading diff…</p>
      ) : diff?.files.length === 0 ? (
        <p className="review-empty">No changes on this branch.</p>
      ) : diff ? (
        <div className="review-body">
          {showFiles && (
            <aside className="review-files" aria-label="Changed files">
              <ul className="review-file-list">
                {diff.files.map((f) => {
                  const [d, base] = splitPath(f.path)
                  const count = commentsByFile.get(f.path)?.length ?? 0
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="review-file-item"
                        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                        onClick={() => scrollToFile(f.path)}
                      >
                        <span className={`review-status ${f.status}`}>
                          {STATUS_LETTER[f.status]}
                        </span>
                        <span className="review-file-name">
                          <span className="review-file-base">{base}</span>
                          {d && <span className="review-file-dir">{d}</span>}
                        </span>
                        {count > 0 && <span className="review-draft-pill">{count}</span>}
                        <span className="review-file-stat">
                          {f.added > 0 && <span className="added">+{f.added}</span>}
                          {f.removed > 0 && <span className="removed">−{f.removed}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </aside>
          )}
          <div className="review-diff">
            {diff.truncated && (
              <div className="review-banner wait">
                Diff was truncated to keep Cockpit responsive.
              </div>
            )}
            {orphanComments.length > 0 && (
              <div className="review-orphans">
                <div className="review-orphans-head">
                  Draft comments on files no longer in the diff ({orphanComments.length})
                </div>
                {orphanComments.map((c) => (
                  <div key={c.id} className="review-comment">
                    <div className="review-comment-head">
                      <span className="review-comment-loc">
                        {c.path}:
                        {c.startLine === c.endLine
                          ? String(c.startLine)
                          : `${String(c.startLine)}-${String(c.endLine)}`}
                      </span>
                      <button type="button" tabIndex={-1} onClick={() => deleteComment(c.id)}>
                        Delete
                      </button>
                    </div>
                    <div className="review-comment-body">{c.body}</div>
                  </div>
                ))}
              </div>
            )}
            {diff.files.map((file) => {
              const isCollapsed = isFileCollapsed(file)
              const fileComments = commentsByFile.get(file.path) ?? []
              return (
                <section
                  key={file.path}
                  className="review-file"
                  ref={(el) => {
                    if (el) fileRefs.current.set(file.path, el)
                    else fileRefs.current.delete(file.path)
                  }}
                >
                  <div className="review-file-head">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="review-collapse"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleFile(file)}
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                    <span className={`review-status ${file.status}`}>
                      {STATUS_LETTER[file.status]}
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="review-file-path"
                      onClick={() => toggleFile(file)}
                    >
                      {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                    </button>
                    {file.binary && <span className="review-tag">binary</span>}
                    {file.truncated && <span className="review-tag">large</span>}
                    {fileComments.length > 0 && (
                      <span className="review-draft-pill">
                        {fileComments.length} {fileComments.length === 1 ? 'comment' : 'comments'}
                      </span>
                    )}
                    <span className="review-file-stat">
                      {file.added > 0 && <span className="added">+{file.added}</span>}
                      {file.removed > 0 && <span className="removed">−{file.removed}</span>}
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="review-small"
                      title="Open in editor"
                      onClick={() => openFileInEditor(file.path)}
                    >
                      ✎
                    </button>
                  </div>
                  {isCollapsed ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="review-collapsed-note"
                      onClick={() => toggleFile(file)}
                    >
                      {file.binary
                        ? 'Binary file — diff not shown.'
                        : file.totalLines > 0
                          ? `Collapsed (${String(file.totalLines)} lines) — click to expand`
                          : 'Collapsed — click to expand'}
                    </button>
                  ) : file.binary ? (
                    <div className="review-binary">Binary file — diff not shown.</div>
                  ) : file.hunks.length === 0 ? (
                    <div className="review-binary">
                      {file.truncated
                        ? 'File is too large to display inline.'
                        : 'Empty file or mode-only change.'}
                    </div>
                  ) : (
                    <div className="review-hunks">
                      {file.hunks.map((hunk, hunkIdx) => {
                        const selLo =
                          selection?.file === file.path && selection.hunkIndex === hunkIdx
                            ? Math.min(selection.anchorIdx, selection.endIdx)
                            : -1
                        const selHi =
                          selection?.file === file.path && selection.hunkIndex === hunkIdx
                            ? Math.max(selection.anchorIdx, selection.endIdx)
                            : -1
                        return (
                          <div key={`${file.path}:${String(hunkIdx)}`} className="review-hunk">
                            <div className="review-hunk-head">{hunk.header}</div>
                            {hunk.lines.map((line, lineIdx) => {
                              const isSelected = lineIdx >= selLo && lineIdx <= selHi
                              const clickable = line.kind !== 'meta'
                              const lineComments = fileComments.filter((c) =>
                                c.side === 'old'
                                  ? line.oldLine === c.endLine && line.newLine === null
                                  : line.newLine === c.endLine
                              )
                              const showComposer = selHi === lineIdx
                              const composerRange = showComposer
                                ? resolveLineRange(hunk.lines, selLo, selHi)
                                : null
                              return (
                                <div key={lineIdx}>
                                  <div
                                    className={`review-line ${line.kind}${isSelected ? ' selected' : ''}${clickable ? ' clickable' : ''}`}
                                    onClick={
                                      clickable
                                        ? (e) =>
                                            onLineClick(file.path, hunkIdx, lineIdx, e.shiftKey)
                                        : undefined
                                    }
                                  >
                                    <span className="review-ln">{line.oldLine ?? ''}</span>
                                    <span className="review-ln">{line.newLine ?? ''}</span>
                                    <span className="review-sign">
                                      {line.kind === 'add'
                                        ? '+'
                                        : line.kind === 'del'
                                          ? '−'
                                          : line.kind === 'context'
                                            ? ' '
                                            : ''}
                                    </span>
                                    <span className="review-code">{line.text}</span>
                                  </div>
                                  {lineComments.map((c) => (
                                    <div key={c.id} className="review-comment">
                                      <div className="review-comment-head">
                                        <span className="review-comment-loc">
                                          {c.startLine === c.endLine
                                            ? `Line ${String(c.startLine)}`
                                            : `Lines ${String(c.startLine)}-${String(c.endLine)}`}
                                          {c.side === 'old' ? ' (removed)' : ''}
                                        </span>
                                        <div className="review-comment-actions">
                                          {editingId !== c.id && (
                                            <button
                                              type="button"
                                              tabIndex={-1}
                                              className="review-small"
                                              onClick={() => {
                                                setEditingId(c.id)
                                                setEditBody(c.body)
                                              }}
                                            >
                                              Edit
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            className="review-small"
                                            onClick={() => deleteComment(c.id)}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                      {editingId === c.id ? (
                                        <div className="review-compose">
                                          <textarea
                                            value={editBody}
                                            rows={3}
                                            autoFocus
                                            onChange={(e) => setEditBody(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                setEditingId(null)
                                              } else if (
                                                e.key === 'Enter' &&
                                                (e.metaKey || e.ctrlKey)
                                              ) {
                                                e.preventDefault()
                                                saveEdit(c.id)
                                              }
                                            }}
                                          />
                                          <div className="review-compose-actions">
                                            <button
                                              type="button"
                                              disabled={!editBody.trim()}
                                              onClick={() => saveEdit(c.id)}
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setEditingId(null)}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="review-comment-body">{c.body}</div>
                                      )}
                                    </div>
                                  ))}
                                  {showComposer && composerRange && (
                                    <div className="review-compose">
                                      <div className="review-compose-label">
                                        Comment on{' '}
                                        {composerRange.startLine === composerRange.endLine
                                          ? `line ${String(composerRange.startLine)}`
                                          : `lines ${String(composerRange.startLine)}-${String(composerRange.endLine)}`}
                                        {composerRange.side === 'old' ? ' (removed)' : ''}
                                      </div>
                                      <textarea
                                        value={draftBody}
                                        rows={3}
                                        autoFocus
                                        placeholder="Write a review comment… (⌘⏎ to add)"
                                        onChange={(e) => setDraftBody(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Escape') {
                                            setSelection(null)
                                            setDraftBody('')
                                          } else if (
                                            e.key === 'Enter' &&
                                            (e.metaKey || e.ctrlKey)
                                          ) {
                                            e.preventDefault()
                                            saveDraftComment(file, hunk)
                                          }
                                        }}
                                      />
                                      <div className="review-compose-actions">
                                        <button
                                          type="button"
                                          disabled={!draftBody.trim()}
                                          onClick={() => saveDraftComment(file, hunk)}
                                        >
                                          Add comment
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelection(null)
                                            setDraftBody('')
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                      {file.truncated && (
                        <div className="review-binary">
                          Diff truncated after{' '}
                          {String(file.hunks.reduce((n, h) => n + h.lines.length, 0))} of{' '}
                          {String(file.totalLines)} lines.
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
