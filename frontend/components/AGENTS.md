# Components (`components/`)

Shared layout/infrastructure components. **NOT feature-specific** (those go in `features/`).

## Structure

```
components/
├── ui/                    # shadcn/ui primitives (DO NOT edit manually)
├── sidebar-nav.tsx        # Navigation sidebar
├── theme-provider.tsx     # Theme context
├── theme-toggle.tsx       # Dark mode toggle
├── providers.tsx          # TanStack Query provider
└── loading-skeleton.tsx   # Loading states
```

## shadcn/ui (`ui/`)

**DO NOT edit files in `components/ui/` manually**. Add/update via:

```bash
npx shadcn@latest add <component>
npx shadcn@latest add button
npx shadcn@latest add card
```

Available components: button, card, dialog, form, input, label, popover, progress, select, skeleton, table, tabs, etc.

## Shared Components

### Player Search Autocomplete Pattern

**Features**:

- Debounced search (300ms) to reduce API calls
- Keyboard navigation (Arrow Up/Down, Enter, Escape)
- Server-side suggestions with platform filtering
- Loading states with spinner
- Auto-display on focus
- Mouse and keyboard interaction

**Implementation**:

```typescript
const [showSuggestions, setShowSuggestions] = useState(false);
const [selectedIndex, setSelectedIndex] = useState(-1);
const [debouncedSearchValue, setDebouncedSearchValue] = useState("");

// Debouncing
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearchValue(searchValue);
  }, 300);
  return () => clearTimeout(timer);
}, [searchValue]);

// Keyboard nav
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case "ArrowDown": // Move down
    case "ArrowUp": // Move up
    case "Enter": // Select current
    case "Escape": // Close dropdown
  }
};
```

**API**: `/players/suggestions?q={search}&platform={platform}&limit={limit}`

## Rules

- ✅ Add `"use client"` for hooks/events/browser APIs
- ✅ Use shadcn/ui primitives from `components/ui/`
- ✅ Define TypeScript interface for props
- ✅ Handle loading/error/success states
- ✅ Use cn() utility for conditional classes
- ✅ PascalCase for component names

- ❌ Don't edit `components/ui/` manually
- ❌ Don't create custom UI primitives (use shadcn)
- ❌ Don't skip TypeScript prop interfaces
- ❌ Don't use direct axios calls (use TanStack Query)
- ❌ Don't forget loading and error states
- ❌ Don't use camelCase for component file names
