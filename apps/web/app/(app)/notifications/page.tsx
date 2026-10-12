import { redirect } from "next/navigation";

/** Old address — notifications live on the personal preferences page now. */
export default function NotificationsRedirect() {
  redirect("/preferences#notifications");
}
