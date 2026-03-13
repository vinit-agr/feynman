import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Feynman</h1>
        <p className="text-muted-foreground text-lg">
          Knowledge &amp; Content Studio
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-4 px-6 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
