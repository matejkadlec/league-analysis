import { cn } from "@/lib/core/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Named so the e2e harness can wait for every gated card to have
      // resolved, which is what it means for a populated page to be ready.
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/40",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-[shimmer_2s_infinite]",
        "before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
