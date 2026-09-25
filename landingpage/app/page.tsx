import { Navbar } from "@/components/site/navbar"
import { Footer } from "@/components/site/footer"
import { StickyMobileCta } from "@/components/site/sticky-mobile-cta"
import { Hero } from "@/components/site/hero"
import { TrustStrip } from "@/components/site/trust-strip"
import { ProblemSolution } from "@/components/site/problem-solution"
import { HowItWorks } from "@/components/site/how-it-works"
import { CoreFeatures } from "@/components/site/core-features"
import { HardwareAware } from "@/components/site/hardware-aware"
import { AgentOrchestration } from "@/components/site/agent-orchestration"
import { Security } from "@/components/site/security"
import { ProductPreview } from "@/components/site/product-preview"
import { Architecture } from "@/components/site/architecture"
import { TechStack } from "@/components/site/tech-stack"
import { Testing } from "@/components/site/testing"
import { DownloadSection } from "@/components/site/download"
import { Installation } from "@/components/site/installation"
import { SystemRequirements } from "@/components/site/system-requirements"
import { Developer } from "@/components/site/developer"
import { getReleases } from "@/lib/releases"

// Next requires segment config to be a static literal, not an imported binding.
// Keep in sync with RELEASES_REVALIDATE_SECONDS in lib/releases.ts.
export const revalidate = 3600

export default async function Page() {
  const releases = await getReleases()

  return (
    <main className="pb-16 sm:pb-0">
      <Navbar />
      <Hero />
      <TrustStrip />
      <ProblemSolution />
      <HowItWorks />
      <CoreFeatures />
      <HardwareAware />
      <AgentOrchestration />
      <Security />
      <ProductPreview />
      <Architecture />
      <TechStack />
      <Testing />
      <DownloadSection releases={releases} />
      <Installation />
      <SystemRequirements />
      <Developer />
      <Footer />
      <StickyMobileCta />
    </main>
  )
}
