"use client";

export default function SettingsPage() {
  return (
    <main className="space-y-6">
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Settings</h2>
          <p className="text-sm text-slate-300/70">Configure reminders and pacing defaults once state is wired up.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Reminder Preferences</h3>
            <p className="text-sm text-slate-300/80">Placeholder toggle: enable reminders and choose lead time.</p>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Minutes per Page</h3>
            <p className="text-sm text-slate-300/80">Placeholder: set a default pacing value and course overrides.</p>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Focus Defaults</h3>
            <p className="text-sm text-slate-300/80">Placeholder: choose the default focus score when logging sessions.</p>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Calendar Token</h3>
            <p className="text-sm text-slate-300/80">Placeholder: store a private token for ICS exports.</p>
          </div>
        </div>
        <div>
          <a href="/settings/import" className="inline-flex items-center px-3 py-2 rounded border border-[#1b2344] hover:bg-[#0b1020] text-sm">Import Data (CSV)</a>
        </div>
      </section>
    </main>
  );
}
