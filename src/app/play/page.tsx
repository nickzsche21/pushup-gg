import { Suspense } from "react";
import PlayClient from "./PlayClient";

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-you" />
        </main>
      }
    >
      <PlayClient />
    </Suspense>
  );
}
