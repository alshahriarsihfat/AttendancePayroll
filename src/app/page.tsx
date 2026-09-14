import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppContent } from "../App";
import { COOKIE_NAME, decodeSession } from "@/lib/auth-session";

export default async function HomePage() {
  const session = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  return <AppContent />;
}
