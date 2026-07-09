import { DesktopAppDownload } from '@/components/desktop-app/DesktopAppDownload';
import { PRODUCT_NAME } from '@/lib/branding/constants';

export const metadata = {
  title: `Install ${PRODUCT_NAME} desktop app`,
};

export default function DesktopAppPage() {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <DesktopAppDownload />
    </div>
  );
}
