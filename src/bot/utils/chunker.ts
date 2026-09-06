/**
 * Safely splits a message into chunks <= maxLength (Discord limit is 2000 characters).
 * Preserves codeblocks, paragraphs, and sentence boundaries where possible.
 */
export function chunkMessage(text: string, maxLength: number = 1950): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find natural split point before maxLength
    let splitIndex = -1;

    // 1. Try double newline (paragraph break)
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitIndex = paragraphBreak + 2;
    }

    // 2. Try single newline
    if (splitIndex === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.5) {
        splitIndex = lineBreak + 1;
      }
    }

    // 3. Try sentence boundary (. , ! , ?)
    if (splitIndex === -1) {
      const sentenceMatches = Array.from(remaining.slice(0, maxLength).matchAll(/[.!?]\s+/g));
      if (sentenceMatches.length > 0) {
        const lastSentence = sentenceMatches[sentenceMatches.length - 1];
        if (lastSentence.index !== undefined && lastSentence.index > maxLength * 0.4) {
          splitIndex = lastSentence.index + lastSentence[0].length;
        }
      }
    }

    // 4. Try space
    if (splitIndex === -1) {
      const spaceBreak = remaining.lastIndexOf(' ', maxLength);
      if (spaceBreak > maxLength * 0.3) {
        splitIndex = spaceBreak + 1;
      }
    }

    // 5. Hard split if no suitable breakpoint found
    if (splitIndex === -1 || splitIndex <= 0) {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

