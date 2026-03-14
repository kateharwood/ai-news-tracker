import Link from "next/link";
import type { User } from "@supabase/supabase-js";

export function Nav({ user }: { user: User | null }) {
  return (
    <nav className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-6 shadow-sm">
      <Link
        href="/dashboard"
        className="font-semibold text-zinc-800 hover:text-blue-600 transition-colors"
      >
        Today
      </Link>
      <Link
        href="/history"
        className="text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        History
      </Link>
      <Link
        href="/sources"
        className="text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        Sources
      </Link>
      <div className="ml-auto">
        {user ? (
          <form action="/api/auth/signout" method="post" className="inline">
            <button
              type="submit"
              className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              Sign out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            Log in
          </Link>
        )}
      </div>
    </nav>
  );
}
