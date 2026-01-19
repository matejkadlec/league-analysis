# Pages (`app/`)

Next.js App Router pages.

## Structure

```
app/
├── layout.tsx             # Root layout with providers
├── page.tsx               # Home landing page
├── globals.css            # Global styles + Tailwind + shadcn
├── error.tsx              # Error boundary
├── loading.tsx            # Root loading state
├── not-found.tsx          # 404 page
├── player-analysis/       # Player analysis page
├── matchmaking-analysis/  # Matchmaking analysis page
└── jobs/                  # Background jobs monitoring
```

## Rules

**Add `"use client"` for**:

- Hooks (useState, useEffect, etc.)
- Browser APIs
- Event handlers

**Container pattern**:

```typescript
<div className="container mx-auto py-8">{/* content */}</div>
```

**Handle states**:

```typescript
// Loading
if (isLoading) return <LoadingSkeleton />;

// Error
if (error) return <div>Error: {error.message}</div>;

// Success
return <div>{data}</div>;
```

**Data fetching**:

```typescript
import { validatedGet } from "@/lib/core/api";

const { data, isLoading, error } = useQuery({
  queryKey: ["key"],
  queryFn: () => validatedGet(Schema, "/endpoint"),
});
```

**Follow ApiResponse<T> pattern** from backend (success/error fields).

# Create New Page

1. Create `app/my-page/page.tsx`
2. Add navigation to `components/sidebar-nav.tsx`
3. Add auto-refresh if needed: `refetchInterval: 15000` in useQuery

# Don'ts

- ❌ Modify CSS variables in globals.css (managed by shadcn)
- ❌ Create pages without error handling
- ❌ Forget to add to sidebar navigation
- ❌ Use browser APIs without `"use client"`
- ❌ Skip loading and error states
