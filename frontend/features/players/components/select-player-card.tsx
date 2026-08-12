import { UserRoundSearch } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function SelectPlayerCard() {
  return (
    <Card className="w-full">
      <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 py-16 text-center">
        <UserRoundSearch className="h-16 w-16 text-muted-foreground" />
        <div>
          <h2 className="text-xl font-semibold">Select a player</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Search from the sidebar or open Tracked Players to choose the player
            shown on this page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
