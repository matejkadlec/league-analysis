import Image from "next/image";
import Link from "next/link";

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

        <p className="text-center text-xs leading-relaxed text-white/70 pl-1">
          © 2026 All rights reserved.
          <br />
          <Link
            href="/license"
            className="underline transition-colors duration-300 hover:text-[#cfa93a]"
          >
            License
          </Link>
          {" | "}
          <Link
            href="/privacy-policy"
            className="underline transition-colors duration-300 hover:text-[#cfa93a]"
          >
            Privacy Policy
          </Link>
          {" | "}
          <Link
            href="/cookie-policy"
            className="underline transition-colors duration-300 hover:text-[#cfa93a]"
          >
            Cookie Policy
          </Link>
        </p>

        <div aria-hidden />
      </div>
    </footer>
  );
}
