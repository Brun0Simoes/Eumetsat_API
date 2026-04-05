import { redirect } from "next/navigation";

export default function HomePage() {
  // Keep the example on a namespaced route so it can be copied into another
  // application without colliding with the host app's own homepage.
  redirect("/eumetsat-calendar");
}
