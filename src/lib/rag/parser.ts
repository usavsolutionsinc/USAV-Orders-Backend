/**
 * Sliding window character-based chunker
 * Chunk size: 2000 characters (~500 tokens)
 * Overlap size: 200 characters (~50 tokens)
 */
export function chunkText(text: string, chunkSize = 2000, overlap = 200): string[] {
  const chunks: string[] = [];
  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  
  if (normalizedText.length <= chunkSize) {
    return [normalizedText];
  }

  let startIndex = 0;
  while (startIndex < normalizedText.length) {
    let endIndex = startIndex + chunkSize;
    
    // Try to break at a clean boundary (e.g., newline or space) if we are not at the end of the text
    if (endIndex < normalizedText.length) {
      // Find the last newline in the final 20% of the chunk
      const searchWindowStart = endIndex - Math.floor(chunkSize * 0.2);
      const lastNewline = normalizedText.lastIndexOf('\n', endIndex);
      
      if (lastNewline > searchWindowStart) {
        endIndex = lastNewline + 1; // Break at newline
      } else {
        const lastSpace = normalizedText.lastIndexOf(' ', endIndex);
        if (lastSpace > searchWindowStart) {
          endIndex = lastSpace + 1; // Break at space
        }
      }
    } else {
      endIndex = normalizedText.length;
    }

    const chunk = normalizedText.slice(startIndex, endIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (endIndex >= normalizedText.length) {
      break;
    }

    // Set starting point for next chunk (with overlap)
    startIndex = endIndex - overlap;
    
    // Fallback: prevent infinite loops if we make no progress
    if (startIndex >= endIndex) {
      startIndex = endIndex;
    }
  }

  return chunks;
}

/**
 * Lightweight text extractor from supported document formats.
 * Primarily handles plain text and markdown.
 */
export function parseDocumentContent(content: string, mimeType: string): string {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  
  // Stripper for basic HTML templates to extract plain text
  if (normalizedMime.includes('html') || normalizedMime.includes('xml')) {
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  if (
    normalizedMime.includes('text/') || 
    normalizedMime === 'application/x-markdown' || 
    normalizedMime.includes('markdown') ||
    normalizedMime.includes('json')
  ) {
    return content;
  }

  return content;
}
