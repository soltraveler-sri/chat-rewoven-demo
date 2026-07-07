import type { Metadata } from "next"
import { Fraunces, Public_Sans, IBM_Plex_Mono } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Nav } from "@/components/nav"
import { Toaster } from "@/components/ui/sonner"
import { APP_BADGE, APP_NAME, APP_TAGLINE } from "@/lib/branding"
import "./globals.css"

// Display — a characterful, composed serif for the wordmark, empty-state
// title, and section headers. Fraunces reads warm and literate at UI-adjacent
// sizes (this is a reading product); kept to 400–500 so display type feels
// confident, not brutish.
const fontDisplay = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--ff-display",
  display: "swap",
})

// UI / body — a quiet humanist sans. Public Sans is exceptionally legible at
// small UI sizes and carries no house/template signature.
const fontSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ff-sans",
  display: "swap",
})

// Mono — warm, humanist monospace for code, diffs, and artifact filenames.
const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ff-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: `${APP_NAME} (${APP_BADGE})`,
  description: APP_TAGLINE,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* De-framed: one full-bleed surface. Nav + main fill the viewport;
              main owns its own scroll so page-level layouts can size to h-full. */}
          <div className="flex h-screen flex-col bg-background text-foreground">
            <Nav />
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
