import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <h1 className="text-3xl font-semibold text-zinc-900">AI News Tracker</h1>
      <p className="mt-2 text-zinc-500 text-center max-w-sm">
        Your personal AI news digest. Curated daily from your sources.
      </p>
      <Link
        href="/login"
        className="mt-6 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        Log in
      </Link>
    </main>
  );
}
