import { DesktopAppDownload } from '@/components/desktop-app/DesktopAppDownload';

export const metadata = {
  title: 'Install USAV Orders desktop app',
};

export default function DesktopAppPage() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DesktopAppDownload />
    </div>
  );
}
