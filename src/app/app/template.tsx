import { PageEnter } from "@/components/Motion";

// Remounts on every navigation inside the app, so each page gets the entrance.
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageEnter>{children}</PageEnter>;
}
