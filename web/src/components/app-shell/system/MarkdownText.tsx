import { Fragment, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

/**
 * Light markdown rendered as React text: paragraphs, "- " lists, `code`, **bold** and
 * [text](https://…) links. Nothing is parsed as HTML, so a "<script>" in a note shows as text.
 */
export interface MarkdownTextProps {
  source: string;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <Box key={key} component="code" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em', px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover', overflowWrap: 'anywhere' }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) return <strong key={key}>{part.slice(2, -2)}</strong>;
    const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (m) {
      const [, label, href] = m;
      return /^https?:\/\//.test(href ?? '') ? (
        <Link key={key} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </Link>
      ) : (
        <Fragment key={key}>{label}</Fragment>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function MarkdownText({ source }: MarkdownTextProps) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <Box sx={{ '& > * + *': { mt: 1 } }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^[-*] /.test(l.trim()))) {
          return (
            <Box key={bi} component="ul" sx={{ m: 0, pl: 2.5 }}>
              {lines.map((l, li) => (
                <Typography key={li} component="li" variant="body2">
                  {inline(l.trim().slice(2), `${bi}-${li}`)}
                </Typography>
              ))}
            </Box>
          );
        }
        return (
          <Typography key={bi} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </Typography>
        );
      })}
    </Box>
  );
}
