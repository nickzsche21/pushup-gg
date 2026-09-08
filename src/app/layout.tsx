import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import "./globals.css";

const condensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-condensed",
  display: "swap",
});

const title = "PUSHUP.GG — ranked 1v1 push-ups";
const description =
  "Ranked 1v1 push-up matches judged by your webcam. Depth, lockout, body line and tempo are checked on every rep — shallow ones don't count. Nothing you film ever leaves your device.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#06080e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={condensed.variable}>
      <body className="min-h-dvh">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
