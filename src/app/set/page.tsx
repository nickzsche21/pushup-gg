import { Suspense } from "react";
import QuickSetClient from "./QuickSetClient";

export default function QuickSetPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-you" />
        </main>
      }
    >
      <QuickSetClient />
    </Suspense>
  );
}
