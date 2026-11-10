/** The file name from a Content-Disposition header (prefers the UTF-8 form). */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      /* fall through to the plain name */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}
