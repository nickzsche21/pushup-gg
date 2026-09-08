import { Suspense } from "react";
import SessionClient from "./SessionClient";

export default function TrainSessionPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-you" />
        </main>
      }
    >
      <SessionClient />
    </Suspense>
  );
}
