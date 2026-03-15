'use client';
import { UpdatesView } from '@/components/updates/UpdatesView';
import { GuestGate } from '@/components/auth/GuestGate';

export default function UpdatesPage() {
  return (
    <GuestGate title="עדכונים">
      <UpdatesView />
    </GuestGate>
  );
}
