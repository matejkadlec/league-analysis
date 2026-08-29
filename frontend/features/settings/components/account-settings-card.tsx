"use client";

import { requestCookieConsentPreferences } from "@/features/cookie-consent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { Eye, UserCog } from "lucide-react";
import { ChangeEmailDialog } from "./change-email-dialog";
import { DisplayNameField } from "./display-name-field";
import { EmailSettingsSection } from "./email-settings-section";
import { PasswordChangeSection } from "./password-change-section";
import { ACCOUNT_ACTION_BUTTON_CLASS } from "../settings-helpers";
import { useChangeEmail } from "./use-change-email";

interface AccountSettingsCardProps {
  className?: string;
}

export function AccountSettingsCard({
  className = "lg:col-span-1",
}: AccountSettingsCardProps) {
  const emailChange = useChangeEmail();

  return (
    <>
      <Card className={cn("h-full p-6 text-left", className)}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <UserCog className="h-5 w-5 text-[#cfa93a]" />
          Account Settings
        </h2>

        <TooltipProvider>
          <div className="space-y-4">
            <DisplayNameField />
            <EmailSettingsSection
              onChangeEmail={emailChange.handleOpenEmailDialog}
              isSubmitting={emailChange.isEmailDialogSubmitting}
              isLocked={emailChange.isEmailChangeLocked}
            />
            <PasswordChangeSection />

            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end gap-3">
              <div className="space-y-1.5">
                <Label>Cookie settings</Label>
                <p className="text-xs text-muted-foreground">
                  Review and update your cookie preferences.
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  className={ACCOUNT_ACTION_BUTTON_CLASS}
                  onClick={requestCookieConsentPreferences}
                >
                  <Eye className="h-4 w-4" />
                  View
                </Button>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </Card>

      <ChangeEmailDialog emailChange={emailChange} />
    </>
  );
}
