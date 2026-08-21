"use client";

import { ProtectedRoute, useAuth } from "@/features/auth";
import { Card } from "@/components/ui/card";
import { AccountSettingsCard } from "./account-settings-card";
import { RiotApiSettingsCard } from "./riot-api-settings-card";

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
      <div className="mb-6 space-y-6">
        <Card id="header-card" className="p-6 text-white">
          <div className="mb-4 flex items-start justify-between">
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <p className="text-sm leading-relaxed">
            {isAdmin
              ? "Manage account security and global Riot API configuration"
              : "Manage your account profile and security"}
          </p>
        </Card>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          <AccountSettingsCard
            className={isAdmin ? "lg:col-span-2" : "lg:col-span-5"}
          />

          {isAdmin && <RiotApiSettingsCard />}
        </div>
      </div>
    </div>
  );
}
