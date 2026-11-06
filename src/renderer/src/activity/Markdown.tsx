// Markdown drawn as React elements from marked's tokens. No HTML string is
// ever put into the page: raw HTML in the source shows as text, images show
// as their alt text, and links open in the browser only for http(s).
import { Fragment, memo, useMemo } from 'react'
import { Lexer, type Token, type Tokens } from 'marked'

/** Written this way because the formatter turns a \u00a0 escape into an invisible character. */
const NBSP = String.fromCharCode(0xa0)

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP
}

/** marked leaves entities in text as written; React would show "&amp;". */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const isHttp = (href: string): boolean => /^https?:\/\//i.test(href)

type OnLink = (href: string) => void

function inline(tokens: Token[] | undefined, onLink: OnLink): React.ReactNode {
  if (!tokens) return null
  return tokens.map((t, i) => <Fragment key={i}>{inlineToken(t, onLink)}</Fragment>)
}

function inlineToken(t: Token, onLink: OnLink): React.ReactNode {
  switch (t.type) {
    case 'text': {
      const tok = t as Tokens.Text
      return tok.tokens ? inline(tok.tokens, onLink) : decodeEntities(tok.text)
    }
    case 'escape':
      return (t as Tokens.Escape).text
    case 'strong':
      return <strong>{inline((t as Tokens.Strong).tokens, onLink)}</strong>
    case 'em':
      return <em>{inline((t as Tokens.Em).tokens, onLink)}</em>
    case 'del':
      return <del>{inline((t as Tokens.Del).tokens, onLink)}</del>
    case 'codespan':
      return <code>{(t as Tokens.Codespan).text}</code>
    case 'br':
      return <br />
    case 'link': {
      const tok = t as Tokens.Link
      const external = isHttp(tok.href)
      return (
        <a
          href={external ? tok.href : undefined}
          title={tok.href}
          onClick={(e) => {
            e.preventDefault()
            if (external) onLink(tok.href)
          }}
        >
          {inline(tok.tokens, onLink)}
        </a>
      )
    }
    case 'image': {
      const tok = t as Tokens.Image
      return <span className="md-raw">[{tok.text || tok.href}]</span>
    }
    case 'html':
      return <span className="md-raw">{(t as Tokens.HTML).text}</span>
    default:
      return 'tokens' in t && Array.isArray(t.tokens) ? inline(t.tokens, onLink) : t.raw
  }
}

function blocks(tokens: Token[], onLink: OnLink): React.ReactNode {
  return tokens.map((t, i) => <Fragment key={i}>{block(t, onLink)}</Fragment>)
}

function block(t: Token, onLink: OnLink): React.ReactNode {
  switch (t.type) {
    case 'space':
    case 'def':
      return null
    case 'heading': {
      const tok = t as Tokens.Heading
      const Tag = `h${String(Math.min(6, Math.max(1, tok.depth)))}` as 'h1'
      return <Tag>{inline(tok.tokens, onLink)}</Tag>
    }
    case 'paragraph':
      return <p>{inline((t as Tokens.Paragraph).tokens, onLink)}</p>
    case 'text': {
      // The text of a tight list item.
      const tok = t as Tokens.Text
      return tok.tokens ? inline(tok.tokens, onLink) : decodeEntities(tok.text)
    }
    case 'list': {
      const tok = t as Tokens.List
      const items = tok.items.map((item, i) => (
        <li key={i} className={item.task ? 'md-task' : undefined}>
          {blocks(item.tokens, onLink)}
        </li>
      ))
      return tok.ordered ? (
        <ol start={typeof tok.start === 'number' && tok.start !== 1 ? tok.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul>{items}</ul>
      )
    }
    case 'checkbox': {
      const done = (t as Tokens.Checkbox).checked
      return (
        <span
          className={`md-check${done ? ' on' : ''}`}
          role="img"
          aria-label={done ? 'Done' : 'To do'}
        />
      )
    }
    case 'code':
      return (
        <pre className="md-code">
          <code>{(t as Tokens.Code).text}</code>
        </pre>
      )
    case 'blockquote':
      return <blockquote>{blocks((t as Tokens.Blockquote).tokens, onLink)}</blockquote>
    case 'table': {
      const tok = t as Tokens.Table
      const align = (a: Tokens.TableCell['align']): React.CSSProperties | undefined =>
        a ? { textAlign: a } : undefined
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {tok.header.map((c, i) => (
                  <th key={i} style={align(c.align)}>
                    {inline(c.tokens, onLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tok.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} style={align(c.align)}>
                      {inline(c.tokens, onLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'hr':
      return <hr />
    case 'html':
      return <p className="md-raw">{(t as Tokens.HTML).text}</p>
    default:
      return 'tokens' in t && Array.isArray(t.tokens) ? (
        <p>{inline(t.tokens, onLink)}</p>
      ) : (
        <p className="md-raw">{t.raw}</p>
      )
  }
}

/** A Markdown document. `onLink` gets the http(s) links the user clicks. */
export const Markdown = memo(function Markdown({
  text,
  onLink
}: {
  text: string
  onLink: OnLink
}): React.JSX.Element {
  const tokens = useMemo(() => new Lexer({ gfm: true }).lex(text), [text])
  return <div className="md">{blocks(tokens, onLink)}</div>
})
