import { describe, expect, it } from 'vitest';

import { docToPlainText, plainTextToDoc } from './plain-text-doc';

describe('plain text documents', () => {
  it('turns blank-line blocks into paragraphs and newlines into hard breaks', () => {
    const doc = plainTextToDoc('Hương gỗ ấm.\nLưu hương lâu.\n\nPhù hợp buổi tối.');
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hương gỗ ấm.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Lưu hương lâu.' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Phù hợp buổi tối.' }] },
      ],
    });
  });

  it('round-trips through plain text', () => {
    const text = 'Line one\nLine two\n\nSecond paragraph';
    expect(docToPlainText(plainTextToDoc(text))).toBe(text);
  });

  it('returns null for blank text and an empty string for non-documents', () => {
    expect(plainTextToDoc('  \n\n ')).toBeNull();
    expect(docToPlainText(null)).toBe('');
    expect(docToPlainText({ type: 'paragraph' })).toBe('');
  });
});
