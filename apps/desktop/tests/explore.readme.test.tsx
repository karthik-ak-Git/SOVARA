import { describe, it, expect } from 'vitest'
import { restoreHtmlTags, escHtml, renderReadmeDoc } from '../../web/src/features/explore/ExplorePage'

const SLUG = 'google/gemma-4-12b'

describe('README literal HTML (Gemma-style cards)', () => {
  it('renders centered banner div + img instead of escaped text', () => {
    const html = restoreHtmlTags(escHtml('<div align="center">'), SLUG)
    expect(html).toBe('<div align="center">')
    const img = restoreHtmlTags(escHtml('<img src=https://ai.google.dev/gemma/images/gemma4_banner.png>'), SLUG)
    expect(img).toContain('<img')
    expect(img).toContain('https://ai.google.dev/gemma/images/gemma4_banner.png')
    expect(img).toContain('loading="lazy"')
    expect(img).not.toContain('&lt;')
  })

  it('restores anchors as external links without target attrs', () => {
    const html = restoreHtmlTags(
      escHtml('<a href="https://huggingface.co/collections/google/gemma-4" target="_blank">Hugging Face</a>'),
      SLUG,
    )
    expect(html).toContain('<a href="https://huggingface.co/collections/google/gemma-4" data-ext="1" class="explorer-md-link">')
    expect(html).toContain('Hugging Face</a>')
    expect(html).not.toContain('target')
  })

  it('keeps inline b/br and resolves relative assets', () => {
    expect(restoreHtmlTags(escHtml('<b>License</b>'), SLUG)).toBe('<b>License</b>')
    expect(restoreHtmlTags(escHtml('<br>'), SLUG)).toBe('<br/>')
    const rel = restoreHtmlTags(escHtml('<img src="assets/banner.png">'), SLUG)
    expect(rel).toContain(`https://huggingface.co/${SLUG}/resolve/main/assets/banner.png`)
  })

  it('drops <style> blocks like HF instead of leaking CSS text', () => {
    const md = [
      '## Benchmark Results',
      '<style>',
      '.vl-table th{font-size:15px!important}',
      '.vl-table td{vertical-align:middle}',
      '</style>',
      '',
      '| Model | Score |',
      '| --- | --- |',
      '| Qwen | 73.0 |',
    ].join('\n')
    const doc = renderReadmeDoc(md, SLUG)
    expect(doc.html).not.toContain('<style')
    expect(doc.html).not.toContain('vl-table')
    expect(doc.html).not.toContain('font-size:15px')
    expect(doc.html).toContain('Benchmark Results')
    expect(doc.html).toContain('<table class="explorer-md-table">')
  })

  it('renders raw HTML tables as one unit with colspan, no <p> inside', () => {
    const md = [
      '<table class="vl-table">',
      '<tr><th>Model</th><th>Score</th></tr>',
      '<tr><td colspan="2">**78.2** plain</td></tr>',
      '</table>',
    ].join('\n')
    const doc = renderReadmeDoc(md, SLUG)
    expect(doc.html).toContain('<div class="explorer-md-tablewrap"><table>')
    expect(doc.html).not.toContain('vl-table')
    expect(doc.html).toContain('colspan="2"')
    expect(doc.html).toContain('<strong>78.2</strong>')
    expect(doc.html).not.toContain('explorer-md-p')
  })

  it('keeps div banner blocks together without paragraph wrapping', () => {
    const md = ['<div align="center">', 'Hello **world**', '</div>', '', 'After'].join('\n')
    const doc = renderReadmeDoc(md, SLUG)
    expect(doc.html).toContain('<div align="center">')
    expect(doc.html).toContain('Hello <strong>world</strong>')
    expect(doc.html).toContain('</div>')
    expect(doc.html).not.toContain('<p class="explorer-md-p">Hello')
    expect(doc.html).toContain('<p class="explorer-md-p">After</p>')
  })

  it('leaves dangerous markup escaped', () => {
    expect(restoreHtmlTags(escHtml('<script>alert(1)</script>'), SLUG)).toContain('&lt;script&gt;')
    expect(restoreHtmlTags(escHtml('<a href="javascript:alert(1)">x</a>'), SLUG)).toContain('&lt;a')
    expect(restoreHtmlTags(escHtml('<img src="x" onerror="alert(1)">'), SLUG)).not.toContain('onerror')
    expect(restoreHtmlTags(escHtml('<iframe src="https://evil.example"></iframe>'), SLUG)).toContain('&lt;iframe')
  })
})
