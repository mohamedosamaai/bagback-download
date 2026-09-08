import { Format, AnalyzeResult } from '../types';

export const mockFormats: Format[] = [
  { id: 'bestvideo+bestaudio/best', ext: 'mp4', resolution: '1080p (Best)' },
  { id: '720p', ext: 'mp4', resolution: '720p HD' },
  { id: '480p', ext: 'mp4', resolution: '480p SD' },
  { id: '360p', ext: 'mp4', resolution: '360p' },
  { id: 'bestaudio/best', ext: 'mp3', resolution: 'Audio MP3' }
];

function matchesHost(urlStr: string, domains: string[]): boolean {
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    const host = parsed.hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export function getMockMetadata(url: string): AnalyzeResult {
  if (matchesHost(url, ['youtube.com', 'youtu.be'])) {
    return {
      title: "Building High-Performance Distributed Systems with TypeScript",
      thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=640&auto=format&fit=crop",
      duration: 352,
      uploader: "Tech Engineering Hub",
      formats: mockFormats
    };
  }
  if (matchesHost(url, ['tiktok.com'])) {
    return {
      title: "Cloud Infrastructure & Full-Stack Architecture Best Practices",
      thumbnail: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=640&auto=format&fit=crop",
      duration: 60,
      uploader: "mohamed.osama",
      formats: mockFormats
    };
  }
  if (matchesHost(url, ['instagram.com'])) {
    return {
      title: "Bagback Download - Universal Open Source Media Downloader",
      thumbnail: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=640&auto=format&fit=crop",
      duration: 120,
      uploader: "bagback.tech",
      formats: mockFormats
    };
  }
  if (matchesHost(url, ['twitter.com', 'x.com'])) {
    return {
      title: "Modern Web Architecture and Edge Computing Patterns",
      thumbnail: "https://images.unsplash.com/photo-1614741118887-7a4ee193a5fa?w=640&auto=format&fit=crop",
      duration: 45,
      uploader: "Mohamed Osama",
      formats: mockFormats
    };
  }
  return {
    title: "Extracted Media Stream",
    thumbnail: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=640&auto=format&fit=crop",
    duration: 180,
    uploader: "Web Media Engine",
    formats: mockFormats
  };
}
