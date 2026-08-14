import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { initDatabase } from "@/lib/db";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  initDatabase();

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b bg-background px-6">
          <ThemeToggle />
        </header>
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
