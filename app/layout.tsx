import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "IFRS 18 검토 지원", description: "DART 근거 기반 검토조서 및 Reviewer 의사결정" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
 return <html lang="ko" className="h-full antialiased"><body className="min-h-full flex flex-col">{children}</body></html>;
}
