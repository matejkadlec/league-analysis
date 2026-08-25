import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What a profile card shows before there are enough matches to say anything.
 * `id` is not optional: `SectionQuickNavigation` registers a section by
 * finding its anchor, so an empty state that drops the id makes a visible
 * section vanish from the page navigation.
 */
export function ProfileCardEmptyState({
  icon: Icon,
  id,
  title,
  message,
}: {
  icon: LucideIcon;
  id: string;
  title: string;
  message: string;
}) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
