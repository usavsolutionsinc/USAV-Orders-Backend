'use client';

import Link from 'next/link';

export default function NotAuthorizedPage() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#fafafa',
    }}>
      <div style={{ fontSize: 56, lineHeight: 1 }}>🔒</div>
      <h1 style={{ fontSize: 22, margin: 0 }}>You don&apos;t have access to this page.</h1>
      <p style={{ color: '#666', maxWidth: 420, textAlign: 'center', margin: 0 }}>
        Your role doesn&apos;t include this area. If you think that&apos;s wrong, ask an admin.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Link href="/" style={linkStyle}>Go home</Link>
        <Link href="/signin" style={{ ...linkStyle, background: 'transparent', color: '#111', border: '1px solid #ddd' }}>Switch account</Link>
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 18px',
  borderRadius: 10,
  background: '#111', color: '#fff',
  textDecoration: 'none',
  fontWeight: 600,
};
