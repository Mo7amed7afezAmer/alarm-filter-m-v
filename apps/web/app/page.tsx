import { CATEGORIES } from "@alarm/core";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Alarm Filter</h1>
      <p className="mt-2 text-muted-foreground">
        Scaffold ready. Categories: {CATEGORIES.join(" / ")}
      </p>
    </main>
  );
}
