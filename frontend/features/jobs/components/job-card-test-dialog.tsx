"use client";

import { FlaskConical, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface JobCardTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (suspendRegular: boolean) => void;
}

export function JobCardTestDialog({
  open,
  onOpenChange,
  onConfirm,
}: JobCardTestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-gold-base" />
            Start Test Run
          </DialogTitle>
          <DialogDescription>
            The test run will call all Riot API endpoints this job uses once per
            minute without saving any data. It runs for up to 1 hour or until
            stopped.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Suspend regular scheduled runs during the test?
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            className="red-gradient py-2 px-4"
            onClick={() => onOpenChange(false)}
          >
            <StopCircle className="h-4 w-4" />
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              className="gold-gradient py-2 px-4"
              onClick={() => onConfirm(false)}
            >
              No
            </Button>
            <Button
              className="gold-gradient py-2 px-4"
              onClick={() => onConfirm(true)}
            >
              Yes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
