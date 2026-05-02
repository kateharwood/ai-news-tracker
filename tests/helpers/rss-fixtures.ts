function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function rss2Body(items: Array<{ title: string; link: string; guid: string; pubDate: string; desc?: string }>) {
  const itemsXml = items
    .map(
      (i) => `
    <item>
      <title>${escapeXml(i.title)}</title>
      <link>${escapeXml(i.link)}</link>
      <guid>${escapeXml(i.guid)}</guid>
      <pubDate>${i.pubDate}</pubDate>
      <description>${escapeXml(i.desc ?? "")}</description>
    </item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Fixture Feed</title>
    <link>https://example.com/</link>
    <description>t</description>
    ${itemsXml}
  </channel>
</rss>`;
}
