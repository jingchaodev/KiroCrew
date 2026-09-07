import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { i18nT } from '../i18n/t'

/**
 * The markdown content card (#9196): a fenced ```markdown block carries a
 * Formatted/Raw segmented toggle, Formatted by default — rendered structure
 * instead of `##` and `|---|` source. Raw restores the exact source and is
 * where the edit affordance lives. Non-markdown fences are untouched.
 */

const MD_FENCE = '```markdown\n## Heading text\n\n- item one\n- item two\n```'
const PY_FENCE = '```python\nprint("x")\n```'

function formattedLabel(): string {
  return i18nT('pages.chat.toolDetails.formatted')
}
function rawLabel(): string {
  return i18nT('pages.chat.toolDetails.raw')
}

describe('MarkdownContentCard (#9196)', () => {
  it('renders a fenced markdown block formatted by default, with the toggle', () => {
    const { container } = render(<MarkdownRenderer content={MD_FENCE} />)
    // Toggle present…
    expect(screen.getByText(formattedLabel())).toBeTruthy()
    expect(screen.getByText(rawLabel())).toBeTruthy()
    // …and the content is RENDERED: a real <h2>, not source text with ##.
    const h2 = container.querySelector('h2')
    expect(h2?.textContent).toContain('Heading text')
    expect(container.textContent).not.toContain('## Heading')
    expect(container.querySelectorAll('li').length).toBe(2)
  })

  it('switches to raw source when Raw is clicked, and back', () => {
    const { container } = render(<MarkdownRenderer content={MD_FENCE} />)
    fireEvent.click(screen.getByText(rawLabel()))
    // Raw: source text visible verbatim, no rendered heading.
    expect(container.textContent).toContain('## Heading text')
    expect(container.querySelector('h2')).toBeNull()
    // The edit affordance lives in raw mode.
    expect(
      screen.getByLabelText(i18nT('components.monacoCodeBlock.edit_code_block')),
    ).toBeTruthy()
    fireEvent.click(screen.getByText(formattedLabel()))
    expect(container.querySelector('h2')).toBeTruthy()
  })

  it('does not add the toggle to non-markdown fences', () => {
    render(<MarkdownRenderer content={PY_FENCE} />)
    expect(screen.queryByText(formattedLabel())).toBeNull()
    expect(screen.queryByText(rawLabel())).toBeNull()
  })
})
