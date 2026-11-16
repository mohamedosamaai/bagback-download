export type SourceSupport = 'supported' | 'unsupported' | 'needs_review';

export type AnalyzeResult = {
  url: string;
  support: SourceSupport;
  reason?: string;
};

export function analyzeUrl(url: string): AnalyzeResult {
  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        url,
        support: 'unsupported',
        reason: 'Only HTTP and HTTPS links are accepted.'
      };
    }

    if (parsed.username || parsed.password) {
      return {
        url,
        support: 'unsupported',
        reason: 'Embedded URL credentials are not allowed.'
      };
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal' ||
      /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)
    ) {
      return {
        url,
        support: 'unsupported',
        reason: 'Private or internal network targets are blocked.'
      };
    }

    return {
      url,
      support: 'needs_review',
      reason: 'Engine integration is pending source review.'
    };
  } catch {
    return {
      url,
      support: 'unsupported',
      reason: 'Invalid URL.'
    };
  }
}
