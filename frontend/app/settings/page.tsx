"use client";

import { ProtectedRoute, useAuth } from "@/features/auth";
import { PageHeader } from "@/components/page-header";
import { PageSections, Section, SectionRow } from "@/components/page-sections";
import { AccountSettingsCard, RiotApiSettingsCard } from "@/features/settings";

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsPageContent />
    </ProtectedRoute>
  );
}

function SettingsPageContent() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  return (
    <div className="container mx-auto px-4 py-8">
      <PageSections>
        <PageHeader title="Settings">
          <p className="text-sm leading-relaxed">
            {isAdmin
              ? "Manage account security and global Riot API configuration"
              : "Manage your account profile and security"}
          </p>
        </PageHeader>

        {/* Two forms, so a row for an administrator; alone, the account form
            keeps half the width instead of stretching its fields across. */}
        {isAdmin ? (
          <SectionRow>
            <AccountSettingsCard />
            <RiotApiSettingsCard />
          </SectionRow>
        ) : (
          <Section width="half">
            <AccountSettingsCard />
          </Section>
        )}
      </PageSections>
    </div>
  );
}
