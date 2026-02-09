# Draggable Cards Feature

> **Status**: TODO  
> **Estimated Effort**: 1-2 prompts for basic implementation, +1 prompt for polish  
> **Priority**: Low (nice-to-have)

## Overview

Allow users to reorder cards on the My Profile page (and potentially other pages) via drag-and-drop. The order should persist across sessions.

## Recommended Approach: Hold Shift + Drag

This is the cleanest pattern because:

1. **No lock/unlock UI needed** - cleaner interface
2. **No conflict with interactive elements** - buttons, links work normally
3. **Intentional action** - prevents accidental reordering
4. **Industry precedent** - many apps use modifier keys for special drag modes

## Technology: @dnd-kit

Use `@dnd-kit/core` + `@dnd-kit/sortable` - the most popular React drag-and-drop library.

### Installation

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## Implementation Plan

### 1. Create Sortable Card Wrapper Component

```tsx
// frontend/components/sortable-card.tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReactNode, useState, useEffect } from "react";

interface SortableCardProps {
  id: string;
  children: ReactNode;
  disabled?: boolean;
}

export function SortableCard({ id, children, disabled }: SortableCardProps) {
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: disabled || !isShiftHeld,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isShiftHeld ? "grab" : "default",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}
```

### 2. Create Sortable Container Component

```tsx
// frontend/components/sortable-container.tsx
"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ReactNode } from "react";

interface SortableContainerProps {
  items: string[];
  onReorder: (newOrder: string[]) => void;
  children: ReactNode;
}

export function SortableContainer({
  items,
  onReorder,
  children,
}: SortableContainerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      const newOrder = arrayMove(items, oldIndex, newIndex);
      onReorder(newOrder);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
```

### 3. State Persistence via user_settings

Store card order in `auth.user_settings` table:

```json
{
  "profile_card_order": [
    "player-card",
    "champion-stats",
    "lane-stats",
    "recent-performance",
    "match-history"
  ]
}
```

#### Backend Changes Required

- Add `profile_card_order` field to user settings schema
- Expose via existing settings endpoints

#### Frontend Changes Required

- Load card order from user settings on page mount
- Save new order when user reorders cards
- Use TanStack Query for caching

### 4. Usage in My Profile Page

```tsx
// frontend/app/my-profile/page.tsx (simplified example)
const DEFAULT_CARD_ORDER = [
  "player-card",
  "champion-stats",
  "lane-stats",
  "recent-performance",
  "match-history",
];

function ProfileContent({ puuid }: { puuid: string }) {
  const [cardOrder, setCardOrder] = useState(DEFAULT_CARD_ORDER);

  // Load from user settings...

  const cardComponents: Record<string, ReactNode> = {
    "player-card": <PlayerCard player={player} />,
    "champion-stats": <ChampionStatsCard stats={championStats} />,
    "lane-stats": <LaneStatsCard stats={laneStats} />,
    "recent-performance": <RecentPerformanceCard puuid={puuid} />,
    "match-history": <MatchHistory puuid={puuid} />,
  };

  const handleReorder = (newOrder: string[]) => {
    setCardOrder(newOrder);
    // Save to backend...
  };

  return (
    <SortableContainer items={cardOrder} onReorder={handleReorder}>
      <div className="space-y-6">
        {cardOrder.map((cardId) => (
          <SortableCard key={cardId} id={cardId}>
            {cardComponents[cardId]}
          </SortableCard>
        ))}
      </div>
    </SortableContainer>
  );
}
```

## Visual Feedback Requirements

1. **Shift held indicator**: Show subtle cursor change or tooltip "Hold Shift to drag"
2. **Dragging state**: Reduce opacity, add shadow/scale
3. **Drop placeholder**: Show where card will land
4. **Smooth animations**: Use CSS transitions (dnd-kit handles this)

## Different Heights Handling

**Not a problem** - @dnd-kit handles variable heights automatically. The drop placeholder adjusts to the actual card height.

## Alternative Approaches Considered

| Approach                       | Pros                   | Cons                      |
| ------------------------------ | ---------------------- | ------------------------- |
| **Shift + Drag** (recommended) | Clean UI, no conflicts | Users must learn gesture  |
| Lock/Unlock toggle             | Explicit mode          | Extra UI, cluttered       |
| Drag handle icon               | Familiar pattern       | Takes space, may conflict |
| Long press                     | Mobile-friendly        | Not intuitive on desktop  |

## Files to Create/Modify

### New Files

- `frontend/components/sortable-card.tsx`
- `frontend/components/sortable-container.tsx`

### Modified Files

- `frontend/app/my-profile/page.tsx` - Add sortable wrapper
- `backend/app/features/settings/schemas.py` - Add card order field (optional)
- `frontend/lib/core/schemas.ts` - Add card order type (optional)

## Testing Checklist

- [ ] Cards reorder correctly with Shift + drag
- [ ] Buttons/links inside cards still work normally
- [ ] Order persists after page refresh
- [ ] Order persists after logout/login
- [ ] Animations are smooth
- [ ] Works with keyboard navigation
- [ ] No console errors during drag

## Notes for AI Implementation

1. Install @dnd-kit packages first
2. Create wrapper components before modifying page
3. Test basic drag before adding persistence
4. The `useSortable` hook provides all drag state
5. CSS transforms are handled by dnd-kit utilities
6. Different card heights are NOT a problem
