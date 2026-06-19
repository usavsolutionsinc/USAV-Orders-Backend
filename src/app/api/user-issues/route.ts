/**
 * POST /api/user-issues
 *
 * Creates a GitHub Issue tagged "user-reported" from an in-app feedback submission.
 * The GitHub Actions workflow claude-fix-issue.yml picks it up and opens a PR with a fix.
 *
 * Body: { title: string; description: string; page: string; type: 'bug' | 'suggestion' | 'question' }
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const GITHUB_REPO = 'usavsolutionsinc/USAV-Orders-Backend';
const GITHUB_API = 'https://api.github.com';

type IssueType = 'bug' | 'suggestion' | 'question';

const TYPE_LABEL: Record<IssueType, string> = {
  bug: 'bug',
  suggestion: 'enhancement',
  question: 'question',
};

export const POST = withAuth(async (request: NextRequest, { user }) => {
  const token = process.env.GITHUB_ISSUE_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'GitHub issue token not configured' }, { status: 503 });
  }

  const body = await request.json() as {
    title?: string;
    description?: string;
    page?: string;
    type?: IssueType;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
  }
  if (!body.description?.trim()) {
    return NextResponse.json({ ok: false, error: 'description is required' }, { status: 400 });
  }

  const issueType: IssueType = body.type && body.type in TYPE_LABEL ? body.type : 'bug';

  const issueBody = [
    `**Reported by:** ${user.name ?? 'Unknown'}`,
    `**Page:** ${body.page ?? 'unknown'}`,
    `**Type:** ${issueType}`,
    '',
    '---',
    '',
    body.description.trim(),
  ].join('\n');

  const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[${issueType.toUpperCase()}] ${body.title.trim()}`,
      body: issueBody,
      labels: ['user-reported', TYPE_LABEL[issueType]],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('GitHub issue creation failed:', res.status, text);
    return NextResponse.json({ ok: false, error: 'Failed to create issue' }, { status: 502 });
  }

  const issue = await res.json() as { number: number; html_url: string };

  return NextResponse.json({ ok: true, issueNumber: issue.number, url: issue.html_url });
});
