import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "AI News Tracker",
  description: "Personal AI news curator",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <Nav user={user} />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
