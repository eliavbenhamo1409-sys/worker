import { redirect } from "next/navigation";

/** The worker app lives under /worker; the root just forwards there. */
export default function Home() {
  redirect("/worker");
}
