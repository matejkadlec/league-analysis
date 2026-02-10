import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicBackButtonProps {
  href: string;
  label: string;
}

export function PublicBackButton({ href, label }: PublicBackButtonProps) {
  return (
    <div className="fixed left-4 top-16 z-[90]">
      <Button
        asChild
        variant="outline"
        className="h-10 rounded-lg border border-white/30 bg-[#0a1428]/95 px-4 text-sm font-semibold text-white shadow-md backdrop-blur hover:bg-[#0f1f3a]"
      >
        <Link href={href}>
          <ArrowLeft className="h-4 w-4" />
          {label}
        </Link>
      </Button>
    </div>
  );
}
