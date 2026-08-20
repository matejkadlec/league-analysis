import Image from "next/image";

import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { LEGAL_LINK_CLASS, LegalNotice } from "@/components/legal-notice";

export function PublicPageFooter() {
  return (
    <footer className="h-[68px] border-t border-white/10 bg-[#0d1a2b] px-6">
      <div className="mx-auto grid h-full w-full max-w-[1200px] grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex justify-end pr-1">
          <Image
            src="/logo-v3.png"
            alt="League Analysis logo"
            width={1746}
            height={583}
            className="h-[37px] w-auto object-contain"
          />
        </div>

        <LegalNotice className="pl-1">
          <CookieSettingsTrigger className={LEGAL_LINK_CLASS} />
        </LegalNotice>

        <div aria-hidden />
      </div>
    </footer>
  );
}
