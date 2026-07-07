"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownContentProps {
  content: string
  className?: string
  /**
   * When true, renders inside a user bubble (primary background).
   * Adjusts code block and link colours accordingly.
   */
  isUser?: boolean
}

/**
 * Renders markdown from model responses with clean, consumer-grade typography.
 * Supports GFM (GitHub-Flavored Markdown): tables, strikethrough, task lists, autolinks.
 */
export function MarkdownContent({ content, className, isUser = false }: MarkdownContentProps) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs — trim trailing margin on last child to keep bubble padding clean
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>
          },

          // Headings — scaled to feel natural inside a chat bubble
          h1({ children }) {
            return <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="text-sm font-semibold mb-1.5 mt-3 first:mt-0">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="text-sm font-medium mb-1 mt-2 first:mt-0">{children}</h3>
          },
          h4({ children }) {
            return <h4 className="text-sm font-medium mb-1 mt-2 first:mt-0">{children}</h4>
          },

          // Lists
          ul({ children }) {
            return <ul className="mb-2 last:mb-0 pl-4 space-y-0.5 list-disc">{children}</ul>
          },
          ol({ children }) {
            return <ol className="mb-2 last:mb-0 pl-4 space-y-0.5 list-decimal">{children}</ol>
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>
          },

          // Inline code vs fenced code block
          code({ children, className: langClass, ...rest }) {
            const isInline = !langClass
            if (isInline) {
              return (
                <code
                  className={cn(
                    "px-1 py-0.5 rounded text-[0.8em] font-mono",
                    isUser
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-surface-sunken text-foreground border border-border/40"
                  )}
                  {...rest}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={cn("font-mono text-xs", langClass)} {...rest}>
                {children}
              </code>
            )
          },

          // Fenced code blocks
          pre({ children }) {
            return (
              <pre
                className={cn(
                  "my-2 p-3 rounded-lg text-xs font-mono overflow-x-auto",
                  isUser
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "bg-surface-sunken text-foreground border border-border/40"
                )}
              >
                {children}
              </pre>
            )
          },

          // Blockquote
          blockquote({ children }) {
            return (
              <blockquote
                className={cn(
                  "border-l-2 pl-3 my-2 italic",
                  isUser
                    ? "border-primary-foreground/40 text-primary-foreground/80"
                    : "border-border text-muted-foreground"
                )}
              >
                {children}
              </blockquote>
            )
          },

          // Horizontal rule
          hr() {
            return (
              <hr
                className={cn(
                  "my-3 border-t",
                  isUser ? "border-primary-foreground/30" : "border-border"
                )}
              />
            )
          },

          // Links
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "underline underline-offset-2 hover:opacity-80 transition-opacity",
                  isUser ? "text-primary-foreground" : "text-foreground"
                )}
              >
                {children}
              </a>
            )
          },

          // Bold
          strong({ children }) {
            return <strong className="font-semibold">{children}</strong>
          },

          // Italic
          em({ children }) {
            return <em className="italic">{children}</em>
          },

          // Strikethrough (GFM)
          del({ children }) {
            return <del className="line-through opacity-70">{children}</del>
          },

          // Tables (GFM)
          table({ children }) {
            return (
              <div className="my-2 overflow-x-auto">
                <table className="w-full text-xs border-collapse">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return (
              <thead
                className={cn(
                  isUser ? "border-b border-primary-foreground/30" : "border-b border-border"
                )}
              >
                {children}
              </thead>
            )
          },
          th({ children }) {
            return <th className="px-2 py-1 text-left font-semibold">{children}</th>
          },
          td({ children }) {
            return (
              <td
                className={cn(
                  "px-2 py-1",
                  isUser ? "border-t border-primary-foreground/20" : "border-t border-border/50"
                )}
              >
                {children}
              </td>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
