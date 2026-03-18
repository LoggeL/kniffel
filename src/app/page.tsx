import { Suspense } from "react";
import { KniffelApp } from "@/components/kniffel-app";

export default function HomePage() {
  return (
    <Suspense>
      <KniffelApp />
    </Suspense>
  );
}
