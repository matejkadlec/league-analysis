"use client";

import { useId, useState, type FocusEvent } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/core/utils";

export interface SectionQuickNavigationItem {
  label: string;
  anchor: `#${string}`;
}

interface SectionQuickNavigationProps {
  items: SectionQuickNavigationItem[];
}

export function SectionQuickNavigation({
  items,
}: SectionQuickNavigationProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const navigationId = useId();
  const isExpanded = isHovered || isPinned;

  const scrollToAnchor = (anchor: string) => {
    const element = document.querySelector(anchor);
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsPinned(false);
    }
  };

  return (
    <div
      className="fixed right-0 top-1/2 z-40 -translate-y-1/2"
      data-testid="section-quick-navigation"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlurCapture={handleBlur}
    >
      <div className="flex h-[242px] items-stretch">
        <div className="vertical-gradient flex w-10 items-center justify-center rounded-l-lg border-l border-y border-r-0 border-[#2f3640]">
          <button
            type="button"
            aria-controls={navigationId}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? "Close page navigation" : "Open page navigation"
            }
            className="flex h-full w-full items-center justify-center"
            onClick={() => setIsPinned((pinned) => !pinned)}
          >
            <ChevronLeft
              className={cn(
                "h-4 w-4 text-[#2f3640] transition-transform duration-300",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            />
          </button>
        </div>

        <div
          id={navigationId}
          aria-hidden={!isExpanded}
          className={cn(
            "overflow-hidden border-y border-[#2f3640] border-l-0 border-r-0 bg-card/95 shadow-lg backdrop-blur-sm transition-[width,opacity,transform] duration-300 ease-out",
            isExpanded
              ? "w-[180px] translate-x-0 opacity-100"
              : "w-0 translate-x-full opacity-0",
          )}
        >
          <nav aria-label="Page sections" className="h-auto w-[180px] py-2">
            <ul className="flex h-full flex-col justify-center">
              {items.map((item) => (
                <li key={item.anchor}>
                  <button
                    type="button"
                    tabIndex={isExpanded ? 0 : -1}
                    className="w-full px-4 py-1.5 text-left text-sm transition-all duration-300 hover:bg-accent/35 hover:text-[#cfa93a]"
                    onClick={() => scrollToAnchor(item.anchor)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
